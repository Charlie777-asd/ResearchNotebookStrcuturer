/**
 * editor.js — Rich Text Editor Engine
 * AI Research Workspace
 */

const EDITOR = (() => {
  let findMatches = [];
  let findIndex = 0;
  let lastRange = null;
  let currentHighlightColor = '#FFF8E7';
  let undoStack = [];
  let redoStack = [];
  let autoSaveTimer = null;

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    const content = document.getElementById('editorContent');
    if (!content) return;

    // Placeholder behavior
    content.addEventListener('focus', () => {
      if (content.innerHTML.trim() === '') {
        content.innerHTML = '';
      }
    });

    // Keyboard shortcuts
    content.addEventListener('keydown', handleKeydown);
    content.addEventListener('input', onInput);
    content.addEventListener('mouseup', onSelectionChange);
    content.addEventListener('keyup', onSelectionChange);

    // Auto-save
    content.addEventListener('input', () => {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        VERSIONS.autosave();
        updateWordCount();
        updateOutline();
      }, 2000);
    });

    // Paste — strip rich formatting from external sources
    content.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    // Initial word count
    updateWordCount();
  }

  function handleKeydown(e) {
    const content = document.getElementById('editorContent');
    // Ctrl/Cmd shortcuts
    if ((e.ctrlKey || e.metaKey)) {
      switch(e.key.toLowerCase()) {
        case 'b': e.preventDefault(); format('bold'); break;
        case 'i': e.preventDefault(); format('italic'); break;
        case 'u': e.preventDefault(); format('underline'); break;
        case 'f': e.preventDefault(); toggleFindBar(); break;
        case 'z': e.preventDefault(); e.shiftKey ? redo() : undo(); break;
        case 'y': e.preventDefault(); redo(); break;
        case 's': e.preventDefault(); VERSIONS.autosave(); showToast('✅ Saved', 'success'); break;
      }
    }

    // Tab indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
    }
  }

  function onInput() {
    const content = document.getElementById('editorContent');
    // Save snapshot for undo (debounced)
    undoStack.push(content.innerHTML);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];

    // Update word count
    updateWordCount();
  }

  function onSelectionChange() {
    updateToolbarState();
    showAiButton();
  }

  // ── Formatting ───────────────────────────────────────────────
  function format(command, value = null) {
    document.execCommand(command, false, value);
    document.getElementById('editorContent')?.focus();
    updateToolbarState();
  }

  function setHeading(tag) {
    if (!tag) {
      format('formatBlock', 'p');
    } else {
      format('formatBlock', tag);
    }
    document.getElementById('headingSelect').value = tag;
  }

  function toggleHighlight() {
    format('hiliteColor', currentHighlightColor);
  }

  function removeFormatting() {
    format('removeFormat');
    format('formatBlock', 'p');
  }

  function increaseIndent() { format('indent'); }
  function decreaseIndent() { format('outdent'); }

  function updateToolbarState() {
    const cmds = ['bold', 'italic', 'underline', 'strikeThrough'];
    cmds.forEach(cmd => {
      const btn = document.getElementById(`tb-${cmd.toLowerCase().replace('strikethrough','strike')}`);
      if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  // ── Table Insert ─────────────────────────────────────────────
  function insertTable() {
    document.getElementById('tableModal')?.classList.add('open');
  }

  function confirmInsertTable() {
    const rows = parseInt(document.getElementById('tableRows')?.value || '3');
    const cols = parseInt(document.getElementById('tableCols')?.value || '3');
    const caption = document.getElementById('tableCaption')?.value || '';

    let html = '';
    if (caption) {
      html += `<p style="text-align:center;font-style:italic;font-size:10pt;margin-bottom:4px;">${escapeHtml(caption)}</p>`;
    }
    html += '<table>';
    // Header row
    html += '<tr>' + Array(cols).fill(0).map((_, i) => `<th>Column ${i + 1}</th>`).join('') + '</tr>';
    // Data rows
    for (let r = 0; r < rows - 1; r++) {
      html += '<tr>' + Array(cols).fill(0).map(() => '<td>&nbsp;</td>').join('') + '</tr>';
    }
    html += '</table><p></p>';

    restoreSelection();
    format('insertHTML', html);
    APP.closeModal('tableModal');
    showToast('✅ Table inserted');
  }

  // ── Image Insert ─────────────────────────────────────────────
  function insertImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const html = `<img src="${ev.target.result}" alt="Research figure" style="max-width:100%;border-radius:4px;margin:8px 0;" /><p></p>`;
        restoreSelection();
        format('insertHTML', html);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // ── Equation Insert ──────────────────────────────────────────
  function insertEquation() {
    document.getElementById('equationModal')?.classList.add('open');
    const input = document.getElementById('equationInput');
    if (input) {
      input.addEventListener('input', () => {
        const preview = document.getElementById('equationPreview');
        if (preview) preview.textContent = input.value ? `[ ${input.value} ]` : '';
      });
    }
  }

  function confirmInsertEquation() {
    const eq = document.getElementById('equationInput')?.value?.trim() || '';
    if (!eq) return;
    const html = `<span class="equation" style="font-family:var(--font-mono);background:var(--highlight);padding:2px 8px;border-radius:4px;font-size:11pt;border:1px solid var(--highlight-border);" contenteditable="false"> ${escapeHtml(eq)} </span>&nbsp;`;
    restoreSelection();
    format('insertHTML', html);
    APP.closeModal('equationModal');
    document.getElementById('equationInput').value = '';
    showToast('✅ Equation inserted');
  }

  // ── Code Block ───────────────────────────────────────────────
  function insertCodeBlock() {
    const html = '<pre><code>// Paste your code here\n</code></pre><p></p>';
    restoreSelection();
    format('insertHTML', html);
    showToast('✅ Code block inserted');
  }

  // ── Find & Replace ────────────────────────────────────────────
  function toggleFindBar() {
    const bar = document.getElementById('findBar');
    if (!bar) return;
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) {
      document.getElementById('findInput')?.focus();
    }
  }

  function closeFindBar() {
    document.getElementById('findBar')?.classList.add('hidden');
    clearHighlights();
  }

  function clearHighlights() {
    const content = document.getElementById('editorContent');
    if (!content) return;
    content.innerHTML = content.innerHTML.replace(/<mark class="find-highlight"[^>]*>(.*?)<\/mark>/gi, '$1');
  }

  function findAll() {
    const term = document.getElementById('findInput')?.value?.trim();
    if (!term) return [];
    clearHighlights();
    const content = document.getElementById('editorContent');
    if (!content) return [];

    const regex = new RegExp(escapeRegex(term), 'gi');
    content.innerHTML = content.innerHTML.replace(regex, (match) =>
      `<mark class="find-highlight" style="background:#FFF176;border-radius:2px;">${match}</mark>`
    );
    findMatches = Array.from(content.querySelectorAll('.find-highlight'));
    updateFindCount();
    return findMatches;
  }

  function findNext() {
    const matches = findAll();
    if (matches.length === 0) return;
    findIndex = (findIndex + 1) % matches.length;
    scrollToMatch(findIndex, matches);
  }

  function findPrev() {
    const matches = findAll();
    if (matches.length === 0) return;
    findIndex = (findIndex - 1 + matches.length) % matches.length;
    scrollToMatch(findIndex, matches);
  }

  function scrollToMatch(idx, matches) {
    matches.forEach((m, i) => {
      m.style.background = i === idx ? '#FF9800' : '#FFF176';
    });
    matches[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateFindCount(idx, matches.length);
  }

  function updateFindCount(idx = 0, total = 0) {
    const el = document.getElementById('findCount');
    if (el) el.textContent = total > 0 ? `${idx + 1} of ${total}` : 'No results';
  }

  function replaceOne() {
    const term = document.getElementById('findInput')?.value?.trim();
    const replacement = document.getElementById('replaceInput')?.value || '';
    if (!term) return;
    const selected = window.getSelection();
    if (selected && selected.focusNode) {
      const node = selected.focusNode.parentElement;
      if (node?.classList.contains('find-highlight')) {
        node.replaceWith(document.createTextNode(replacement));
        findAll();
        showToast('✅ Replaced 1 occurrence');
      }
    }
  }

  function replaceAll() {
    const term = document.getElementById('findInput')?.value?.trim();
    const replacement = document.getElementById('replaceInput')?.value || '';
    if (!term) return;
    clearHighlights();
    const content = document.getElementById('editorContent');
    if (!content) return;
    const regex = new RegExp(escapeRegex(term), 'gi');
    const count = (content.innerHTML.match(regex) || []).length;
    content.innerHTML = content.innerHTML.replace(regex, escapeHtml(replacement));
    showToast(`✅ Replaced ${count} occurrence(s)`);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ── Undo / Redo ──────────────────────────────────────────────
  function undo() {
    const content = document.getElementById('editorContent');
    if (!content || undoStack.length < 2) { document.execCommand('undo'); return; }
    redoStack.push(undoStack.pop());
    const prev = undoStack[undoStack.length - 1];
    if (prev !== undefined) {
      content.innerHTML = prev;
      updateWordCount();
    }
  }

  function redo() {
    const content = document.getElementById('editorContent');
    if (!content || redoStack.length === 0) { document.execCommand('redo'); return; }
    const next = redoStack.pop();
    content.innerHTML = next;
    undoStack.push(next);
    updateWordCount();
  }

  // ── Selection helpers ────────────────────────────────────────
  function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) lastRange = sel.getRangeAt(0);
  }

  function restoreSelection() {
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (lastRange) sel.addRange(lastRange);
  }

  function getSelectedText() {
    return window.getSelection()?.toString() || '';
  }

  // ── Word Count ───────────────────────────────────────────────
  function updateWordCount() {
    const content = document.getElementById('editorContent');
    const el = document.getElementById('wordCount');
    if (!content || !el) return;
    const text = content.innerText || content.textContent || '';
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    el.textContent = words.toLocaleString();
    return words;
  }

  // ── AI Button on paragraph ───────────────────────────────────
  function showAiButton() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    saveSelection();
  }

  // ── Document Outline ─────────────────────────────────────────
  function updateOutline() {
    const content = document.getElementById('editorContent');
    const outline = document.getElementById('docOutline');
    if (!content || !outline) return;

    const headings = content.querySelectorAll('h1, h2, h3');
    if (headings.length === 0) {
      outline.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:16px 0;">Outline will appear as you write.</div>';
      return;
    }

    outline.innerHTML = '';
    headings.forEach((h, i) => {
      const level = h.tagName.toLowerCase();
      const item = document.createElement('button');
      item.className = `outline-item ${level}`;
      item.setAttribute('role', 'button');
      item.innerHTML = `<div class="outline-indicator"></div>${escapeHtml(h.textContent.trim() || `Section ${i + 1}`)}`;
      item.onclick = () => {
        h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        h.style.outline = '2px solid var(--accent)';
        setTimeout(() => h.style.outline = '', 1500);
      };
      outline.appendChild(item);
    });
  }

  // ── Set content from AI ──────────────────────────────────────
  function setContent(html) {
    const content = document.getElementById('editorContent');
    if (!content) return;
    // Convert markdown-like headings to HTML
    let processed = html
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    content.innerHTML = `<p>${processed}</p>`;
    updateWordCount();
    updateOutline();
    undoStack.push(content.innerHTML);
  }

  function appendContent(text) {
    const content = document.getElementById('editorContent');
    if (!content) return;
    content.innerHTML += text;
    updateWordCount();
  }

  function getContent() {
    return document.getElementById('editorContent')?.innerHTML || '';
  }

  function getText() {
    const content = document.getElementById('editorContent');
    return content?.innerText || content?.textContent || '';
  }

  return {
    init,
    format, setHeading, toggleHighlight, removeFormatting,
    increaseIndent, decreaseIndent,
    insertTable, confirmInsertTable,
    insertImage,
    insertEquation, confirmInsertEquation,
    insertCodeBlock,
    toggleFindBar, closeFindBar,
    findNext, findPrev, replaceOne, replaceAll,
    undo, redo,
    setContent, appendContent, getContent, getText,
    updateWordCount, updateOutline,
    saveSelection, restoreSelection, getSelectedText
  };
})();
