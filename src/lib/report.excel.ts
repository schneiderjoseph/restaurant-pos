import type {Workbook, Worksheet, Cell} from 'exceljs';
import type {ReportBrandingHeader} from '@/lib/report.branding.ts';

/**
 * Formatted XLSX export shared by every report screen.
 *
 * Reports render plain HTML tables; this module reads them back (header rows,
 * body, totals, colspans), turns displayed amounts into real numbers so Excel
 * can sum and sort them, and writes a styled workbook: branded header block,
 * bold shaded column headers, borders, bold total rows, frozen header,
 * autofilter and fitted column widths.
 *
 * Opt-in hooks on the HTML (all optional):
 * - `data-xlsx-title="…"` on a table: section title (else nearest heading above it)
 * - `data-xlsx-ignore` on any element: skipped (also `data-pdf-ignore`)
 * - `data-xlsx-value="123.45"` on a cell: exact numeric value instead of parsing text
 * - `data-xlsx-total` on a row: styled as a total row
 * - `data-xlsx-kpis` on a container of `[data-xlsx-kpi]` elements, each holding
 *   `[data-xlsx-kpi-label]` and `[data-xlsx-kpi-value]`: exported as a KPI block
 * - `data-xlsx-insights` on a list container: each `li` exported as an insight line
 */

export type ParsedCell =
  | {kind: 'number'; value: number; format: 'money' | 'number' | 'percent' | 'integer'}
  | {kind: 'text'; value: string};

export type ExtractedRow = {
  cells: Array<{ text: string; parsed: ParsedCell; colSpan: number; header: boolean }>;
  role: 'header' | 'body' | 'total';
};

export type ExtractedSection =
  | { type: 'table'; title?: string; rows: ExtractedRow[] }
  | { type: 'kpis'; title?: string; items: Array<{ label: string; value: string; parsed: ParsedCell }> }
  | { type: 'insights'; title?: string; lines: string[] };

type Separators = { group: string; decimal: string };

const separatorCache = new Map<string, Separators>();

export function getLocaleSeparators(locale: string): Separators {
  const cached = separatorCache.get(locale);
  if (cached) return cached;
  let group = ',';
  let decimal = '.';
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    group = parts.find((p) => p.type === 'group')?.value ?? group;
    decimal = parts.find((p) => p.type === 'decimal')?.value ?? decimal;
  } catch {
    /* keep defaults */
  }
  const result = {group, decimal};
  separatorCache.set(locale, result);
  return result;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SPACE_LIKE = /[\s\u00a0\u202f\u2009]/g;
const CURRENCY_TOKENS = /(HTG|USD|EUR|GBP|PKR|Rs\.?|US\$|\$|€|£|\bG\b|\bGdes?\b)/gi;

/**
 * Parse a displayed amount ("G 1 234,50", "$1,234.50", "12.5%", "(45.00)")
 * back into a number. Returns text when the value does not look numeric or
 * looks like an identifier (leading zeros, phone numbers, dates).
 */
