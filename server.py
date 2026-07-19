#!/usr/bin/env python3
"""
AI Research Workspace – Backend
Powered by Google Gemini API via Flask
"""

import json, re, io, os, sys, traceback, subprocess, uuid, time
from datetime import datetime

# ── Auto-install missing packages ───────────────────────────────────────────
def ensure(pkg, import_name=None):
    import_name = import_name or pkg
    try:
        __import__(import_name)
    except ImportError:
        print(f"[setup] Installing {pkg}...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "--quiet"])

ensure("flask")
ensure("flask-cors", "flask_cors")
ensure("requests")
ensure("PyMuPDF", "fitz")
ensure("python-docx", "docx")
ensure("python-dotenv", "dotenv")

from flask import Flask, request, jsonify, Response, stream_with_context, send_from_directory
from flask_cors import CORS
import requests as req_lib

# ── Load .env ────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ── optional heavy imports ───────────────────────────────────────────────────
try:
    import fitz  # PyMuPDF
    PDF_OK = True
except Exception:
    PDF_OK = False
    print("[warn] PyMuPDF not available - PDF parsing disabled")

try:
    from docx import Document as DocxDocument
    DOCX_OK = True
except Exception:
    DOCX_OK = False
    print("[warn] python-docx not available - DOCX parsing disabled")

# ── App Setup ────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)

# ── Gemini API config ────────────────────────────────────────────────────────
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")
PREFERRED_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
ACTIVE_MODEL    = PREFERRED_MODEL
MAX_UPLOAD_MB   = int(os.environ.get("MAX_UPLOAD_MB", "50"))

app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

# In-memory session store (production would use Redis/DB)
SESSIONS = {}

# ── Text Extraction Helper ──────────────────────────────────────────────────
def extract_text_from_file(f) -> dict:
    """
    Extract text and metadata from uploaded file (PDF, DOCX, TXT, MD, etc.).
    Supports Flask FileStorage object or file-like objects.
    """
    filename = getattr(f, 'filename', 'document.txt')
    ext = os.path.splitext(filename)[1].lower().strip('.')
    
    # Read bytes
    content_bytes = f.read()
    if hasattr(f, 'seek'):
        f.seek(0)

    text = ""
    pages = 1

    if ext == "pdf":
        if PDF_OK:
            doc = fitz.open(stream=content_bytes, filetype="pdf")
            pages = len(doc)
            extracted_pages = []
            for page in doc:
                extracted_pages.append(page.get_text())
            text = "\n\n".join(extracted_pages)
        else:
            raise RuntimeError("PyMuPDF (fitz) is not installed on server for PDF parsing.")
    elif ext in ("docx", "doc"):
        if DOCX_OK:
            doc = DocxDocument(io.BytesIO(content_bytes))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text = "\n\n".join(paragraphs)
            pages = max(1, len(paragraphs) // 10)
        else:
            raise RuntimeError("python-docx is not installed on server for DOCX parsing.")
    else:
        # Plain text, markdown, rtf, csv, etc.
        for enc in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
            try:
                text = content_bytes.decode(enc)
                break
            except Exception:
                continue
        if not text and content_bytes:
            text = content_bytes.decode("utf-8", errors="ignore")
        
        pages = max(1, len(text.splitlines()) // 40)

    word_count = len(re.findall(r'\w+', text))

    return {
        "filename": filename,
        "text": text,
        "type": ext or "txt",
        "pages": pages,
        "word_count": word_count
    }


# ── Dynamic Model Adapter ───────────────────────────────────────────────────

_DISCOVERED_MODELS_CACHE = []
_LAST_DISCOVERY_TIME = 0

def fetch_available_models(api_key: str = None) -> list:
    """Fetch all available Gemini model names for the API key from Google API."""
    global _DISCOVERED_MODELS_CACHE, _LAST_DISCOVERY_TIME
    key = api_key or GEMINI_API_KEY
    if not key:
        return []
    
    # Cache for 60 seconds
    if _DISCOVERED_MODELS_CACHE and (time.time() - _LAST_DISCOVERY_TIME < 60):
        return _DISCOVERED_MODELS_CACHE

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
        r = req_lib.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
        models_list = []
        for m in data.get("models", []):
            name = m.get("name", "").split("/")[-1]
            methods = m.get("supportedGenerationMethods", [])
            if "generateContent" in methods and name:
                models_list.append(name)
        
        if models_list:
            _DISCOVERED_MODELS_CACHE = models_list
            _LAST_DISCOVERY_TIME = time.time()
            return models_list
    except Exception as e:
        print(f"[model-adapter] Notice: Could not list models from Google API ({e})")
    
    return _DISCOVERED_MODELS_CACHE


def get_candidate_models() -> list:
    """Return deduplicated list of candidate Gemini model names in priority order."""
    candidates = []
    
    # 1. Currently active/working model
    if ACTIVE_MODEL:
        candidates.append(ACTIVE_MODEL)
        
    # 2. Preferred model from .env
    if PREFERRED_MODEL and PREFERRED_MODEL not in candidates:
        candidates.append(PREFERRED_MODEL)
        
    # 3. Models fetched dynamically from Gemini API
    fetched = fetch_available_models()
    for m in fetched:
        if m not in candidates:
            candidates.append(m)
            
    # 4. Built-in candidate fallbacks across Gemini generations
    fallbacks = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash-lite-preview-02-05",
        "gemini-2.5-flash",
        "gemini-1.0-pro",
        "gemini-pro"
    ]
    for fb in fallbacks:
        if fb not in candidates:
            candidates.append(fb)
            
    return candidates


def call_gemini(prompt: str, max_tokens: int = 4096, temperature: float = 0.4) -> str:
    """Call Gemini API with automatic model adaptation and fallback."""
    global ACTIVE_MODEL
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured. Please check your .env file.")

    candidates = get_candidate_models()
    last_error = None

    for model in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            }
        }
        try:
            response = req_lib.post(url, json=payload, timeout=(10, 300))
            if response.status_code in (404, 400) and len(candidates) > 1:
                err_msg = response.json().get("error", {}).get("message", response.text)
                print(f"[model-adapter] Model '{model}' returned {response.status_code}. Trying fallback...")
                last_error = err_msg
                continue

            response.raise_for_status()
            data = response.json()

            c_list = data.get("candidates", [])
            if not c_list:
                raise ValueError("Gemini returned empty candidates list")
            parts = c_list[0].get("content", {}).get("parts", [])
            if not parts or "text" not in parts[0]:
                raise ValueError("Gemini candidate contains no text parts")

            if ACTIVE_MODEL != model:
                print(f"[model-adapter] Successfully adapted to Gemini model: '{model}'")
                ACTIVE_MODEL = model

            return parts[0]["text"]
        except req_lib.exceptions.HTTPError as e:
            last_error = str(e)
            if e.response is not None and e.response.status_code in (404, 400):
                continue
            raise e
        except Exception as e:
            last_error = str(e)

    raise RuntimeError(f"All candidate Gemini models failed. Last error: {last_error}")


