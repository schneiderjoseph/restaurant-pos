/**
 * Browser Letter (8.5×11") print helpers for office/report printers.
 * Cash-register (thermal) tickets stay on dispatchPrint / ESC-POS.
 */

export const LETTER_PAGE_CSS = `
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Tahoma, sans-serif;
    color: #111;
    margin: 0;
    font-size: 11pt;
    line-height: 1.35;
  }
  h1 { font-size: 16pt; margin: 0 0 12px; text-align: center; }
  h2 { font-size: 12pt; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { text-align: left; font-size: 10pt; color: #444; border-bottom: 1px solid #999; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #222; border-bottom: none; }
  .muted { color: #666; }
  .sheet { max-width: 7.5in; margin: 0 auto; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
`;

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Full Letter HTML document around a body fragment. */
export function buildLetterDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${LETTER_PAGE_CSS}</style>
</head>
<body>
  <div class="sheet">
    <h1>${escapeHtml(title)}</h1>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

/**
 * Open a printable window from a click handler (before await) so the browser
 * does not block the popup. Do not use noopener — the opener must write HTML.
 */
export function openLetterPrintWindow(): Window | null {
  return window.open('', '_blank', 'width=880,height=1100');
}

/** Write HTML into a window from {@link openLetterPrintWindow}, then print. */
export function writeAndPrintLetterWindow(printWindow: Window, html: string): void {
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  const runPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      console.error('Letter window.print failed', error);
    }
  };
  if (printWindow.document.readyState === 'complete') {
    window.setTimeout(runPrint, 150);
  } else {
    printWindow.onload = () => window.setTimeout(runPrint, 150);
  }
}

export { escapeHtml as escapeLetterHtml };
