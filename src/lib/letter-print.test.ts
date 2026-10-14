import { describe, expect, it } from 'vitest';
import { buildLetterDocument, LETTER_PAGE_CSS } from './letter-print.ts';
import { buildLetterTableHtml } from './summary-letter-print.ts';

describe('letter print', () => {
  it('uses Letter 8.5x11 page size', () => {
    expect(LETTER_PAGE_CSS).toContain('size: letter');
    const html = buildLetterDocument('Daily summary', '<p>ok</p>');
    expect(html).toContain('size: letter');
    expect(html).toContain('Daily summary');
    expect(html).toContain('<p>ok</p>');
  });

  it('builds a table with numeric columns and footer', () => {
    const html = buildLetterTableHtml(
      [
        { key: 'item', label: 'Item' },
        { key: 'qty', label: 'Qty', align: 'right' },
        { key: 'total', label: 'Total', align: 'right' },
      ],
      [{ item: 'Cola', qty: '2', total: '10' }],
      { item: 'Total', qty: '2', total: '10' },
    );
    expect(html).toContain('<th>Item</th>');
    expect(html).toContain('class="num"');
    expect(html).toContain('<tfoot>');
    expect(html).toContain('Cola');
  });
});