export function parseDisplayedValue(raw: string, locale: string): ParsedCell {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return {kind: 'text', value: ''};

  // Dual currency "G 1 000 ($7.50)": keep the primary amount only.
  let candidate = text.replace(/\s*\([^)]*[A-Za-z$€£][^)]*\)\s*$/, '').trim();

  let negative = false;
  if (/^\(.*\)$/.test(candidate)) {
    negative = true;
    candidate = candidate.slice(1, -1).trim();
  }

  const isPercent = /%\s*$/.test(candidate);
  const hadCurrency = CURRENCY_TOKENS.test(candidate);
  CURRENCY_TOKENS.lastIndex = 0;
  candidate = candidate.replace(/%\s*$/, '').replace(CURRENCY_TOKENS, '').trim();
  CURRENCY_TOKENS.lastIndex = 0;

  if (/^[-−–]/.test(candidate)) {
    negative = !negative;
    candidate = candidate.replace(/^[-−–]\s*/, '');
  }
  candidate = candidate.replace(/^[-−–]\s*/, '');

  const {group, decimal} = getLocaleSeparators(locale);
  const groupIsSpace = SPACE_LIKE.test(group);
  SPACE_LIKE.lastIndex = 0;

  // Normalise group separators.
  let normalised = candidate;
  if (groupIsSpace) {
    normalised = normalised.replace(SPACE_LIKE, ' ');
    if (!/^\d{1,3}( \d{3})*([.,]\d+)?$/.test(normalised) && !/^\d+([.,]\d+)?$/.test(normalised)) {
      return {kind: 'text', value: text};
    }
    normalised = normalised.replace(/ /g, '');
  } else {
    const groupRe = new RegExp(`^\\d{1,3}(${escapeRe(group)}\\d{3})*(${escapeRe(decimal)}\\d+)?$`);
    const plainRe = new RegExp(`^\\d+(${escapeRe(decimal)}\\d+)?$`);
    if (!groupRe.test(normalised) && !plainRe.test(normalised)) {
      return {kind: 'text', value: text};
    }
    normalised = normalised.split(group).join('');
  }

  // Identifiers such as "00125" stay text.
  if (/^0\d/.test(normalised) && !hadCurrency) {
    return {kind: 'text', value: text};
  }

  normalised = normalised.replace(decimal === ',' ? ',' : decimal, '.').replace(',', '.');
  const n = Number(normalised);
  if (!Number.isFinite(n)) return {kind: 'text', value: text};

  const signed = negative ? -n : n;
  if (isPercent) return {kind: 'number', value: signed / 100, format: 'percent'};
  if (hadCurrency) return {kind: 'number', value: signed, format: 'money'};
  if (Number.isInteger(signed) && !normalised.includes('.')) {
    return {kind: 'number', value: signed, format: 'integer'};
  }
  return {kind: 'number', value: signed, format: 'number'};
}

const TOTAL_LABEL = /^(grand\s+)?(sub)?total|^totaux?\b|^total\b|^sous-total|^somme|^net\b/i;

function isIgnored(el: Element): boolean {
  return Boolean(el.closest('[data-xlsx-ignore],[data-pdf-ignore]'));
}

function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  clone.querySelectorAll('[data-xlsx-ignore],[data-pdf-ignore],button,svg,script,style').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseCell(cell: Element, locale: string): { text: string; parsed: ParsedCell } {
  const text = cellText(cell);
  const explicit = cell.getAttribute('data-xlsx-value');
  if (explicit !== null && explicit !== '' && Number.isFinite(Number(explicit))) {
    const fmt = (cell.getAttribute('data-xlsx-format') as 'money' | 'number' | 'percent' | 'integer' | null) ?? 'money';
    return {text, parsed: {kind: 'number', value: Number(explicit), format: fmt}};
  }
  return {text, parsed: parseDisplayedValue(text, locale)};
}

export function extractTable(table: HTMLTableElement, locale: string): ExtractedRow[] {
  const rows: ExtractedRow[] = [];
  Array.from(table.rows).forEach((tr) => {
    if (isIgnored(tr)) return;
    const section = tr.parentElement?.tagName.toLowerCase();
    const cells = Array.from(tr.cells).filter((c) => !isIgnored(c));
    if (cells.length === 0) return;
    const allTh = cells.every((c) => c.tagName.toLowerCase() === 'th');
    const extracted = cells.map((c) => {
      const {text, parsed} = parseCell(c, locale);
      return {text, parsed, colSpan: Math.max(1, (c as HTMLTableCellElement).colSpan || 1), header: c.tagName.toLowerCase() === 'th'};
    });
    let role: ExtractedRow['role'] = 'body';
    if (section === 'thead' || (allTh && rows.every((r) => r.role === 'header'))) role = 'header';
    else if (section === 'tfoot' || tr.hasAttribute('data-xlsx-total') || TOTAL_LABEL.test(extracted[0]?.text ?? '')) role = 'total';
    rows.push({cells: extracted, role});
  });
  return rows;
}

