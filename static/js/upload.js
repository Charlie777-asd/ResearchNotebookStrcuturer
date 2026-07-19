/**
 * upload.js — Multi-file drag-and-drop upload handler
 * AI Research Workspace
 */

const UPLOAD = (() => {
  let uploadedFiles = [];
  let mergedText = '';

  // ── Setup drag and drop ──────────────────────────────────────
  function init() {
    const zone = document.getElementById('sidebarUploadZone');
    const input = document.getElementById('sidebarFileInput');
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });
    if (input) {
      input.addEventListener('change', (e) => handleFiles(e.target.files));
    }
  }

  function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = { pdf: '📑', docx: '📝', doc: '📝', txt: '📄', md: '🗒️', rtf: '📃', zip: '🗜️' };
    return icons[ext] || '📄';
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    showLoading('Uploading files…');
    setLoadingProgress(10);
    setLoadingMsg('Reading uploaded documents...');

    const formData = new FormData();
    fileArray.forEach(f => formData.append('files', f));

    try {
      setLoadingProgress(30);
      setLoadingMsg('Extracting text from documents...');

      const response = await fetch('/api/upload-multi', { method: 'POST', body: formData });
      const data = await response.json();

      if (data.error) throw new Error(data.error);

      uploadedFiles = data.files;
      mergedText = buildMergedText(data.merged_text_preview, data.files);

      setLoadingProgress(60);
      setLoadingMsg('Building semantic document graph...');

      renderFileCards(data.files);
      showToast(`✅ ${data.files.filter(f => f.status === 'ok').length} file(s) processed — ${(data.total_words || 0).toLocaleString()} words`, 'success');

      // Enable AI actions
      const analyzeBtn = document.getElementById('analyzeBtn');
      const restructureBtn = document.getElementById('restructureBtn');
      const generateBtn = document.getElementById('generateBtn');
      if (analyzeBtn) analyzeBtn.disabled = false;
      if (restructureBtn) restructureBtn.disabled = false;
      if (generateBtn) generateBtn.disabled = false;

      // Store for app
      if (window.APP) {
        APP.setDocumentText(mergedText, data.files);
      }

      setLoadingProgress(80);
      setLoadingMsg('Analyzing research structure...');

      // Auto-run structure analysis
      setTimeout(async () => {
        try {
          if (window.APP) await APP.runStructureAnalysis();
        } catch (e) { /* non-fatal */ }
        hideLoading();
      }, 800);

    } catch (err) {
      hideLoading();
      showToast('❌ Upload error: ' + err.message, 'error');
      console.error('Upload error:', err);

      // Show error in file cards
      fileArray.forEach(f => {
        renderErrorFileCard(f.name, err.message);
      });
    }
  }

  function buildMergedText(preview, files) {
    return preview || files.map(f => `[Source: ${f.filename}]`).join('\n');
  }

  function renderFileCards(files) {
    const container = document.getElementById('uploadedFiles');
    if (!container) return;
    container.innerHTML = '';
    files.forEach(f => {
      const card = document.createElement('div');
      card.className = 'file-card';
      const ok = f.status === 'ok';
      card.innerHTML = `
        <div class="file-icon">${getFileIcon(f.filename)}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(f.filename)}</div>
          <div class="file-meta">${ok ? `${f.type?.toUpperCase() || 'FILE'} · ${(f.word_count || 0).toLocaleString()} words · ${f.pages || 1} page(s)` : f.error || 'Error processing'}</div>
        </div>
        <div class="file-status">${ok ? '✅' : '❌'}</div>`;
      container.appendChild(card);
    });
  }

  function renderErrorFileCard(filename, error) {
    const container = document.getElementById('uploadedFiles');
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `
      <div class="file-icon">${getFileIcon(filename)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(filename)}</div>
        <div class="file-meta" style="color:var(--danger);">${escapeHtml(error)}</div>
      </div>
      <div class="file-status">❌</div>`;
    container.appendChild(card);
  }

  function getMergedText() { return mergedText; }
  function getFiles() { return uploadedFiles; }

  return { init, handleFiles, getMergedText, getFiles };
})();
