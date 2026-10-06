import { describe, expect, it } from 'vitest';
import { sanitizePdfFilename } from '@/lib/export.pdf.ts';
import {
  buildReportExcelHeaderRows,
  sanitizeReportFilename,
} from '@/lib/report.branding.ts';

describe('export.pdf helpers', () => {
  it('sanitizes download names', () => {
    expect(sanitizePdfFilename('Sales Summary / Q1')).toBe('Sales-Summary-Q1.pdf');
    expect(sanitizePdfFilename('rapport.pdf')).toBe('rapport.pdf');
    expect(sanitizePdfFilename('')).toBe('report.pdf');
  });
});

describe('report.branding helpers', () => {
  it('sanitizes xlsx/png filenames', () => {
    expect(sanitizeReportFilename('Sales Summary / Q1', 'xlsx')).toBe('Sales-Summary-Q1.xlsx');
    expect(sanitizeReportFilename('rapport.xlsx', 'xlsx')).toBe('rapport.xlsx');
  });

  it('builds excel header with restaurant info', () => {
    const rows = buildReportExcelHeaderRows({
      title: 'Sales Summary',
      subtitle: '2026-01-01 to 2026-01-31',
      generatedAt: 'Generated at 2026-01-31 12:00',
      profile: {
        name: 'Test Bistro',
        address: '1 Main St',
        phone: '555',
        email: 'a@b.c',
        website: 'https://example.com',
        taxId: 'TAX-1',
      },
    });
    expect(rows[0]).toEqual(['Test Bistro']);
    expect(rows.some((row) => row[0] === 'Sales Summary')).toBe(true);
    expect(rows.some((row) => row[0] === 'TAX-1')).toBe(true);
  });
});