function precedingHeading(root: Element, target: Element, after: Element | null): string | undefined {
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,[data-xlsx-heading]'));
  let found: string | undefined;
  for (const h of headings) {
    if (isIgnored(h)) continue;
    const beforeTarget = h.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!beforeTarget) break;
    if (after && !(after.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (h.contains(target)) continue;
    const t = (h.textContent ?? '').trim();
    if (t) found = t;
  }
  return found;
}

/** Walk a rendered report and collect KPI blocks, insight lists and tables in document order. */
export function extractReportSections(root: HTMLElement, locale: string, skipTitle?: string): ExtractedSection[] {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('table,[data-xlsx-kpis],[data-xlsx-insights]'),
  ).filter((el) => !isIgnored(el));
  // Tables nested inside a KPI/insight block or another table are handled by their parent.
  const top = nodes.filter((el) => !nodes.some((other) => other !== el && other.contains(el)));

  const sections: ExtractedSection[] = [];
  let previous: Element | null = null;
  for (const el of top) {
    const explicitTitle = el.getAttribute('data-xlsx-title') ?? undefined;
    let title = explicitTitle ?? precedingHeading(root, el, previous);
    if (title && skipTitle && title === skipTitle) title = undefined;
    if (el.hasAttribute('data-xlsx-kpis')) {
      const items = Array.from(el.querySelectorAll('[data-xlsx-kpi]')).map((k) => {
        const label = cellText(k.querySelector('[data-xlsx-kpi-label]') ?? k);
        const valueEl = k.querySelector('[data-xlsx-kpi-value]');
        const {text, parsed} = valueEl ? parseCell(valueEl, locale) : {text: '', parsed: {kind: 'text', value: ''} as ParsedCell};
        return {label, value: text, parsed};
      });
      if (items.length) sections.push({type: 'kpis', title, items});
    } else if (el.hasAttribute('data-xlsx-insights')) {
      const lines = Array.from(el.querySelectorAll('li')).map((li) => cellText(li)).filter(Boolean);
      if (lines.length) sections.push({type: 'insights', title, lines});
    } else {
      const rows = extractTable(el as HTMLTableElement, locale);
      if (rows.length) sections.push({type: 'table', title, rows});
    }
    previous = el;
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Workbook writer
// ---------------------------------------------------------------------------

const COLORS = {
  brand: 'FF1F3A5F',
  headerFill: 'FF1F3A5F',
  headerFont: 'FFFFFFFF',
  sectionFill: 'FFE8EEF6',
  totalFill: 'FFF2F2F2',
  zebra: 'FFFAFBFD',
  border: 'FFD0D7E2',
  muted: 'FF6B7280',
  negative: 'FFB91C1C',
  kpiFill: 'FFF5F8FC',
};

const thin = {style: 'thin' as const, color: {argb: COLORS.border}};
const allBorders = {top: thin, left: thin, bottom: thin, right: thin};

function numberFormat(format: 'money' | 'number' | 'percent' | 'integer', decimals: number): string {
  const dec = decimals > 0 ? '.' + '0'.repeat(decimals) : '';
  switch (format) {
    case 'percent':
      return '0.0%';
    case 'integer':
      return '#,##0';
    case 'number':
      return `#,##0${dec || '.00'}`;
    case 'money':
    default:
      return `#,##0${dec};[Red]-#,##0${dec}`;
  }
}

function setParsed(cell: Cell, parsed: ParsedCell, decimals: number) {
  if (parsed.kind === 'number') {
    cell.value = parsed.value;
    cell.numFmt = numberFormat(parsed.format, decimals);
    cell.alignment = {horizontal: 'right', vertical: 'middle'};
  } else {
    cell.value = parsed.value;
    cell.alignment = {vertical: 'middle', wrapText: parsed.value.length > 60};
  }
}

function dataUrlToBase64(dataUrl: string): { base64: string; extension: 'png' | 'jpeg' | 'gif' } | null {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return {base64: m[2], extension: ext === 'jpg' ? 'jpeg' : (ext as 'png' | 'jpeg' | 'gif')};
}

export type ExcelExportOptions = {
  branding: ReportBrandingHeader;
  sections: ExtractedSection[];
  logoDataUrl?: string | null;
  sheetName?: string;
  decimals?: number;
  exchangeRateLabel?: string | null;
};

function sectionWidth(sections: ExtractedSection[]): number {
  let width = 1;
  for (const s of sections) {
    if (s.type === 'table') {
      for (const r of s.rows) width = Math.max(width, r.cells.reduce((acc, c) => acc + c.colSpan, 0));
    } else if (s.type === 'kpis') {
      width = Math.max(width, Math.min(s.items.length, 4) * 2);
    }
  }
  return Math.min(width, 50);
}

function writeHeader(ws: Worksheet, wb: Workbook, opts: ExcelExportOptions, width: number): number {
  const {branding, logoDataUrl} = opts;
  const lastCol = Math.max(width, 4);
  let row = 1;
  const logo = logoDataUrl ? dataUrlToBase64(logoDataUrl) : null;
  if (logo) {
    const id = wb.addImage({base64: logo.base64, extension: logo.extension});
    ws.addImage(id, {tl: {col: 0, row: 0}, ext: {width: 140, height: 56}, editAs: 'oneCell'});
    for (let i = 1; i <= 3; i++) ws.getRow(i).height = 20;
    row = 4;
  }

  const line = (text: string, font: Partial<import('exceljs').Font>, height?: number) => {
    ws.mergeCells(row, 1, row, lastCol);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = font;
    c.alignment = {horizontal: 'left', vertical: 'middle'};
    if (height) ws.getRow(row).height = height;
    row++;
  };

  line(branding.title, {bold: true, size: 16, color: {argb: COLORS.brand}}, 26);
  if (branding.subtitle) line(branding.subtitle, {size: 12, color: {argb: 'FF374151'}});
  const p = branding.profile;
  const identity = [p.name, ...(p.address ? p.address.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [])].filter(Boolean).join(' — ');
  if (identity) line(identity, {size: 10, color: {argb: COLORS.muted}});
  const contact = [p.phone, p.email, p.website, p.taxId].filter(Boolean).join(' · ');
  if (contact) line(contact, {size: 10, color: {argb: COLORS.muted}});
  line(branding.generatedAt, {italic: true, size: 9, color: {argb: COLORS.muted}});
  if (opts.exchangeRateLabel) line(opts.exchangeRateLabel, {italic: true, size: 9, color: {argb: COLORS.muted}});
  return row + 1;
}

function writeSectionTitle(ws: Worksheet, row: number, title: string, width: number): number {
  ws.mergeCells(row, 1, row, Math.max(width, 1));
  const c = ws.getCell(row, 1);
  c.value = title;
  c.font = {bold: true, size: 12, color: {argb: COLORS.brand}};
  c.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: COLORS.sectionFill}};
  c.alignment = {vertical: 'middle'};
  ws.getRow(row).height = 20;
  return row + 1;
}

