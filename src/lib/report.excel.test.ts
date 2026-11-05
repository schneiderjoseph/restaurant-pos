import {describe, expect, it} from 'vitest';
import {buildReportWorkbook, parseDisplayedValue, type ExtractedSection} from '@/lib/report.excel.ts';

describe('parseDisplayedValue', () => {
  it('parses fr-HT money with narrow no-break spaces and a trailing G', () => {
    expect(parseDisplayedValue('-1 234 567,50 G', 'fr-HT')).toEqual({kind: 'number', value: -1234567.5, format: 'money'});
    expect(parseDisplayedValue('2 500 G', 'fr-HT')).toEqual({kind: 'number', value: 2500, format: 'money'});
  });

  it('parses en-US money, plain numbers and percents', () => {
    expect(parseDisplayedValue('$1,234.50', 'en-US')).toEqual({kind: 'number', value: 1234.5, format: 'money'});
    expect(parseDisplayedValue('-$12.00', 'en-US')).toEqual({kind: 'number', value: -12, format: 'money'});
    expect(parseDisplayedValue('(45.00)', 'en-US')).toEqual({kind: 'number', value: -45, format: 'number'});
    expect(parseDisplayedValue('42', 'en-US')).toEqual({kind: 'number', value: 42, format: 'integer'});
    expect(parseDisplayedValue('12.5%', 'en-US')).toEqual({kind: 'number', value: 0.125, format: 'percent'});
    expect(parseDisplayedValue('12,5 %', 'fr-HT')).toEqual({kind: 'number', value: 0.125, format: 'percent'});
  });

  it('keeps the primary amount of a dual-currency value', () => {
    expect(parseDisplayedValue('1 000 G ($7.50)', 'fr-HT')).toEqual({kind: 'number', value: 1000, format: 'money'});
  });

  it('leaves identifiers, dates, times and words as text', () => {
    for (const s of ['00125', '05/11/2026', '12:30', 'Table 4', '509 3456 7890', '2026-11-05', 'Grand total']) {
      expect(parseDisplayedValue(s, 'en-US').kind, s).toBe('text');
    }
    expect(parseDisplayedValue('1,234', 'fr-HT').kind).toBe('number'); // "1,234" = 1.234 in fr
  });
});

describe('buildReportWorkbook', () => {
  const sections: ExtractedSection[] = [
    {
      type: 'kpis',
      title: 'Indicateurs',
      items: [{label: 'Ventes nettes', value: '$1,000.00', parsed: {kind: 'number', value: 1000, format: 'money'}}],
    },
    {type: 'insights', title: 'À retenir', lines: ['Les ventes ont augmenté de 12 %']},
    {
      type: 'table',
      title: 'Détail',
      rows: [
        {role: 'header', cells: [
          {text: 'Produit', parsed: {kind: 'text', value: 'Produit'}, colSpan: 1, header: true},
          {text: 'Montant', parsed: {kind: 'text', value: 'Montant'}, colSpan: 1, header: true},
        ]},
        {role: 'body', cells: [
          {text: 'Café', parsed: {kind: 'text', value: 'Café'}, colSpan: 1, header: false},
          {text: '$10.00', parsed: {kind: 'number', value: 10, format: 'money'}, colSpan: 1, header: false},
        ]},
        {role: 'total', cells: [
          {text: 'Total', parsed: {kind: 'text', value: 'Total'}, colSpan: 1, header: false},
          {text: '$10.00', parsed: {kind: 'number', value: 10, format: 'money'}, colSpan: 1, header: false},
        ]},
      ],
    },
  ];

  it('writes real numbers, a frozen header and an autofilter', async () => {
    const wb = await buildReportWorkbook({
      branding: {title: 'Ventes', subtitle: '01/11 → 05/11', generatedAt: 'Généré le 05/11/2026', profile: {name: 'Cormier', address: '', phone: '', email: '', website: '', taxId: ''}},
      sections,
    });
    const ws = wb.getWorksheet('Rapport')!;
    const values: unknown[] = [];
    ws.eachRow((r) => r.eachCell((c) => values.push(c.value)));
    expect(values).toContain('Ventes');
    expect(values).toContain(1000);
    expect(values).toContain(10);
    expect(values).toContain('• Les ventes ont augmenté de 12 %');
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]).toMatchObject({state: 'frozen'});
    const buffer = await wb.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});
