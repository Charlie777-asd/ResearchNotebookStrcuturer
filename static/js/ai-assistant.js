/**
 * ai-assistant.js — AI Integration Layer
 * AI Research Workspace
 */

const AI = (() => {
  let chatHistory = [];
  let documentContext = '';
  let currentAiResult = '';
  let activeStream = null;

  // ── Streaming SSE reader ─────────────────────────────────────
  async function streamFromEndpoint(endpoint, body, onToken, onDone, onError) {
    try {
      if (activeStream) activeStream.abort?.();
      const controller = new AbortController();
      activeStream = controller;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Server error' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) { onError?.(data.error); return; }
            if (data.token) { fullText += data.token; onToken?.(data.token, fullText); }
            if (data.done) { onDone?.(fullText); return; }
          } catch { /* skip malformed */ }
        }
      }
      onDone?.(fullText);
    } catch (err) {
      if (err.name === 'AbortError') return;
      onError?.(err.message);
    }
  }

  // ── AI Chat ──────────────────────────────────────────────────
  async function sendChat(message) {
    if (!message.trim()) return;

    // Add user bubble
    appendChatBubble(message, 'user');
    chatHistory.push({ role: 'user', content: message });

    // Create AI response bubble
    const aiBubble = appendChatBubble('', 'ai streaming');
    let fullResponse = '';

    await streamFromEndpoint(
      '/api/chat',
      {
        message,
        document_context: documentContext.slice(0, 3000),
        history: chatHistory.slice(-6)
      },
      (token, full) => {
        fullResponse = full;
        aiBubble.textContent = full;
        aiBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
      },
      (full) => {
        aiBubble.classList.remove('streaming');
        chatHistory.push({ role: 'assistant', content: full });
        renderChatMarkdown(aiBubble, full);
      },
      (err) => {
        aiBubble.classList.remove('streaming');
        aiBubble.style.color = 'var(--danger)';
        aiBubble.textContent = '❌ ' + err;
      }
    );
  }

  function appendChatBubble(text, classes) {
    const messages = document.getElementById('chatMessages');
    if (!messages) return null;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${classes}`;
    bubble.textContent = text;
    messages.appendChild(bubble);
    bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return bubble;
  }

  function renderChatMarkdown(el, text) {
    // Basic markdown rendering
    let html = escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="font-family:var(--font-mono);background:var(--bg);padding:1px 4px;border-radius:3px;">$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    el.innerHTML = `<p>${html}</p>`;
  }

  // ── AI Section Actions ────────────────────────────────────────
  async function rewriteSection(text, action, sectionName = 'section') {
    if (!text.trim()) {
      showToast('⚠️ No text selected', 'error');
      return null;
    }

    const modal = document.getElementById('aiResultModal');
    const content = document.getElementById('aiResultContent');
    const title = document.getElementById('aiResultTitle');

    if (!modal || !content) return null;

    const actionLabels = {
      rewrite_academic: '✍️ Rewriting Academically…',
      improve_clarity: '💡 Improving Clarity…',
      expand: '📈 Expanding Section…',
      compress: '📉 Compressing…',
      generate_citations: '📚 Adding Citations…',
      reduce_plagiarism: '🛡️ Reducing Similarity…',
      improve_grammar: '✅ Fixing Grammar…',
      improve_flow: '🌊 Improving Flow…',
      explain: '❓ Generating Explanation…',
      detect_missing: '🔍 Detecting Gaps…',
      suggest_improvements: '⭐ Generating Suggestions…',
    };

    if (title) title.textContent = actionLabels[action] || 'AI Processing…';
    content.textContent = '';
    content.style.opacity = '0.5';
    modal.classList.add('open');

    let fullText = '';
    currentAiResult = '';

    await streamFromEndpoint(
      '/api/rewrite',
      {
        text,
        section: sectionName,
        action,
        context: documentContext.slice(0, 1000),
        format: document.getElementById('formatSelect')?.value?.toUpperCase() || 'IEEE'
      },
      (token, full) => {
        fullText = full;
        content.style.opacity = '1';
        content.textContent = full;
      },
      (full) => {
        currentAiResult = full;
        content.textContent = full;
        content.style.opacity = '1';
        if (title) title.textContent = actionLabels[action]?.replace('…', ' — Done') || 'AI Result';
      },
      (err) => {
        content.style.color = 'var(--danger)';
        content.textContent = '❌ Error: ' + err;
        content.style.opacity = '1';
      }
    );

    return fullText;
  }

  // ── Generate full paper (streaming) ──────────────────────────
  async function generatePaper(structuredData, rawText) {
    const format = document.getElementById('formatSelect')?.value?.toUpperCase() || 'IEEE';

    showLoading('Generating your research paper…');
    setLoadingProgress(10);
    const msgs = [
      'Structuring introduction…',
      'Writing methodology section…',
      'Formulating results…',
      'Writing discussion…',
      'Generating references…',
      'Polishing academic language…',
      'Finalizing paper…',
    ];
    let msgIdx = 0;
    const msgTimer = setInterval(() => {
      setLoadingMsg(msgs[msgIdx % msgs.length]);
      setLoadingProgress(10 + msgIdx * 12);
      msgIdx++;
    }, 1800);

    let fullPaper = '';
    try {
      await streamFromEndpoint(
        '/api/generate',
        {
          text: rawText || EDITOR.getText(),
          format,
          structured: structuredData || {}
        },
        (token) => {
          fullPaper += token;
        },
        (full) => {
          clearInterval(msgTimer);
          EDITOR.setContent(full);
          documentContext = full;
          EDITOR.updateOutline();
          hideLoading();
          showToast('✅ Paper generated!', 'success');
          if (window.TREE) TREE.renderDefault();
        },
        (err) => {
          clearInterval(msgTimer);
          hideLoading();
          showToast('❌ Error: ' + err, 'error');
        }
      );
    } catch (e) {
      clearInterval(msgTimer);
      hideLoading();
      showToast('❌ Generation failed: ' + e.message, 'error');
    }
  }

  // ── Generate a missing section ────────────────────────────────
  async function generateSection(sectionId, sectionLabel) {
    showToast(`⏳ Generating ${sectionLabel}…`, 'info');

    const container = document.getElementById('aiResultContent');
    const modal = document.getElementById('aiResultModal');
    const title = document.getElementById('aiResultTitle');

    if (title) title.textContent = `Generating: ${sectionLabel}`;
    if (container) container.textContent = '';
    if (modal) modal.classList.add('open');

    let fullText = '';

    await streamFromEndpoint(
      '/api/generate-section',
      {
        section: sectionId,
        context: documentContext.slice(0, 4000),
        format: document.getElementById('formatSelect')?.value?.toUpperCase() || 'IEEE'
      },
      (token, full) => {
        if (container) container.textContent = full;
      },
      (full) => {
        currentAiResult = full;
        if (title) title.textContent = `Generated: ${sectionLabel}`;
      },
      (err) => {
        if (container) {
          container.style.color = 'var(--danger)';
          container.textContent = '❌ Error: ' + err;
        }
      }
    );
  }

  // ── Quality Score ─────────────────────────────────────────────
  async function getQualityScore(paperText) {
    try {
      const response = await fetch('/api/quality-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper: paperText })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      throw new Error('Quality score failed: ' + err.message);
    }
  }

  // ── Structure Analysis ────────────────────────────────────────
  async function analyzeStructure(text) {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 6000) })
    });
    if (!response.ok) throw new Error(`Analysis failed: HTTP ${response.status}`);
    return await response.json();
  }

  function setDocumentContext(text) {
    documentContext = text;
  }

  function getCurrentResult() { return currentAiResult; }

  return {
    sendChat, appendChatBubble,
    rewriteSection,
    generatePaper,
    generateSection,
    getQualityScore,
    analyzeStructure,
    setDocumentContext,
    getCurrentResult
  };
})();