function writeTable(
  ws: Worksheet,
  startRow: number,
  rows: ExtractedRow[],
  decimals: number,
  widths: number[],
): { endRow: number; headerRow: number | null; cols: number } {
  let row = startRow;
  let headerRow: number | null = null;
  let cols = 0;
  // Occupancy for merged header cells.
  let bodyIndex = 0;
  for (const r of rows) {
    let col = 1;
    for (const c of r.cells) {
      const cell = ws.getCell(row, col);
      setParsed(cell, c.parsed, decimals);
      cell.border = allBorders;
      if (r.role === 'header') {
        cell.font = {bold: true, color: {argb: COLORS.headerFont}};
        cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: COLORS.headerFill}};
        cell.alignment = {horizontal: c.parsed.kind === 'number' ? 'right' : 'left', vertical: 'middle', wrapText: true};
      } else if (r.role === 'total') {
        cell.font = {bold: true};
        cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: COLORS.totalFill}};
        cell.border = {...allBorders, top: {style: 'medium', color: {argb: COLORS.brand}}};
      } else {
        if (c.header) cell.font = {bold: true};
        if (bodyIndex % 2 === 1) cell.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: COLORS.zebra}};
      }
      if (c.colSpan > 1) {
        ws.mergeCells(row, col, row, col + c.colSpan - 1);
      } else {
        const len = Math.min(60, (c.text || '').length + 2);
        widths[col - 1] = Math.max(widths[col - 1] ?? 8, len, r.role === 'header' ? Math.min(30, len) : 0);
      }
      col += c.colSpan;
    }
    cols = Math.max(cols, col - 1);
    if (r.role === 'header') headerRow = row;
    if (r.role === 'body') bodyIndex++;
    row++;
  }
  return {endRow: row, headerRow, cols};
}