def stream_gemini(prompt: str, max_tokens: int = 8192, temperature: float = 0.4):
    """Call Gemini streaming API with automatic model adaptation and fallback."""
    global ACTIVE_MODEL
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured. Please check your .env file.")

    candidates = get_candidate_models()
    last_error = None

    for model in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={GEMINI_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            }
        }
        try:
            response = req_lib.post(url, json=payload, stream=True, timeout=(10, 300))
            if response.status_code in (404, 400) and len(candidates) > 1:
                print(f"[model-adapter] Streaming model '{model}' returned {response.status_code}. Trying fallback...")
                last_error = f"HTTP {response.status_code}"
                continue

            response.raise_for_status()

            if ACTIVE_MODEL != model:
                print(f"[model-adapter] Successfully adapted streaming to Gemini model: '{model}'")
                ACTIVE_MODEL = model

            return response
        except req_lib.exceptions.HTTPError as e:
            last_error = str(e)
            if e.response is not None and e.response.status_code in (404, 400):
                continue
            raise e
        except Exception as e:
            last_error = str(e)

    raise RuntimeError(f"All candidate Gemini streaming models failed. Last error: {last_error}")


def make_event_stream(prompt: str, max_tokens: int = 8192):
    """Generator that yields SSE events from a Gemini streaming call."""
    def generator():
        try:
            r = stream_gemini(prompt, max_tokens=max_tokens)
            for raw_line in r.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                if not line.startswith("data: "):
                    continue
                json_str = line[len("data: "):]
                try:
                    chunk = json.loads(json_str)
                    candidates = chunk.get("candidates", [])
                    if not candidates:
                        continue
                    candidate = candidates[0]
                    parts = candidate.get("content", {}).get("parts", [])
                    token = parts[0].get("text", "") if parts else ""
                    finish = candidate.get("finishReason", "")
                    if token:
                        yield f"data: {json.dumps({'token': token, 'done': False})}\n\n"
                    if finish and finish != "":
                        yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"
                        return
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue
            yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"
    return generator


