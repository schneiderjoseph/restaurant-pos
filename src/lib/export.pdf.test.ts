import { describe, expect, it } from 'vitest';
import { sanitizePdfFilename } from '@/lib/export.pdf.ts';

describe('export.pdf helpers', () => {
  it('sanitizes download names', () => {
    expect(sanitizePdfFilename('Sales Summary / Q1')).toBe('Sales-Summary-Q1.pdf');
    expect(sanitizePdfFilename('rapport.pdf')).toBe('rapport.pdf');
    expect(sanitizePdfFilename('')).toBe('report.pdf');
  });
});
