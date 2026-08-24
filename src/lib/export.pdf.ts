import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export type PdfCell = {
  content: string;
  colSpan?: number;
  rowSpan?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
};

export type PdfBlock =
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'text'; text: string; align?: 'left' | 'center' | 'right' }
  | { type: 'table'; head: PdfCell[][]; body: PdfCell[][]; columnCount: number }
  | { type: 'image'; dataUrl: string; width: number; height: number }
  | { type: 'snapshot'; element: HTMLElement };

const IGNORE_SELECTOR = [
  '[data-pdf-ignore]',
  '.print\\:hidden',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
].join(',');

function isHtmlElement(node: EventTarget | Node | null): node is HTMLElement {
  return !!node && node instanceof HTMLElement;
}

export function visibleText(node: Node | null | undefined): string {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (!isHtmlElement(node)) {
    if (node instanceof Element && node.tagName === 'BR') return '\n';
    return '';
  }
  if (node.matches(IGNORE_SELECTOR) || node.closest(IGNORE_SELECTOR)) return '';
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'TABLE') return '';

  const pieces: string[] = [];
  node.childNodes.forEach((child) => {
    if (isHtmlElement(child) && ['DIV', 'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4'].includes(child.tagName)) {
      const t = visibleText(child).trim();
      if (t) pieces.push(t);
      return;
    }
    pieces.push(visibleText(child));
  });
  const join = node.tagName === 'UL' || node.tagName === 'OL' ? '\n' : ' ';
  return pieces
    .join(join)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function cellAlign(el: Element): 'left' | 'center' | 'right' | undefined {
  const cls = el.getAttribute('class') ?? '';
  if (/\btext-right\b/.test(cls) || /\btext-end\b/.test(cls)) return 'right';
  if (/\btext-center\b/.test(cls)) return 'center';
  const align = (el.getAttribute('align') || '').toLowerCase();
  if (align === 'right' || align === 'center' || align === 'left') return align;
  return undefined;
}

function cellFromElement(el: HTMLTableCellElement): PdfCell {
  const cell: PdfCell = { content: visibleText(el) };
  if (el.colSpan > 1) cell.colSpan = el.colSpan;
  if (el.rowSpan > 1) cell.rowSpan = el.rowSpan;
  const align = cellAlign(el);
  if (align) cell.align = align;
  if (el.tagName === 'TH') cell.bold = true;
  return cell;
}

function rowColumnCount(row: PdfCell[]): number {
  return row.reduce((sum, cell) => sum + (cell.colSpan && cell.colSpan > 1 ? cell.colSpan : 1), 0);
}

export function tableToMatrix(table: HTMLTableElement): {
  head: PdfCell[][];
  body: PdfCell[][];
  columnCount: number;
} {
  const head: PdfCell[][] = [];
  const body: PdfCell[][] = [];

  const pushRow = (row: HTMLTableRowElement, target: PdfCell[][]) => {
    if (row.closest(IGNORE_SELECTOR)) return;
    const cells = [...row.children].filter((c): c is HTMLTableCellElement => c instanceof HTMLTableCellElement);
    if (!cells.length) return;
    target.push(cells.map(cellFromElement));
  };

  table.querySelectorAll(':scope > thead > tr').forEach((row) => {
    if (row instanceof HTMLTableRowElement) pushRow(row, head);
  });

  table.querySelectorAll(':scope > tbody > tr, :scope > tr').forEach((row) => {
    if (row instanceof HTMLTableRowElement) pushRow(row, body);
  });

  if (head.length === 0 && body.length === 0) {
    table.querySelectorAll('tr').forEach((row) => {
      if (!(row instanceof HTMLTableRowElement)) return;
      if (row.closest('table') !== table) return;
      pushRow(row, body);
    });
  }

  const columnCount = Math.max(1, ...[...head, ...body].map(rowColumnCount), 0);
  return { head, body, columnCount };
}

