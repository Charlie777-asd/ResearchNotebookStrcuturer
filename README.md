# 🔬 ResearchAI – Notebook Structurer

> Transform raw research notes into professional academic papers using local AI (Ollama)

![Python](https://img.shields.io/badge/Python-3.9+-blue?style=flat-square&logo=python)
![Flask](https://img.shields.io/badge/Flask-3.x-black?style=flat-square&logo=flask)
![Ollama](https://img.shields.io/badge/Ollama-llama3.2-purple?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## ✨ Features

- 📁 **Upload** PDF, DOCX, or TXT research notes  
- 🧩 **AI Structure** — Ollama (llama3.2) extracts Hypothesis, Procedure, Parameters, Results & Conclusion  
- ✨ **Generate** full academic papers with real-time token streaming  
- 📊 **Peer Review** — AI scores paper quality across 4 dimensions with feedback  
- 💾 **Versioning** — save and restore snapshots of your work  
- 📑 **Export** to TXT, PDF, or DOCX  
- 🌙 Premium dark UI with glassmorphism and animated background  

---

## 📁 Project Structure

```
Research-Notebook-Structurer/
│
├── index.html              ← Semantic HTML only
├── server.py               ← Flask backend + Ollama integration
├── requirements.txt        ← Python dependencies
│
└── static/
    ├── css/
    │   └── styles.css      ← All styles (dark theme, animations)
    └── js/
        └── app.js          ← All application logic (11 sections)
```

---

## 🚀 Quick Start

### 1. Prerequisites

- [Ollama](https://ollama.ai) installed and running  
- Python 3.9+

### 2. Pull the AI model

```bash
ollama pull llama3.2
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 4. Start the server

```bash
python3 server.py
```

### 5. Open the app

Navigate to **[http://localhost:5050](http://localhost:5050)** in your browser.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/` | Serves the frontend |
| `GET`  | `/api/health` | Checks Ollama connectivity |
| `POST` | `/api/upload` | Extracts text from PDF/DOCX/TXT |
| `POST` | `/api/structure` | AI-extracts research fields (JSON) |
| `POST` | `/api/generate` | Streams full academic paper (SSE) |
| `POST` | `/api/score` | AI peer-review scoring |
| `GET`  | `/api/models` | Lists available Ollama models |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Python + Flask |
| AI Model | Ollama (llama3.2) via local REST API |
| PDF parsing | PyMuPDF (fitz) |
| DOCX parsing | python-docx |
| Export | jsPDF, docx.js |

---

## 📄 License

MIT © 2026
