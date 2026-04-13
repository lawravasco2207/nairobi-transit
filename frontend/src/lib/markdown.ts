/**
 * Minimal markdown-to-HTML converter for the docs page.
 * Handles the patterns found in docs.md: headings, code blocks,
 * tables, lists, blockquotes, horizontal rules, and inline formatting.
 * Content comes from our own file so dangerouslySetInnerHTML is safe.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** GitHub-compatible slug: lowercase, strip punctuation, spaces to hyphens */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\*\*([^*]+)\*\*/g, '$1') // strip bold markers
    .replace(/`([^`]+)`/g, '$1')        // strip inline code markers
    .replace(/[^\w\s-]/g, '')           // remove non-word chars (keeps spaces + hyphens)
    .replace(/\s+/g, '-');              // spaces → hyphens (keeps double-hyphens, e.g. "& ")
}

function inlineMarkdown(raw: string): string {
  let s = escapeHtml(raw);
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="docs-strong">$1</strong>');
  // Italic
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code class="docs-code-inline">$1</code>');
  // Links  [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="docs-link">$1</a>');
  return s;
}

function parseTable(lines: string[]): string {
  // Filter out separator rows (e.g. | --- | --- |)
  const dataRows = lines.filter(l => !/^\|[-: |]+\|$/.test(l.trim()))
    .map(l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));

  if (dataRows.length === 0) return '';
  const [header, ...body] = dataRows;

  const ths = header.map(c => `<th class="docs-th">${inlineMarkdown(c)}</th>`).join('');
  const trs = body.map(row =>
    `<tr>${row.map(c => `<td class="docs-td">${inlineMarkdown(c)}</td>`).join('')}</tr>`
  ).join('');

  return (
    `<div class="docs-table-wrap"><table class="docs-table">` +
    `<thead><tr>${ths}</tr></thead>` +
    `<tbody>${trs}</tbody>` +
    `</table></div>`
  );
}

export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre class="docs-pre"><code class="docs-code-block language-${lang}">` +
        codeLines.join('\n') +
        `</code></pre>`
      );
      continue;
    }

    // ── Headings ─────────────────────────────────────────────────────
    if (line.startsWith('#### ')) {
      const text = line.slice(5);
      out.push(`<h4 class="docs-h4" id="${slugify(text)}">${inlineMarkdown(text)}</h4>`);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      const text = line.slice(4);
      out.push(`<h3 class="docs-h3" id="${slugify(text)}">${inlineMarkdown(text)}</h3>`);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      const text = line.slice(3);
      out.push(`<h2 class="docs-h2" id="${slugify(text)}">${inlineMarkdown(text)}</h2>`);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      const text = line.slice(2);
      out.push(`<h1 class="docs-h1" id="${slugify(text)}">${inlineMarkdown(text)}</h1>`);
      i++; continue;
    }

    // ── Horizontal rule ───────────────────────────────────────────────
    if (line.trim() === '---') {
      out.push('<hr class="docs-hr">');
      i++; continue;
    }

    // ── Table ─────────────────────────────────────────────────────────
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(parseTable(tableLines));
      continue;
    }

    // ── Blockquote ────────────────────────────────────────────────────
    if (line.startsWith('> ')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      out.push(
        `<blockquote class="docs-blockquote"><p>${bqLines.map(inlineMarkdown).join(' ')}</p></blockquote>`
      );
      continue;
    }

    // ── Unordered list (supports "  - " nested items too) ─────────────
    if (/^  ?[-*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^  ?[-*] /.test(lines[i])) {
        const text = lines[i].replace(/^  ?[-*] /, '');
        items.push(`<li class="docs-li">${inlineMarkdown(text)}</li>`);
        i++;
      }
      out.push(`<ul class="docs-ul">${items.join('')}</ul>`);
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const text = lines[i].replace(/^\d+\. /, '');
        items.push(`<li class="docs-li">${inlineMarkdown(text)}</li>`);
        i++;
      }
      out.push(`<ol class="docs-ol">${items.join('')}</ol>`);
      continue;
    }

    // ── Empty line ────────────────────────────────────────────────────
    if (line.trim() === '') {
      i++; continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !/^  ?[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      lines[i].trim() !== '---'
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p class="docs-p">${paraLines.map(inlineMarkdown).join('<br>')}</p>`);
    }
  }

  return out.join('\n');
}
