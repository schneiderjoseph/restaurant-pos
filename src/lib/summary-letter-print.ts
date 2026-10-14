import {
  buildLetterDocument,
  escapeLetterHtml,
  openLetterPrintWindow,
  writeAndPrintLetterWindow,
} from '@/lib/letter-print.ts';

export type LetterTableColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right';
};

export type LetterTableRow = Record<string, string | number>;

/** Build a simple Letter HTML table (product mix, server sales, …). */
export function buildLetterTableHtml(
  columns: LetterTableColumn[],
  rows: LetterTableRow[],
  footer?: LetterTableRow,
): string {
  const head = columns
    .map((col) => {
      const cls = col.align === 'right' ? ' class="num"' : '';
      return `<th${cls}>${escapeLetterHtml(col.label)}</th>`;
    })
    .join('');

  const body = rows
    .map((row) => {
      const cells = columns
        .map((col) => {
          const cls = col.align === 'right' ? ' class="num"' : '';
          return `<td${cls}>${escapeLetterHtml(row[col.key] ?? '')}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const foot = footer
    ? `<tfoot><tr>${columns
        .map((col) => {
          const cls = col.align === 'right' ? ' class="num"' : '';
          return `<td${cls}>${escapeLetterHtml(footer[col.key] ?? '')}</td>`;
        })
        .join('')}</tr></tfoot>`
    : '';

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

/** Open Letter print dialog for a titled HTML body fragment. */
export function printLetterReport(title: string, bodyHtml: string): boolean {
  const printWindow = openLetterPrintWindow();
  if (!printWindow) return false;
  writeAndPrintLetterWindow(printWindow, buildLetterDocument(title, bodyHtml));
  return true;
}

/** Open Letter print dialog for a tabular report. */
export function printLetterTableReport(
  title: string,
  columns: LetterTableColumn[],
  rows: LetterTableRow[],
  footer?: LetterTableRow,
): boolean {
  return printLetterReport(title, buildLetterTableHtml(columns, rows, footer));
}
