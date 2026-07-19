/**
 * versions.js — Version Control System
 * AI Research Workspace
 */

const VERSIONS = (() => {
  const STORAGE_KEY = 'researchai_versions';
  const AUTOSAVE_KEY = 'researchai_autosave';
  let versions = [];

  // ── Load ─────────────────────────────────────────────────────
  function init() {
    try {
      versions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      renderVersionList();
    } catch { versions = []; }
  }

  // ── Autosave ─────────────────────────────────────────────────
  function autosave() {
    try {
      const content = EDITOR.getContent();
      const docName = document.getElementById('docName')?.textContent?.trim() || 'Untitled';
      const snapshot = {
        id: 'autosave',
        name: 'Autosave',
        docName,
        content,
        timestamp: Date.now(),
        wordCount: EDITOR.updateWordCount()
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
      updateSaveIndicator('saved');
    } catch { /* storage might be full */ }
  }

  function updateSaveIndicator(state) {
    const dot = document.getElementById('wsStatusDot');
    const text = document.getElementById('wsStatusText');
    if (!dot || !text) return;
    if (state === 'saving') {
      dot.className = 'ws-status-dot loading';
      text.textContent = 'Saving…';
    } else if (state === 'saved') {
      dot.className = 'ws-status-dot';
      text.textContent = 'Saved';
      setTimeout(() => {
        if (text.textContent === 'Saved') text.textContent = 'Connected';
      }, 2000);
    }
  }

  // ── Save named version ────────────────────────────────────────
  function save(name) {
    const content = EDITOR.getContent();
    const docName = document.getElementById('docName')?.textContent?.trim() || 'Untitled';
    const version = {
      id: Date.now().toString(),
      name: name || `Version ${versions.length + 1}`,
      docName,
      content,
      timestamp: Date.now(),
      wordCount: EDITOR.updateWordCount(),
      format: document.getElementById('formatSelect')?.value || 'ieee'
    };
    versions.unshift(version);
    if (versions.length > 20) versions.pop();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
    renderVersionList();
    showToast(`✅ Saved: ${version.name}`, 'success');
    return version;
  }

  // ── Restore version ───────────────────────────────────────────
  function restore(id) {
    const version = versions.find(v => v.id === id);
    if (!version) return;
    if (!confirm(`Restore "${version.name}"? Your current content will be replaced.`)) return;

    EDITOR.setContent(version.content);
    const docName = document.getElementById('docName');
    if (docName) docName.textContent = version.docName;
    if (version.format) {
      const sel = document.getElementById('formatSelect');
      if (sel) sel.value = version.format;
    }
    showToast(`✅ Restored: ${version.name}`, 'success');
    renderVersionList();
  }

  // ── Delete version ────────────────────────────────────────────
  function remove(id) {
    versions = versions.filter(v => v.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
    renderVersionList();
  }

  // ── Render list ───────────────────────────────────────────────
  function renderVersionList() {
    const container = document.getElementById('versionsList');
    if (!container) return;
    container.innerHTML = '';

    if (versions.length === 0) {
      container.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--text-muted);text-align:center;">No saved versions yet.</div>';
      return;
    }

    versions.forEach((v, idx) => {
      const item = document.createElement('div');
      item.className = `version-item ${idx === 0 ? 'current' : ''}`;
      item.setAttribute('role', 'listitem');

      const date = new Date(v.timestamp);
      const timeStr = formatRelativeTime(date);

      item.innerHTML = `
        <div class="version-dot"></div>
        <div class="version-name truncate">${escapeHtml(v.name)}</div>
        <div class="version-date">${timeStr}</div>`;

      // Restore button on hover
      item.title = `${v.wordCount || 0} words · Click to restore`;
      item.onclick = () => restore(v.id);

      // Delete button
      const del = document.createElement('button');
      del.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-light);opacity:0;transition:opacity 0.2s;padding:0 2px;';
      del.textContent = '✕';
      del.title = 'Delete version';
      del.onclick = (e) => { e.stopPropagation(); remove(v.id); };
      item.appendChild(del);

      item.addEventListener('mouseenter', () => del.style.opacity = '1');
      item.addEventListener('mouseleave', () => del.style.opacity = '0');

      container.appendChild(item);
    });
  }

  function formatRelativeTime(date) {
    const now = Date.now();
    const diff = now - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  function getVersions() { return versions; }
  function getLatest() { return versions[0] || null; }

  return { init, autosave, save, restore, remove, renderVersionList, getVersions, getLatest };
})();