function headingLevel(tag: string): 1 | 2 | 3 {
  if (tag === 'H1') return 1;
  if (tag === 'H2') return 2;
  return 3;
}

function shouldIgnore(el: Element): boolean {
  if (!isHtmlElement(el) && !(el instanceof SVGElement)) return true;
  if (el.matches?.(IGNORE_SELECTOR) || el.closest?.(IGNORE_SELECTOR)) return true;
  if (typeof window !== 'undefined' && 'getComputedStyle' in window && isHtmlElement(el)) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

function hasMediaDescendant(el: Element): boolean {
  return !!el.querySelector('table, canvas, svg, img');
}

function snapshotTarget(el: Element): HTMLElement | null {
  if (isHtmlElement(el)) return el;
  return el.parentElement;
}

export function collectPdfBlocks(root: HTMLElement): PdfBlock[] {
  const blocks: PdfBlock[] = [];

  const visit = (el: Element) => {
    if (shouldIgnore(el)) return;
    const tag = el.tagName;

    if (tag === 'TABLE') {
      const matrix = tableToMatrix(el as HTMLTableElement);
      if (matrix.body.length || matrix.head.length) {
        blocks.push({ type: 'table', ...matrix });
      }
      return;
    }

    if (tag === 'IMG' && isHtmlElement(el)) {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.src;
      if (src) {
        blocks.push({
          type: 'image',
          dataUrl: src,
          width: img.naturalWidth || img.width || 160,
          height: img.naturalHeight || img.height || 80,
        });
      }
      return;
    }

    if (tag === 'CANVAS' || tag === 'SVG') {
      const target = snapshotTarget(el);
      if (target) blocks.push({ type: 'snapshot', element: target });
      return;
    }

    if (hasMediaDescendant(el)) {
      [...el.children].forEach(visit);
      return;
    }

    const text = visibleText(el);
    if (!text) return;

    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4') {
      blocks.push({ type: 'heading', text, level: headingLevel(tag) });
      return;
    }

    const ownAlign = isHtmlElement(el) ? cellAlign(el) : undefined;
    const inheritedCenter = !!el.closest?.('.text-center');
    blocks.push({
      type: 'text',
      text,
      align: ownAlign ?? (inheritedCenter ? 'center' : 'left'),
    });
  };

  [...root.children].forEach(visit);
  if (blocks.length === 0) visit(root);
  return blocks;
}

async function rasterizeElement(el: HTMLElement): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.includes('image/jpeg') || dataUrl.includes('image/jpg')) return 'JPEG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'PNG';
}

