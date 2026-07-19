/**
 * document-tree.js — Research Structure Tree
 * AI Research Workspace
 */

const TREE = (() => {
  // All canonical research sections
  const SECTIONS = [
    { id: 'title',          label: 'Title',               icon: '📌' },
    { id: 'abstract',       label: 'Abstract',            icon: '📋' },
    { id: 'keywords',       label: 'Keywords',            icon: '🏷️' },
    { id: 'introduction',   label: 'Introduction',        icon: '📖' },
    { id: 'literature_review', label: 'Literature Review', icon: '📚' },
    { id: 'research_gap',   label: 'Research Gap',        icon: '🔍' },
    { id: 'problem_statement', label: 'Problem Statement', icon: '❓' },
    { id: 'objectives',     label: 'Objectives',          icon: '🎯' },
    { id: 'hypothesis',     label: 'Hypothesis',          icon: '💡' },
    { id: 'methodology',    label: 'Methodology',         icon: '⚙️' },
    { id: 'dataset',        label: 'Dataset',             icon: '🗄️' },
    { id: 'algorithms',     label: 'Algorithms/Architecture', icon: '🏗️' },
    { id: 'implementation', label: 'Implementation',      icon: '💻' },
    { id: 'experimental_setup', label: 'Experimental Setup', icon: '🧪' },
    { id: 'results',        label: 'Results',             icon: '📊' },
    { id: 'discussion',     label: 'Discussion',          icon: '💬' },
    { id: 'limitations',    label: 'Limitations',         icon: '⚠️' },
    { id: 'future_scope',   label: 'Future Scope',        icon: '🚀' },
    { id: 'conclusion',     label: 'Conclusion',          icon: '✅' },
    { id: 'acknowledgements', label: 'Acknowledgements',  icon: '🙏' },
    { id: 'references',     label: 'References',          icon: '📎' },
    { id: 'appendix',       label: 'Appendix',            icon: '📑' },
  ];

  let analysisData = null;
  let activeSection = null;

  function render(analysis) {
    analysisData = analysis;
    const container = document.getElementById('structureTree');
    if (!container) return;

    container.innerHTML = '';

    // Overall completion badge
    const completion = analysis?.overall_completion || 0;
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 4px 12px;display:flex;align-items:center;justify-content:space-between;';
    header.innerHTML = `
      <span style="font-size:12px;font-weight:600;color:var(--text-muted);">
        ${analysis?.document_type || 'Research Document'}
      </span>
      <span class="badge badge-accent">${completion}% complete</span>`;
    container.appendChild(header);

    // Section items
    SECTIONS.forEach(section => {
      const sectionData = findSection(analysis, section.id);
      const node = buildNode(section, sectionData);
      container.appendChild(node);
    });

    // Missing sections alert
    const missing = analysis?.missing_sections || [];
    if (missing.length > 0) {
      const alert = document.createElement('div');
      alert.style.cssText = 'margin-top:12px;padding:8px 10px;background:var(--warning-light);border-radius:var(--radius);border-left:3px solid var(--warning);';
      alert.innerHTML = `
        <div style="font-size:10px;font-weight:700;color:var(--warning);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Missing Sections (${missing.length})</div>
        <div style="font-size:11px;color:var(--text-muted);">${missing.slice(0,5).join(', ')}${missing.length > 5 ? ` +${missing.length - 5} more` : ''}</div>`;
      container.appendChild(alert);
    }
  }

  function findSection(analysis, id) {
    if (!analysis?.sections) return null;
    return analysis.sections.find(s =>
      s.id === id ||
      s.id?.replace(/[_ ]/g,'').toLowerCase() === id.replace(/[_ ]/g,'').toLowerCase() ||
      s.label?.toLowerCase().includes(id.replace(/_/g,' '))
    ) || null;
  }

  function buildNode(section, data) {
    const present = data?.present ?? false;
    const completion = data?.completion ?? 0;
    const confidence = data?.confidence ?? 0;
    const wordCount = data?.word_count ?? 0;

    const node = document.createElement('div');
    node.className = `tree-node ${present ? 'present' : 'missing'}`;
    node.setAttribute('role', 'treeitem');
    node.setAttribute('aria-label', `${section.label}: ${present ? 'present' : 'missing'}, ${completion}% complete`);
    node.dataset.sectionId = section.id;
    node.title = data?.summary || (present ? 'Click to navigate to section' : 'Section not found in document');

    // Completion ring
    const ring = document.createElement('div');
    ring.className = 'tree-completion';
    ring.style.setProperty('--pct', completion);
    const ringText = document.createElement('span');
    ringText.className = 'tree-completion-text';
    ringText.textContent = present ? completion : '0';
    ring.appendChild(ringText);

    // Content
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;min-width:0;';
    content.innerHTML = `
      <div style="font-size:12px;font-weight:${present ? '600' : '400'};color:${present ? 'var(--text)' : 'var(--text-light)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${section.icon} ${section.label}
      </div>
      ${present && wordCount > 0 ? `<div style="font-size:10px;color:var(--text-light);margin-top:1px;">${wordCount} words · ${confidence}% confidence</div>` : ''}`;

    // AI suggestion badge
    if (data?.suggestions?.length > 0) {
      const badge = document.createElement('div');
      badge.innerHTML = `<span class="badge badge-warning" style="font-size:9px;padding:2px 5px;" title="${escapeHtml(data.suggestions[0])}">💡 ${data.suggestions.length}</span>`;
      node.appendChild(ring);
      node.appendChild(content);
      node.appendChild(badge);
    } else {
      node.appendChild(ring);
      node.appendChild(content);
    }

    // Missing indicator
    if (!present) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-ghost btn-sm';
      addBtn.style.cssText = 'font-size:10px;padding:2px 6px;';
      addBtn.textContent = '+ Add';
      addBtn.title = `Generate ${section.label} section`;
      addBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.APP) APP.generateSection(section.id, section.label);
      };
      node.appendChild(addBtn);
    }

    node.onclick = () => scrollToSection(section.id, node);

    return node;
  }

  function scrollToSection(sectionId, nodeEl) {
    // Update active state
    document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
    if (nodeEl) nodeEl.classList.add('active');
    activeSection = sectionId;

    // Find heading in editor
    const editor = document.getElementById('editorContent');
    if (!editor) return;
    const headings = editor.querySelectorAll('h1, h2, h3, h4');
    for (const h of headings) {
      if (h.textContent.toLowerCase().includes(sectionId.replace(/_/g, ' ')) ||
          h.textContent.toLowerCase().includes(sectionId.replace(/_review/i, ' Review'))) {
        h.scrollIntoView({ behavior: 'smooth', block: 'center' });
        h.style.background = 'var(--highlight)';
        setTimeout(() => { h.style.background = ''; }, 2000);
        return;
      }
    }
  }

  function renderDefault() {
    const container = document.getElementById('structureTree');
    if (!container) return;
    container.innerHTML = '';
    SECTIONS.slice(0, 10).forEach(section => {
      const node = buildNode(section, null);
      container.appendChild(node);
    });
    const more = document.createElement('div');
    more.style.cssText = 'font-size:11px;color:var(--text-light);text-align:center;padding:8px;';
    more.textContent = `+${SECTIONS.length - 10} more sections`;
    container.appendChild(more);
  }

  function getSections() { return SECTIONS; }
  function getAnalysis() { return analysisData; }

  return { render, renderDefault, getSections, getAnalysis, scrollToSection };
})();
