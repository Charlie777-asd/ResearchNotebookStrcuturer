/**
 * app.js — Core Application Logic & State Management
 * AI Research Workspace
 */

/* ── Global Utilities ─────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `visible toast-${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = ''; }, 3800);
}

function showLoading(title = 'Processing your research…') {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.add('active');
  const titleEl = document.getElementById('loadingTitle');
  if (titleEl) titleEl.textContent = title;
  setLoadingProgress(0);
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('active');
}

function setLoadingProgress(pct) {
  const fill = document.getElementById('loadingProgress');
  if (fill) fill.style.width = Math.min(100, pct) + '%';
}

function setLoadingMsg(msg) {
  const el = document.getElementById('loadingMsg');
  if (el) el.textContent = msg;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Main App Controller ──────────────────────────────────────── */
const APP = (() => {
  let rawDocText = '';
  let structuredData = {};
  let analysisResult = null;
  let selectedParaText = '';
  let selectedParaAction = '';

  // Loading message rotation for the animated book
  const LOADING_MESSAGES = [
    'Reading uploaded paper...',
    'Extracting tables and figures...',
    'Understanding references...',
    'Building semantic document graph...',
    'Classifying research sections...',
    'Organizing research structure...',
    'Generating publication-ready structure...',
    'Almost finished...',
  ];
  let loadingMsgTimer = null;

  function startLoadingMessages() {
    let idx = 0;
    setLoadingMsg(LOADING_MESSAGES[0]);
    clearInterval(loadingMsgTimer);
    loadingMsgTimer = setInterval(() => {
      idx = (idx + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[idx]);
    }, 2000);
  }

  function stopLoadingMessages() {
    clearInterval(loadingMsgTimer);
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Initialize sub-modules
    if (window.EDITOR) EDITOR.init();
    if (window.UPLOAD) UPLOAD.init();
    if (window.VERSIONS) VERSIONS.init();
    if (window.TREE)   TREE.renderDefault();

    // Health check
    checkHealth();

    // Handle query params (template, upload, etc.)
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start') || '';
    if (start.startsWith('template-')) {
      loadTemplate(start.replace('template-', ''));
    } else if (start === 'upload') {
      document.getElementById('sidebarFileInput')?.click();
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', globalKeydown);

    // Autosave on title change
    const docName = document.getElementById('docName');
    if (docName) {
      docName.addEventListener('blur', () => VERSIONS.autosave());
    }

    // Format select change
    const formatSel = document.getElementById('formatSelect');
    if (formatSel) {
      formatSel.addEventListener('change', () => {
        const fmt = formatSel.value.toUpperCase();
        document.querySelector('.format-badge') && (document.querySelector('.format-badge').textContent = fmt);
        showToast(`Format set to ${fmt}`);
      });
    }

    // Equation preview
    const eqInput = document.getElementById('equationInput');
    if (eqInput) {
      eqInput.addEventListener('input', () => {
        const preview = document.getElementById('equationPreview');
        if (preview) preview.textContent = eqInput.value ? `[ ${eqInput.value} ]` : '';
      });
    }

    // Editor AI button — show on text selection
    const editorContent = document.getElementById('editorContent');
    if (editorContent) {
      editorContent.addEventListener('mouseup', showFloatingAiButton);
      editorContent.addEventListener('keyup', (e) => {
        if (e.shiftKey) showFloatingAiButton();
      });
      editorContent.addEventListener('click', (e) => {
        const popover = document.getElementById('aiPopover');
        if (popover && !popover.contains(e.target)) {
          popover.classList.add('hidden');
        }
      });
    }

    document.addEventListener('click', (e) => {
      const popover = document.getElementById('aiPopover');
      if (popover && !popover.contains(e.target)) {
        popover.classList.add('hidden');
      }
    });

    // Placeholder behavior for editor
    if (editorContent) {
      editorContent.addEventListener('focus', () => {
        if (!editorContent.textContent.trim()) editorContent.innerHTML = '';
      });
    }
  }

  function globalKeydown(e) {
    // Escape closes modals
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      document.getElementById('aiPopover')?.classList.add('hidden');
      if (window.EDITOR) EDITOR.closeFindBar();
    }
  }

  // ── Health check ──────────────────────────────────────────────
  async function checkHealth() {
    const dot = document.getElementById('wsStatusDot');
    const text = document.getElementById('wsStatusText');
    try {
      const r = await fetch('/api/health');
      const data = await r.json();
      if (data.status === 'ok') {
        if (dot) dot.className = 'ws-status-dot';
        if (text) text.textContent = data.model || 'Connected';
      } else {
        if (dot) dot.className = 'ws-status-dot error';
        if (text) text.textContent = 'API Error';
        showToast('⚠️ AI API error: ' + (data.message || 'Unknown'), 'error');
      }
    } catch {
      if (dot) dot.className = 'ws-status-dot error';
      if (text) text.textContent = 'Offline';
    }
  }

  // ── Left sidebar tabs ─────────────────────────────────────────
  function switchLeftTab(tabEl) {
    const panelId = tabEl.dataset.panel;
    document.querySelectorAll('.ws-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.ws-panel').forEach(p => p.classList.remove('active'));
    tabEl.classList.add('active');
    tabEl.setAttribute('aria-selected', 'true');
    document.getElementById(`panel-${panelId}`)?.classList.add('active');
  }

  // ── Right sidebar tabs ────────────────────────────────────────
  function switchRightTab(tabEl) {
    const panelId = tabEl.dataset.rpanel;
    document.querySelectorAll('.ws-right-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.ws-right-panel').forEach(p => p.classList.remove('active'));
    tabEl.classList.add('active');
    tabEl.setAttribute('aria-selected', 'true');
    document.getElementById(`rpanel-${panelId}`)?.classList.add('active');
  }

  // ── Document text management ──────────────────────────────────
  function setDocumentText(text, files) {
    rawDocText = text;
    if (window.AI) AI.setDocumentContext(text);

    // Update references panel
    const refsList = document.getElementById('refsList');
    if (refsList && text) {
      const refs = extractReferences(text);
      if (refs.length > 0) {
        refsList.innerHTML = refs.slice(0, 20).map(r =>
          `<div class="citation-item"><div class="citation-ref">Detected Reference</div><div class="citation-text">${escapeHtml(r)}</div></div>`
        ).join('');
      }
    }
  }

  function extractReferences(text) {
    const patterns = [
      /\[\d+\]\s+.+/g,
      /\[[\w,\s]+\d{4}\].+/g,
      /^\d+\.\s+.+(?:\(\d{4}\)|,\s*\d{4}).+/gm
    ];
    const found = new Set();
    for (const p of patterns) {
      const matches = text.match(p) || [];
      matches.forEach(m => found.add(m.trim().slice(0, 200)));
    }
    return Array.from(found);
  }

  // ── Structure analysis ────────────────────────────────────────
  async function runStructureAnalysis() {
    if (!rawDocText && !EDITOR.getText()) {
      showToast('⚠️ No document to analyze', 'error');
      return;
    }
    const text = rawDocText || EDITOR.getText();
    showToast('⏳ Analyzing document structure…', 'info');

    try {
      const result = await AI.analyzeStructure(text);
      analysisResult = result;

      if (window.TREE) TREE.render(result);

      // Update doc name from detected title
      if (result.title) {
        const docName = document.getElementById('docName');
        if (docName && docName.textContent === 'Untitled Research Paper') {
          docName.textContent = result.title;
        }
      }

      // Show keywords
      if (result.keywords?.length > 0) {
        showToast(`✅ Structure analyzed — ${result.sections?.length || 0} sections detected`, 'success');
      } else {
        showToast('✅ Document structure analyzed', 'success');
      }

      return result;
    } catch (err) {
      showToast('❌ Analysis failed: ' + err.message, 'error');
      throw err;
    }
  }

  // ── Smart restructure ─────────────────────────────────────────
  async function restructureDocument() {
    if (!rawDocText) {
      showToast('⚠️ Upload a document first', 'error');
      return;
    }
    showLoading('Smart restructuring your document…');
    startLoadingMessages();

    const format = document.getElementById('formatSelect')?.value?.toUpperCase() || 'IEEE';

    try {
      // Use generate with the raw text
      await AI.generatePaper(structuredData, rawDocText);
      stopLoadingMessages();
    } catch (err) {
      stopLoadingMessages();
      hideLoading();
      showToast('❌ Restructure failed: ' + err.message, 'error');
    }
  }

  // ── Generate full paper ───────────────────────────────────────
  async function generatePaper() {
    showLoading('Generating your research paper…');
    startLoadingMessages();
    setLoadingProgress(5);
    try {
      await AI.generatePaper(structuredData, rawDocText || EDITOR.getText());
      stopLoadingMessages();
    } catch (err) {
      stopLoadingMessages();
      hideLoading();
      showToast('❌ Generation failed: ' + err.message, 'error');
    }
  }

  // ── Generate a specific section ───────────────────────────────
  async function generateSection(sectionId, sectionLabel) {
    await AI.generateSection(sectionId, sectionLabel);
  }

  // ── AI paragraph actions ──────────────────────────────────────
  function showFloatingAiButton() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    const selectedText = sel.toString().trim();
    if (selectedText.length < 20) return;

    selectedParaText = selectedText;
    EDITOR.saveSelection();

    const popover = document.getElementById('aiPopover');
    if (!popover) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const top  = Math.min(window.innerHeight - 350, Math.max(10, rect.bottom + 8));
    const left = Math.max(10, Math.min(window.innerWidth - 240, rect.left));

    popover.style.top  = `${top}px`;
    popover.style.left = `${left}px`;
    popover.classList.remove('hidden');
  }

  async function aiAction(action) {
    closeAiPopover();
    if (!selectedParaText) {
      showToast('⚠️ Select some text first', 'error');
      return;
    }
    EDITOR.restoreSelection();
    const sectionName = detectSectionFromContext(selectedParaText);
    await AI.rewriteSection(selectedParaText, action, sectionName);
  }

  function closeAiPopover() {
    document.getElementById('aiPopover')?.classList.add('hidden');
  }

  function detectSectionFromContext(text) {
    const lower = text.toLowerCase();
    if (lower.includes('method') || lower.includes('procedure')) return 'Methodology';
    if (lower.includes('result') || lower.includes('accuracy') || lower.includes('performance')) return 'Results';
    if (lower.includes('discuss') || lower.includes('implication')) return 'Discussion';
    if (lower.includes('conclude') || lower.includes('conclusion')) return 'Conclusion';
    if (lower.includes('introduc') || lower.includes('background')) return 'Introduction';
    if (lower.includes('related') || lower.includes('literature') || lower.includes('survey')) return 'Literature Review';
    return 'section';
  }

  function applyAiResult() {
    const result = AI.getCurrentResult();
    if (!result) { closeModal('aiResultModal'); return; }
    EDITOR.restoreSelection();
    document.execCommand('insertText', false, result);
    closeModal('aiResultModal');
    EDITOR.updateWordCount();
    EDITOR.updateOutline();
    showToast('✅ AI changes applied', 'success');
  }

  // ── Quick chat shortcuts ──────────────────────────────────────
  async function quickChat(message) {
    switchRightTab(document.querySelector('[data-rpanel="ai"]'));
    const input = document.getElementById('chatInput');
    if (input) input.value = message;
    await sendChat();
  }

  async function sendChat() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    input.style.height = 'auto';
    await AI.sendChat(message);
  }

  function chatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
    // Auto-resize textarea
    const input = document.getElementById('chatInput');
    if (input) {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
  }

  // ── Quality Score ─────────────────────────────────────────────
  async function scoreDocument() {
    const text = EDITOR.getText();
    if (!text.trim()) {
      showToast('⚠️ Write or generate a paper first', 'error');
      return;
    }

    switchRightTab(document.querySelector('[data-rpanel="score"]'));
    document.getElementById('scoreEmptyState')?.classList.add('hidden');
    document.getElementById('scoreContent')?.classList.remove('hidden');
    showToast('⏳ Analyzing research quality…', 'info');

    try {
      const score = await AI.getQualityScore(text);
      renderQualityScore(score);
      showToast('✅ Quality analysis complete', 'success');
    } catch (err) {
      showToast('❌ Score error: ' + err.message, 'error');
      document.getElementById('scoreEmptyState')?.classList.remove('hidden');
      document.getElementById('scoreContent')?.classList.add('hidden');
    }
  }

  function renderQualityScore(data) {
    const overall = data.overall || data.score || 0;

    // Score ring
    const ring = document.getElementById('scoreRing');
    if (ring) ring.style.setProperty('--score', overall);

    const valEl = document.getElementById('scoreVal');
    if (valEl) valEl.textContent = overall;

    const gradeEl = document.getElementById('scoreGrade');
    if (gradeEl) gradeEl.textContent = data.grade || getGrade(overall);

    const readinessEl = document.getElementById('scoreReadiness');
    if (readinessEl) readinessEl.textContent = data.journal_readiness || '';

    const acceptEl = document.getElementById('acceptanceChance');
    if (acceptEl) acceptEl.textContent = data.estimated_acceptance_chance || '';

    // Score breakdown bars
    const barsEl = document.getElementById('scoreBars');
    if (barsEl && data.breakdown) {
      const bars = [
        { label: 'Structure',    val: data.breakdown.structure_completeness, max: 15 },
        { label: 'Citations',    val: data.breakdown.citation_quality, max: 10 },
        { label: 'Novelty',      val: data.breakdown.novelty, max: 15 },
        { label: 'Grammar',      val: data.breakdown.grammar_language, max: 10 },
        { label: 'Academic Tone',val: data.breakdown.academic_tone, max: 10 },
        { label: 'Methodology',  val: data.breakdown.methodology, max: 15 },
        { label: 'Results',      val: data.breakdown.result_clarity, max: 10 },
        { label: 'Flow',         val: data.breakdown.logical_flow, max: 10 },
      ];
      barsEl.innerHTML = bars.map(b => `
        <div class="score-bar-item">
          <div class="score-bar-header">
            <span>${b.label}</span>
            <span>${b.val || 0}/${b.max}</span>
          </div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width:${b.max > 0 ? ((b.val || 0) / b.max * 100) : 0}%;"></div>
          </div>
        </div>`).join('');
    } else if (barsEl && (data.clarity !== undefined)) {
      // Legacy score format
      const bars = [
        { label: 'Clarity',      val: data.clarity || 0,      max: 25 },
        { label: 'Methodology',  val: data.methodology || 0,  max: 25 },
        { label: 'Completeness', val: data.completeness || 0, max: 25 },
        { label: 'Originality',  val: data.originality || 0,  max: 25 },
      ];
      barsEl.innerHTML = bars.map(b => `
        <div class="score-bar-item">
          <div class="score-bar-header"><span>${b.label}</span><span>${b.val}/${b.max}</span></div>
          <div class="score-bar-track"><div class="score-bar-fill" style="width:${(b.val/b.max*100)}%;"></div></div>
        </div>`).join('');
    }

    // Strengths
    const strengthsEl = document.getElementById('strengthsList');
    if (strengthsEl) {
      const strengths = data.strengths || data.feedback || [];
      strengthsEl.innerHTML = strengths.map(s =>
        `<li class="feedback-item">${escapeHtml(s)}</li>`).join('');
    }

    // Recommendations
    const recsEl = document.getElementById('recommendationsList');
    if (recsEl) {
      const recs = data.recommendations || data.critical_issues?.map(i => ({ priority: 'High', action: i })) || [];
      recsEl.innerHTML = recs.map(r => {
        const prio = (r.priority || 'Medium').toLowerCase();
        return `<div class="rec-item ${prio}">
          <span class="rec-priority ${prio}">${r.priority || 'Medium'}</span>
          <div>${escapeHtml(r.action || r)}${r.section ? ` <em style="color:var(--text-light);">(${r.section})</em>` : ''}</div>
        </div>`;
      }).join('');
    }
  }

  function getGrade(score) {
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
  }

  // ── Citation conversion ───────────────────────────────────────
  async function convertCitations(type) {
    const text = EDITOR.getText();
    if (!text) { showToast('⚠️ Nothing to convert', 'error'); return; }

    const actionMap = { 'apa-ieee': 'convert_apa_ieee', 'ieee-apa': 'convert_ieee_apa', 'apa-nature': 'convert_apa_ieee' };
    showToast('⏳ Converting citations…', 'info');

    const modal = document.getElementById('aiResultModal');
    const content = document.getElementById('aiResultContent');
    const titleEl = document.getElementById('aiResultTitle');
    if (titleEl) titleEl.textContent = `Converting Citations (${type.replace('-', ' → ').toUpperCase()})`;
    if (content) content.textContent = '';
    if (modal) modal.classList.add('open');

    await AI.rewriteSection(text.slice(0, 3000), actionMap[type] || 'convert_apa_ieee', 'References');
  }

  // ── Load template ─────────────────────────────────────────────
  async function loadTemplate(templateId) {
    showLoading('Loading template…');
    try {
      const r = await fetch('/api/templates');
      const data = await r.json();
      const tmpl = data.templates.find(t => t.id === templateId);
      if (!tmpl) { hideLoading(); return; }

      const sections = tmpl.sections.map(s =>
        `<h2>${s}</h2><p>[Write your ${s} here...]</p><p></p>`
      ).join('\n');

      const docContent = `<h1>${tmpl.name}</h1>
<p style="text-align:center;font-style:italic;color:var(--text-muted);">Template: ${tmpl.format} Format</p>
<hr>
${sections}`;

      EDITOR.setContent(docContent);

      const docName = document.getElementById('docName');
      if (docName) docName.textContent = `New ${tmpl.name}`;

      const formatSel = document.getElementById('formatSelect');
      if (formatSel) {
        const formatMap = { 'IEEE': 'ieee', 'APA': 'apa', 'Nature': 'nature', 'ACM': 'acm', 'Thesis': 'apa', 'Review': 'apa' };
        formatSel.value = formatMap[tmpl.format] || 'ieee';
      }

      TREE.renderDefault();
      EDITOR.updateOutline();
      hideLoading();
      showToast(`✅ Template loaded: ${tmpl.name}`, 'success');
    } catch (err) {
      hideLoading();
      showToast('❌ Template error: ' + err.message, 'error');
    }
  }

  // ── Save version modal ────────────────────────────────────────
  function saveVersion() {
    document.getElementById('saveVersionModal')?.classList.add('open');
    const input = document.getElementById('versionNameInput');
    if (input) {
      const count = VERSIONS.getVersions().length;
      input.value = `Draft v${count + 1}`;
      setTimeout(() => { input.select(); }, 100);
    }
  }

  function confirmSaveVersion() {
    const name = document.getElementById('versionNameInput')?.value?.trim() || '';
    VERSIONS.save(name);
    closeModal('saveVersionModal');
  }

  // ── Modals ────────────────────────────────────────────────────
  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  // ── Homepage utility ──────────────────────────────────────────
  function initHomePage() {
    checkHealthHome();
  }

  async function checkHealthHome() {
    try {
      const r = await fetch('/api/health');
      const data = await r.json();
      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      if (dot) dot.className = data.status === 'ok' ? 'ws-status-dot' : 'ws-status-dot error';
      if (text) text.textContent = data.status === 'ok' ? (data.model || 'Connected') : 'Error';
    } catch {
      const dot = document.getElementById('statusDot');
      if (dot) dot.className = 'ws-status-dot error';
    }
  }

  // ── Expose public API ─────────────────────────────────────────
  return {
    init,
    checkHealth,
    switchLeftTab,
    switchRightTab,
    setDocumentText,
    runStructureAnalysis,
    restructureDocument,
    generatePaper,
    generateSection,
    showFloatingAiButton,
    aiAction,
    closeAiPopover,
    applyAiResult,
    quickChat,
    sendChat,
    chatKeydown,
    scoreDocument,
    convertCitations,
    loadTemplate,
    saveVersion,
    confirmSaveVersion,
    closeModal,
    initHomePage
  };
})();

/* ── Bootstrap on DOM ready ───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Detect page context
  const isWorkspace = !!document.getElementById('editorContent');
  const isHome = document.body.classList.contains('home-page');

  if (isWorkspace) {
    APP.init();
  } else if (isHome) {
    APP.initHomePage();
  }
});