export function sanitizePdfFilename(name: string): string {
  const base = name.replace(/\.pdf$/i, '').trim() || 'report';
  const slug = base
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${slug || 'report'}.pdf`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function cellSpan(cell: PdfCell): number {
  return cell.colSpan && cell.colSpan > 1 ? cell.colSpan : 1;
}

/** Draw a text table with selectable glyphs (no screenshot). */
function drawTable(
  doc: jsPDF,
  table: { head: PdfCell[][]; body: PdfCell[][]; columnCount: number },
  startY: number,
  opts: { margin: number; contentWidth: number; pageHeight: number },
): number {
  const { margin, contentWidth, pageHeight } = opts;
  const cols = Math.max(1, table.columnCount);
  const colWidth = contentWidth / cols;
  const fontSize = cols > 8 ? 7 : 8;
  const lineHeight = fontSize * 0.4;
  const pad = 1.4;
  let y = startY;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin - 8) {
      doc.addPage();
      y = margin;
    }
  };

  const paintRow = (row: PdfCell[], isHead: boolean) => {
    const prepared = row.map((cell) => {
      const span = cellSpan(cell);
      const width = colWidth * span - pad * 2;
      doc.setFont('helvetica', cell.bold || isHead ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(cell.content || ' ', Math.max(8, width)) as string[];
      return { cell, span, lines };
    });
    const rowHeight = Math.max(...prepared.map((p) => p.lines.length * lineHeight + pad * 2), lineHeight + pad * 2);
    ensureSpace(rowHeight);

    let x = margin;
    prepared.forEach((p) => {
      const w = colWidth * p.span;
      if (isHead) {
        doc.setFillColor(245, 245, 245);
        doc.rect(x, y, w, rowHeight, 'F');
      }
      doc.setDrawColor(200);
      doc.rect(x, y, w, rowHeight, 'S');
      doc.setTextColor(30);
      doc.setFont('helvetica', p.cell.bold || isHead ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      const align = p.cell.align ?? 'left';
      const textX =
        align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad;
      doc.text(p.lines, textX, y + pad + lineHeight * 0.85, { align });
      x += w;
    });

    y += rowHeight;
  };

  table.head.forEach((row) => paintRow(row, true));
  table.body.forEach((row) => paintRow(row, false));
  return y + 6;
}

export async function exportElementAsRealPdf(
  element: HTMLElement | null,
  filename = 'report.pdf',
): Promise<void> {
  if (!element) return;

  const rawBlocks = collectPdfBlocks(element);
  const blocks: PdfBlock[] = [];

  for (const block of rawBlocks) {
    if (block.type === 'snapshot') {
      const raster = await rasterizeElement(block.element);
      if (raster) blocks.push({ type: 'image', ...raster });
      continue;
    }
    if (block.type === 'image' && block.dataUrl.startsWith('blob:')) {
      try {
        const res = await fetch(block.dataUrl);
        const blob = await res.blob();
        blocks.push({ ...block, dataUrl: await blobToDataUrl(blob) });
      } catch {
        /* skip */
      }
      continue;
    }
    blocks.push(block);
  }

  const maxCols = Math.max(
    0,
    ...blocks.filter((b): b is Extract<PdfBlock, { type: 'table' }> => b.type === 'table').map((b) => b.columnCount),
  );
  const landscape = maxCols >= 9;
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin - 8) {
      doc.addPage();
      y = margin;
    }
  };

  const writeWrapped = (
    text: string,
    textOpts: { size: number; bold?: boolean; align?: 'left' | 'center' | 'right' },
  ) => {
    doc.setFont('helvetica', textOpts.bold ? 'bold' : 'normal');
    doc.setFontSize(textOpts.size);
    doc.setTextColor(30);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    const lineHeight = textOpts.size * 0.42;
    ensureSpace(lines.length * lineHeight + 2);
    const x =
      textOpts.align === 'center'
        ? pageWidth / 2
        : textOpts.align === 'right'
          ? pageWidth - margin
          : margin;
    doc.text(lines, x, y, { align: textOpts.align ?? 'left' });
    y += lines.length * lineHeight + 3;
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      const size = block.level === 1 ? 16 : block.level === 2 ? 13 : 11;
      writeWrapped(block.text, { size, bold: true, align: 'center' });
      continue;
    }

    if (block.type === 'text') {
      writeWrapped(block.text, {
        size: 9,
        align: block.align ?? 'left',
      });
      continue;
    }

    if (block.type === 'image') {
      const ratio = block.height / Math.max(block.width, 1);
      const isChart = block.height > 140;
      let w = isChart ? contentWidth : Math.min(contentWidth * 0.35, 42);
      let h = w * ratio;
      const maxH = isChart ? (landscape ? 90 : 70) : 22;
      if (h > maxH) {
        h = maxH;
        w = h / Math.max(ratio, 0.01);
      }
      ensureSpace(h + 4);
      try {
        doc.addImage(
          block.dataUrl,
          imageFormat(block.dataUrl),
          margin + (contentWidth - w) / 2,
          y,
          w,
          h,
        );
        y += h + 4;
      } catch {
        /* skip unreadable image */
      }
      continue;
    }

    if (block.type === 'table') {
      ensureSpace(18);
      y = drawTable(doc, block, y, { margin, contentWidth, pageHeight });
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${i} / ${pageCount}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
  }

  doc.save(sanitizePdfFilename(filename));
}