function writeKpis(
  ws: Worksheet,
  startRow: number,
  items: Array<{ label: string; value: string; parsed: ParsedCell }>,
  decimals: number,
): number {
  const perRow = 4;
  let row = startRow;
  for (let i = 0; i < items.length; i += perRow) {
    const chunk = items.slice(i, i + perRow);
    chunk.forEach((item, j) => {
      const col = j * 2 + 1;
      const label = ws.getCell(row, col);
      ws.mergeCells(row, col, row, col + 1);
      label.value = item.label;
      label.font = {size: 9, color: {argb: COLORS.muted}};
      label.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: COLORS.kpiFill}};
      const value = ws.getCell(row + 1, col);
      ws.mergeCells(row + 1, col, row + 1, col + 1);
      setParsed(value, item.parsed, decimals);
      value.font = {bold: true, size: 14, color: {argb: COLORS.brand}};
      value.alignment = {horizontal: 'left', vertical: 'middle'};
      value.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: COLORS.kpiFill}};
    });
    ws.getRow(row + 1).height = 22;
    row += 3;
  }
  return row;
}

function writeInsights(ws: Worksheet, startRow: number, lines: string[], width: number): number {
  let row = startRow;
  for (const l of lines) {
    ws.mergeCells(row, 1, row, Math.max(width, 4));
    const c = ws.getCell(row, 1);
    c.value = `• ${l}`;
    c.alignment = {wrapText: true, vertical: 'top'};
    ws.getRow(row).height = Math.max(16, Math.ceil(l.length / 110) * 15);
    row++;
  }
  return row + 1;
}

const sheetSafe = (name: string) => name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Rapport';

/** Build the workbook in memory. Kept separate from the download for tests. */
export async function buildReportWorkbook(opts: ExcelExportOptions): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = opts.branding.profile.name || 'POSR';
  wb.created = new Date();
  const decimals = opts.decimals ?? 2;
  const width = sectionWidth(opts.sections);
  const widths: number[] = [];

  const ws = wb.addWorksheet(sheetSafe(opts.sheetName ?? 'Rapport'), {
    pageSetup: {orientation: width > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0},
    views: [{showGridLines: false}],
  });

  let row = writeHeader(ws, wb, opts, width);
  let firstHeaderRow: number | null = null;
  let firstTable: { headerRow: number; endRow: number; cols: number } | null = null;
  let tableCount = 0;

  for (const s of opts.sections) {
    if (s.title) row = writeSectionTitle(ws, row, s.title, width);
    if (s.type === 'kpis') {
      row = writeKpis(ws, row, s.items, decimals);
    } else if (s.type === 'insights') {
      row = writeInsights(ws, row, s.lines, width);
    } else {
      const res = writeTable(ws, row, s.rows, decimals, widths);
      tableCount++;
      if (res.headerRow && firstHeaderRow === null) firstHeaderRow = res.headerRow;
      if (res.headerRow && !firstTable) firstTable = {headerRow: res.headerRow, endRow: res.endRow - 1, cols: res.cols};
      row = res.endRow + 1;
    }
  }

  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = Math.max(10, Math.min(w, 60));
  });

  // Freeze + filter only when the report is one main table (filters on stacked tables confuse Excel).
  if (tableCount === 1 && firstTable) {
    ws.views = [{state: 'frozen', ySplit: firstTable.headerRow, showGridLines: false}];
    if (firstTable.endRow > firstTable.headerRow) {
      ws.autoFilter = {from: {row: firstTable.headerRow, column: 1}, to: {row: firstTable.endRow, column: firstTable.cols}};
    }
  }

  // One extra sheet per table when the report has several, for easy pivoting.
  if (tableCount > 1) {
    let n = 0;
    const used = new Set<string>([ws.name]);
    for (const s of opts.sections) {
      if (s.type !== 'table') continue;
      n++;
      let name = sheetSafe(s.title ? s.title : `Tableau ${n}`);
      while (used.has(name)) name = sheetSafe(`${name.slice(0, 27)} ${n}`);
      used.add(name);
      const sub = wb.addWorksheet(name, {views: [{showGridLines: false}]});
      const subWidths: number[] = [];
      const res = writeTable(sub, 1, s.rows, decimals, subWidths);
      subWidths.forEach((w, i) => (sub.getColumn(i + 1).width = Math.max(10, Math.min(w, 60))));
      if (res.headerRow) {
        sub.views = [{state: 'frozen', ySplit: res.headerRow, showGridLines: false}];
        if (res.endRow - 1 > res.headerRow) {
          sub.autoFilter = {from: {row: res.headerRow, column: 1}, to: {row: res.endRow - 1, column: res.cols}};
        }
      }
    }
  }

  return wb;
}

export async function downloadWorkbook(wb: Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
