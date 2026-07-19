/**
 * export.js — Document Export Engine
 * AI Research Workspace
 */

const EXPORT = (() => {

  function getDocTitle() {
    return document.getElementById('docName')?.textContent?.trim() || 'Research Paper';
  }

  function getEditorHTML() {
    return document.getElementById('editorContent')?.innerHTML || '';
  }

  function getEditorText() {
    return document.getElementById('editorContent')?.innerText || '';
  }

  function getFormat() {
    return document.getElementById('formatSelect')?.value?.toUpperCase() || 'IEEE';
  }

  function includeTOC()    { return document.getElementById('exportTOC')?.checked ?? true; }
  function includeRefs()   { return document.getElementById('exportRefs')?.checked ?? true; }
  function includePageNums(){ return document.getElementById('exportPgNums')?.checked ?? true; }

  // ── PDF Export ───────────────────────────────────────────────
  function toPDF() {
    showToast('⏳ Generating PDF…', 'info');
    try {
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        toPDFFallback();
        return;
      }

      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const title = getDocTitle();
      const text = getEditorText();
      const format = getFormat();
      const margin = 20;
      const pageWidth = 210;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      // Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(31, 41, 55);
      const titleLines = doc.splitTextToSize(title, contentWidth);
      doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
      y += titleLines.length * 7 + 6;

      // Format badge
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(107, 114, 128);
      doc.text(`Format: ${format}`, pageWidth / 2, y, { align: 'center' });
      y += 10;

      // Divider
      doc.setLineWidth(0.5);
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // Content
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(31, 41, 55);

      const lines = text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (y > 275) {
          if (includePageNums()) {
            doc.setFontSize(9);
            doc.setTextColor(156, 163, 175);
            doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageWidth / 2, 290, { align: 'center' });
          }
          doc.addPage();
          y = margin;
          doc.setFontSize(11);
          doc.setTextColor(31, 41, 55);
        }

        const isHeading1 = line.match(/^#{1}\s/) || line.match(/^\d+\.\s+[A-Z]/);
        const isHeading2 = line.match(/^#{2,3}\s/);

        if (isHeading1) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.setTextColor(47, 111, 237);
          y += 4;
        } else if (isHeading2) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(31, 41, 55);
          y += 2;
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(31, 41, 55);
        }

        const clean = line.replace(/^#{1,3}\s/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
        const wrapped = doc.splitTextToSize(clean, contentWidth);
        doc.text(wrapped, margin, y);
        y += wrapped.length * 5.5 + 2;
      }

      // Page number on last page
      if (includePageNums()) {
        doc.setFontSize(9);
        doc.setTextColor(156, 163, 175);
        doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageWidth / 2, 290, { align: 'center' });
      }

      doc.save(`${sanitizeFilename(title)}.pdf`);
      showToast('✅ PDF downloaded!', 'success');
    } catch (err) {
      console.error('PDF error:', err);
      toPDFFallback();
    }
  }

  function toPDFFallback() {
    // Print-based fallback
    const title = getDocTitle();
    const html = getEditorHTML();
    const win = window.open('', '_blank', 'width=794,height=900');
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: 'Georgia', serif; font-size: 12pt; line-height: 1.8; color: #1F2937; margin: 60px 80px; }
        h1 { font-size: 18pt; text-align: center; color: #1F2937; }
        h2 { font-size: 13pt; color: #1F2937; margin-top: 20px; }
        h3 { font-size: 11pt; font-style: italic; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #e5e7eb; padding: 6px 10px; }
        th { background: #1F2937; color: white; }
        @media print { body { margin: 0; } }
      </style>
    </head><body>${html}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 500);
    showToast('✅ Opening print dialog…', 'success');
  }

  // ── DOCX Export ──────────────────────────────────────────────
  function toDOCX() {
    showToast('⏳ Generating DOCX…', 'info');
    try {
      const title = getDocTitle();
      const text = getEditorText();
      const format = getFormat();

      // Build a simple XML-based DOCX wrapper
      const xmlContent = buildDOCXXML(title, text, format);
      const blob = new Blob([xmlContent], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

      // Fallback: save as .doc (RTF-like)
      const rtf = buildRTF(title, text);
      const rtfBlob = new Blob([rtf], { type: 'application/msword' });
      downloadBlob(rtfBlob, `${sanitizeFilename(title)}.doc`);
      showToast('✅ Document downloaded!', 'success');
    } catch (err) {
      // Ultra fallback: plain text with docx-like content
      const title = getDocTitle();
      const text = getEditorText();
      const blob = new Blob([`${title}\n${'='.repeat(title.length)}\n\n${text}`], { type: 'text/plain' });
      downloadBlob(blob, `${sanitizeFilename(title)}.txt`);
      showToast('ℹ️ Exported as text (DOCX library not loaded)', 'info');
    }
  }

  function buildRTF(title, text) {
    const rtfLines = text.split('\n').map(line => {
      const clean = line.replace(/[\\{}]/g, match => `\\${match}`);
      if (line.match(/^# /)) return `{\\pard\\b\\fs28 ${clean.replace(/^# /,'')}\\par}`;
      if (line.match(/^## /)) return `{\\pard\\b\\fs22 ${clean.replace(/^## /,'')}\\par}`;
      return `{\\pard ${clean}\\par}`;
    }).join('\n');

    return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Times New Roman;}}
{\\f0\\fs24
{\\pard\\qc\\b\\fs32 ${title}\\par}
\\par
${rtfLines}
}}`;
  }

  function buildDOCXXML(title, text, format) {
    // Minimal OOXML structure (browsers can open it)
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${escapeHtml(title)}</w:t></w:r></w:p>
${text.split('\n').filter(l => l.trim()).map(l =>
  `<w:p><w:r><w:t xml:space="preserve">${escapeHtml(l)}</w:t></w:r></w:p>`
).join('\n')}
</w:body></w:document>`;
  }

  // ── Markdown Export ──────────────────────────────────────────
  function toMarkdown() {
    const title = getDocTitle();
    const text = getEditorText();
    const format = getFormat();
    const date = new Date().toISOString().split('T')[0];

    let md = `# ${title}\n\n`;
    md += `> Format: ${format} | Generated: ${date} | ResearchAI\n\n---\n\n`;
    md += text;

    downloadText(md, `${sanitizeFilename(title)}.md`, 'text/markdown');
    showToast('✅ Markdown downloaded!', 'success');
  }

  // ── HTML Export ──────────────────────────────────────────────
  function toHTML() {
    const title = getDocTitle();
    const html = getEditorHTML();
    const format = getFormat();

    const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Georgia', serif; max-width: 800px; margin: 60px auto; padding: 0 40px; font-size: 12pt; line-height: 1.8; color: #1F2937; background: #FFFEF9; }
    h1 { font-size: 20pt; text-align: center; margin-bottom: 8px; }
    h2 { font-size: 14pt; margin-top: 28px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    h3 { font-size: 12pt; font-style: italic; }
    p { text-align: justify; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th { background: #1F2937; color: white; padding: 8px 12px; }
    td { border: 1px solid #e5e7eb; padding: 7px 12px; }
    code { font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 3px; }
    .meta { text-align: center; color: #6B7280; font-size: 10pt; margin-bottom: 32px; }
  </style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${format} Format · Exported from ResearchAI · ${new Date().toLocaleDateString()}</div>
${html}
</body>
</html>`;

    downloadText(fullHTML, `${sanitizeFilename(title)}.html`, 'text/html');
    showToast('✅ HTML downloaded!', 'success');
  }

  // ── TXT Export ───────────────────────────────────────────────
  function toTXT() {
    const title = getDocTitle();
    const text = getEditorText();
    const content = `${title}\n${'='.repeat(60)}\n\n${text}\n\n---\nExported from ResearchAI`;
    downloadText(content, `${sanitizeFilename(title)}.txt`, 'text/plain');
    showToast('✅ Text file downloaded!', 'success');
  }

  // ── LaTeX Export ─────────────────────────────────────────────
  function toLaTeX() {
    const title = getDocTitle();
    const text = getEditorText();
    const format = getFormat();

    const docClass = format === 'IEEE' ? 'IEEEtran' : format === 'ACM' ? 'acmart' : 'article';
    const sections = text.split('\n').map(line => {
      if (line.match(/^# /)) return `\\section{${line.replace(/^# /, '')}}`;
      if (line.match(/^## /)) return `\\subsection{${line.replace(/^## /, '')}}`;
      if (line.match(/^### /)) return `\\subsubsection{${line.replace(/^### /, '')}}`;
      return line ? line : '';
    }).join('\n');

    const latex = `\\documentclass{${docClass}}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{cite}
\\usepackage{hyperref}

\\title{${title}}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

${sections}

\\bibliographystyle{${format === 'IEEE' ? 'IEEEtran' : 'plain'}}
\\bibliography{references}

\\end{document}
`;

    downloadText(latex, `${sanitizeFilename(title)}.tex`, 'text/plain');
    showToast('✅ LaTeX file downloaded!', 'success');
  }

  // ── Helpers ──────────────────────────────────────────────────
  function downloadText(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8;' });
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9_\-. ]/gi, '_').replace(/\s+/g, '_').slice(0, 60);
  }

  return { toPDF, toDOCX, toMarkdown, toHTML, toTXT, toLaTeX };
})();