def sse_response(prompt: str, max_tokens: int = 8192):
    return Response(
        stream_with_context(make_event_stream(prompt, max_tokens)()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/workspace", methods=["GET"])
def workspace():
    return send_from_directory(BASE_DIR, "workspace.html")

@app.route("/showcase-video", methods=["GET"])
@app.route("/watermark-removed-i_have_given_you_the_vedio_ju.mp4", methods=["GET"])
@app.route("/i_have_given_you_the_vedio_ju.mp4", methods=["GET"])
def showcase_video():
    target = "watermark-removed-i_have_given_you_the_vedio_ju.mp4"
    if not os.path.exists(os.path.join(BASE_DIR, target)):
        mp4s = [f for f in os.listdir(BASE_DIR) if f.endswith(".mp4")]
        if mp4s:
            target = mp4s[0]
    return send_from_directory(BASE_DIR, target, mimetype="video/mp4")




@app.route("/api/health", methods=["GET"])
def health():
    try:
        models = fetch_available_models()
        return jsonify({
            "status": "ok",
            "model": ACTIVE_MODEL,
            "models": models if models else [ACTIVE_MODEL]
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e), "model": ACTIVE_MODEL}), 503


@app.route("/api/upload", methods=["POST"])
def upload():
    """Extract raw text from a single uploaded file."""
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    try:
        result = extract_text_from_file(f)
        lines = [l.strip() for l in re.split(r"[\n.!?]", result["text"]) if l.strip()]
        result["lines"] = lines[:200]  # cap for response size
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/upload-multi", methods=["POST"])
def upload_multi():
    """Extract and merge text from multiple uploaded files."""
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files uploaded"}), 400

    results = []
    merged_text = []
    total_words = 0

    for f in files:
        try:
            result = extract_text_from_file(f)
            results.append({
                "filename": result["filename"],
                "type": result["type"],
                "pages": result["pages"],
                "word_count": result["word_count"],
                "status": "ok"
            })
            merged_text.append(f"=== SOURCE: {result['filename']} ===\n{result['text']}")
            total_words += result["word_count"]
        except Exception as e:
            results.append({
                "filename": f.filename,
                "status": "error",
                "error": str(e)
            })

    full_text = "\n\n".join(merged_text)
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {
        "text": full_text,
        "files": results,
        "created_at": datetime.now().isoformat()
    }

    return jsonify({
        "session_id": session_id,
        "files": results,
        "total_words": total_words,
        "merged_text_preview": full_text[:2000]
    })


@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Deep document analysis: builds the research structure graph.
    Classifies sections, detects missing parts, measures completion.
    """
    body = request.get_json(force=True)
    text = body.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400

    prompt = f"""You are an expert academic document analyst. Analyze the following research document and return ONLY a JSON object.

The JSON must have exactly this structure:
{{
  "title": "detected or suggested title",
  "document_type": "research paper / thesis / review / notes / other",
  "overall_completion": 0-100,
  "sections": [
    {{
      "id": "abstract",
      "label": "Abstract",
      "present": true/false,
      "completion": 0-100,
      "confidence": 0-100,
      "word_count": 0,
      "summary": "1-2 sentence summary of this section's content",
      "issues": ["list of detected issues"],
      "suggestions": ["list of improvement suggestions"]
    }}
  ],
  "missing_sections": ["list of section names that are missing"],
  "duplicate_content": ["descriptions of any repeated content detected"],
  "citation_count": 0,
  "figure_count": 0,
  "table_count": 0,
  "equation_count": 0,
  "detected_references": ["up to 5 reference strings found"],
  "keywords": ["detected keywords"],
  "research_domain": "detected academic domain"
}}

Include ALL of these sections in your analysis (mark present: false if missing):
Abstract, Keywords, Introduction, Literature Review, Research Gap, Problem Statement, 
Objectives, Hypothesis, Methodology, Dataset, Algorithms/Architecture, Implementation, 
Experimental Setup, Results, Discussion, Limitations, Future Scope, Conclusion, 
Acknowledgements, References, Appendix

Document to analyze:
\"\"\"
{text[:6000]}
\"\"\"

Return ONLY valid JSON. No markdown, no explanation."""

    try:
        content = call_gemini(prompt, max_tokens=4096, temperature=0.2)
        json_match = re.search(r'\{[\s\S]*\}', content)
        if not json_match:
            raise ValueError("Model did not return a JSON object")
        result = json.loads(json_match.group())
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/structure", methods=["POST"])
def structure():
    """Extract structured research fields from raw text."""
    body = request.get_json(force=True)
    text = body.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided"}), 400

    prompt = f"""You are a scientific research assistant. Extract structured fields from these research notes.
Return ONLY a JSON object with exactly these keys:
- "hypothesis": the main hypothesis or research question
- "procedure": the experimental method or procedure
- "parameters": specific numeric parameters, measurements, or conditions
- "results": observed outcomes or results
- "conclusion": final conclusions or insights
- "keywords": array of 5-10 keywords
- "research_domain": the academic field
- "suggested_title": a concise academic title

If a field cannot be found, write "Not identified in notes."

Research notes:
\"\"\"
{text[:5000]}
\"\"\"

Return ONLY valid JSON. No markdown, no explanation."""

    try:
        content = call_gemini(prompt, max_tokens=2048)
        json_match = re.search(r'\{[\s\S]*\}', content)
        if not json_match:
            raise ValueError("Model did not return a JSON object")
        result = json.loads(json_match.group())
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate", methods=["POST"])
def generate():
    """Stream an AI-generated research paper."""
    body = request.get_json(force=True)
    text = body.get("text", "").strip()
    fmt = body.get("format", "IEEE").upper()
    structured = body.get("structured", {})

    format_instructions = {
        "IEEE": "IEEE Transactions format with numbered sections and [n] citations",
        "APA": "APA 7th edition format with author-date citations",
        "MLA": "MLA 9th edition format",
        "NATURE": "Nature journal format with brief, precise language",
        "ACM": "ACM digital library format",
        "CHICAGO": "Chicago style with footnotes"
    }
    fmt_guide = format_instructions.get(fmt, format_instructions["IEEE"])

    prompt = f"""You are an expert scientific writer. Write a complete, publication-ready research paper in {fmt_guide}.

Structured research data:
- Hypothesis: {structured.get('hypothesis', 'Not specified')}
- Methodology: {structured.get('procedure', 'Not specified')}
- Parameters: {structured.get('parameters', 'Not specified')}
- Results: {structured.get('results', 'Not specified')}
- Conclusion: {structured.get('conclusion', 'Not specified')}
- Keywords: {structured.get('keywords', 'Not specified')}

Raw notes excerpt:
\"\"\"
{text[:3000]}
\"\"\"

Write a complete paper with:
1. **Title** — concise, informative academic title
2. **Abstract** — 200-250 words following {fmt} conventions
3. **Keywords** — 6-8 relevant keywords
4. **1. Introduction** — background, motivation, contributions
5. **2. Literature Review** — related work with citations
6. **3. Methodology** — detailed methods, algorithms, datasets
7. **4. Results** — quantitative results, tables, comparisons
8. **5. Discussion** — interpretation, implications, limitations
9. **6. Conclusion** — summary and future work
10. **References** — 8-10 plausible formatted references in {fmt} style

Use formal academic language. Be thorough, precise, and professional."""

    return sse_response(prompt, max_tokens=8192)


@app.route("/api/rewrite", methods=["POST"])
def rewrite():
    """Stream a rewritten version of a specific section."""
    body = request.get_json(force=True)
    section_text = body.get("text", "").strip()
    section_name = body.get("section", "section")
    action = body.get("action", "rewrite_academic")
    context = body.get("context", "")
    fmt = body.get("format", "IEEE")

    action_prompts = {
        "rewrite_academic": f"Rewrite the following {section_name} section in formal academic English suitable for {fmt} publication. Improve clarity, precision, and academic tone while preserving all factual content.",
        "improve_clarity": f"Improve the clarity and readability of this {section_name} section. Simplify complex sentences, fix ambiguities, and ensure logical flow. Maintain academic register.",
        "reduce_plagiarism": f"Paraphrase and restructure this {section_name} section to reduce similarity with existing literature. Use different sentence structures and vocabulary while preserving meaning.",
        "expand": f"Expand this {section_name} section with additional detail, examples, and academic depth. Add relevant context, methodology details, and supporting discussion. Aim for 2x the current length.",
        "compress": f"Condense this {section_name} section to ~60% of its current length while retaining all critical information. Remove redundancy and unnecessary elaboration.",
        "improve_grammar": f"Fix all grammar, spelling, punctuation, and style issues in this {section_name} section. Maintain the author's voice and content.",
        "improve_flow": f"Improve the logical flow and transitions in this {section_name} section. Add connecting phrases and ensure ideas progress coherently.",
        "generate_citations": f"Add appropriate in-text citation placeholders (e.g., [Author, Year]) to claims in this {section_name} section that require academic citations.",
        "convert_apa_ieee": f"Convert all citations in this text from APA format to IEEE numbered format [n].",
        "convert_ieee_apa": f"Convert all citations in this text from IEEE numbered format [n] to APA author-date format.",
        "explain": f"Provide a detailed plain-English explanation of what this {section_name} section says, including its key claims, methods, and findings.",
        "detect_missing": f"Analyze this {section_name} section and identify: (1) missing information that should be present, (2) unsupported claims, (3) gaps in logic or methodology.",
        "suggest_improvements": f"List 5-7 specific, actionable improvements for this {section_name} section to make it more suitable for top-tier journal publication."
    }

    action_text = action_prompts.get(action, action_prompts["rewrite_academic"])

    prompt = f"""{action_text}

{"Context from the full paper: " + context[:1000] if context else ""}

{section_name} content to process:
\"\"\"
{section_text[:4000]}
\"\"\"

Provide the result directly without any preamble or explanation."""

    return sse_response(prompt, max_tokens=4096)


@app.route("/api/chat", methods=["POST"])
def chat():
    """Stream an AI assistant chat response."""
    body = request.get_json(force=True)
    message = body.get("message", "").strip()
    document_context = body.get("document_context", "")
    chat_history = body.get("history", [])

    if not message:
        return jsonify({"error": "No message provided"}), 400

    history_text = ""
    if chat_history:
        history_text = "Previous conversation:\n"
        for h in chat_history[-6:]:  # Last 6 exchanges
            role = "User" if h.get("role") == "user" else "AI"
            history_text += f"{role}: {h.get('content', '')}\n"
        history_text += "\n"

    doc_ctx_block = f"Document context:\n\"\"\"\n{document_context[:3000]}\n\"\"\"\n" if document_context else ""
    prompt = f"""You are an expert academic research assistant embedded in a professional research workspace.
You help researchers, professors, and PhD scholars with their academic writing, research methodology, citation management, and document structure.

{history_text}

{doc_ctx_block}

User's request: {message}

Provide a detailed, expert-level academic response. If generating content, format it properly for academic use. If explaining, be thorough and cite relevant concepts. If suggesting improvements, be specific and actionable."""

    return sse_response(prompt, max_tokens=4096)


@app.route("/api/quality-score", methods=["POST"])
def quality_score():
    """Generate a comprehensive 100-point research quality score."""
    body = request.get_json(force=True)
    paper = body.get("paper", "").strip()
    if not paper:
        return jsonify({"error": "No paper text provided"}), 400

    prompt = f"""You are a senior peer reviewer for a top-tier academic journal. Evaluate this research document and return ONLY a JSON object.

JSON structure:
{{
  "overall": 0-100,
  "breakdown": {{
    "structure_completeness": 0-15,
    "citation_quality": 0-10,
    "novelty": 0-15,
    "grammar_language": 0-10,
    "academic_tone": 0-10,
    "methodology": 0-15,
    "result_clarity": 0-10,
    "logical_flow": 0-10,
    "reference_consistency": 0-5
  }},
  "grade": "A+ / A / B+ / B / C / D / F",
  "journal_readiness": "Ready / Needs Minor Revision / Needs Major Revision / Not Ready",
  "strengths": ["list of 3-5 strengths"],
  "critical_issues": ["list of 3-5 critical issues"],
  "recommendations": [
    {{"priority": "High/Medium/Low", "action": "specific improvement action", "section": "affected section"}}
  ],
  "estimated_acceptance_chance": "X% at top-tier / Y% at mid-tier journals"
}}

Research document:
\"\"\"
{paper[:5000]}
\"\"\"

Return ONLY valid JSON."""

    try:
        content = call_gemini(prompt, max_tokens=2048, temperature=0.2)
        json_match = re.search(r'\{[\s\S]*\}', content)
        if not json_match:
            raise ValueError("No JSON in model response")
        result = json.loads(json_match.group())
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/score", methods=["POST"])
def score():
    """Legacy score endpoint — delegates to quality-score."""
    body = request.get_json(force=True)
    paper = body.get("paper", "").strip()
    if not paper:
        return jsonify({"error": "No paper text provided"}), 400

    prompt = f"""You are a peer reviewer for a scientific journal. Evaluate this research paper and return ONLY a JSON object:
{{
  "score": 0-100,
  "clarity": 0-25,
  "methodology": 0-25,
  "completeness": 0-25,
  "originality": 0-25,
  "feedback": ["3-5 improvement suggestions"]
}}

Paper:
\"\"\"
{paper[:3000]}
\"\"\"

Return ONLY JSON."""

    try:
        content = call_gemini(prompt, max_tokens=1024)
        json_match = re.search(r'\{[\s\S]*\}', content)
        if not json_match:
            raise ValueError("No JSON in model response")
        result = json.loads(json_match.group())
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate-section", methods=["POST"])
def generate_section():
    """Generate a specific missing section based on document context."""
    body = request.get_json(force=True)
    section = body.get("section", "")
    context = body.get("context", "")
    fmt = body.get("format", "IEEE")

    section_guides = {
        "abstract": "Write a concise 200-word abstract summarizing the research problem, methodology, key results, and conclusions.",
        "introduction": "Write a comprehensive Introduction covering: research background, problem motivation, research gap, contributions, and paper organization.",
        "literature_review": "Write a Literature Review with thematic organization, comparing 8-12 related works, identifying research gaps, and citing relevant publications.",
        "methodology": "Write a detailed Methodology section describing the research design, data collection, analysis methods, tools, and validation approach.",
        "results": "Write a Results section presenting quantitative findings, comparisons, statistical analyses, and key metrics in structured format.",
        "discussion": "Write a Discussion section interpreting results, comparing with related work, discussing implications, limitations, and broader impact.",
        "conclusion": "Write a Conclusion section summarizing contributions, key findings, limitations, and future research directions.",
        "future_scope": "Write a Future Scope section proposing 5-7 specific, actionable research directions that extend this work.",
        "references": "Generate 10 plausible academic references in proper format based on the research context."
    }

    guide = section_guides.get(section.lower().replace(" ", "_"), f"Write a complete {section} section for a research paper.")

    prompt = f"""{guide}

Format: {fmt}

Research context:
\"\"\"
{context[:4000]}
\"\"\"

Write only the section content, starting directly with the section heading. Use formal academic language."""

    return sse_response(prompt, max_tokens=4096)


@app.route("/api/templates", methods=["GET"])
def get_templates():
    """Return available journal/paper templates."""
    templates = [
        {
            "id": "ieee-paper",
            "name": "IEEE Conference Paper",
            "description": "Standard IEEE Transactions format with double-column layout guidelines",
            "format": "IEEE",
            "sections": ["Abstract", "Introduction", "Related Work", "Methodology", "Results", "Conclusion", "References"],
            "icon": "📄"
        },
        {
            "id": "apa-research",
            "name": "APA Research Paper",
            "description": "APA 7th edition format for social sciences and psychology",
            "format": "APA",
            "sections": ["Abstract", "Introduction", "Literature Review", "Method", "Results", "Discussion", "References"],
            "icon": "📋"
        },
        {
            "id": "nature-article",
            "name": "Nature Journal Article",
            "description": "Concise, high-impact format for Nature family journals",
            "format": "Nature",
            "sections": ["Abstract", "Introduction", "Results", "Discussion", "Methods", "References"],
            "icon": "🌿"
        },
        {
            "id": "phd-thesis",
            "name": "PhD Thesis / Dissertation",
            "description": "Comprehensive thesis structure for doctoral research",
            "format": "Thesis",
            "sections": ["Abstract", "Acknowledgements", "Introduction", "Literature Review", "Research Gap", "Methodology", "Results", "Discussion", "Conclusion", "Bibliography", "Appendix"],
            "icon": "🎓"
        },
        {
            "id": "systematic-review",
            "name": "Systematic Literature Review",
            "description": "PRISMA-compliant systematic review structure",
            "format": "Review",
            "sections": ["Abstract", "Introduction", "Search Strategy", "Inclusion Criteria", "Results", "Quality Assessment", "Discussion", "Conclusion"],
            "icon": "🔍"
        },
        {
            "id": "acm-paper",
            "name": "ACM Conference Paper",
            "description": "ACM SIG format for computing conferences",
            "format": "ACM",
            "sections": ["Abstract", "CCS Concepts", "Introduction", "Related Work", "Design", "Implementation", "Evaluation", "Conclusion"],
            "icon": "💻"
        }
    ]
    return jsonify({"templates": templates})


@app.route("/api/models", methods=["GET"])
def list_models():
    models = fetch_available_models()
    return jsonify({
        "active_model": ACTIVE_MODEL,
        "models": models if models else get_candidate_models()
    })


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

    port = int(os.environ.get("PORT", 5050))
    print("=" * 60)
    print("  AI Research Workspace — Backend Server")
    print("=" * 60)
    print(f"  AI Model     : Google Gemini ({ACTIVE_MODEL} [Adaptive Auto-Discovery])")
    print(f"  API Key      : {'✓ Loaded from .env' if GEMINI_API_KEY else '✗ NOT CONFIGURED'}")
    print(f"  Max Upload   : {MAX_UPLOAD_MB} MB")
    print(f"  PDF Support  : {'✓' if PDF_OK else '✗ PyMuPDF not installed'}")
    print(f"  DOCX Support : {'✓' if DOCX_OK else '✗ python-docx not installed'}")
    print(f"  Listening on : http://localhost:{port}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=port, debug=True)
