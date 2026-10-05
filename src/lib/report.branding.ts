import type { RestaurantProfile } from '@/api/model/restaurant_profile.ts';

export function sanitizeReportFilename(name: string, extension: 'pdf' | 'xlsx' | 'png'): string {
  const base = name.replace(new RegExp(`\\.${extension}$`, 'i'), '').trim() || 'report';
  const slug = base
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${slug || 'report'}.${extension}`;
}

export type ReportBrandingHeader = {
  title: string;
  subtitle?: string;
  generatedAt: string;
  profile: Pick<RestaurantProfile, 'name' | 'address' | 'phone' | 'email' | 'website' | 'taxId'>;
};

/** Rows prepended to XLSX exports (restaurant info + report meta). */
export function buildReportExcelHeaderRows(branding: ReportBrandingHeader): (string | number)[][] {
  const { profile, title, subtitle, generatedAt } = branding;
  const rows: (string | number)[][] = [];

  if (profile.name) rows.push([profile.name]);
  if (profile.address) {
    profile.address
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => rows.push([line]));
  }
  const contact = [profile.phone, profile.email].filter(Boolean).join(' · ');
  if (contact) rows.push([contact]);
  if (profile.website) rows.push([profile.website]);
  if (profile.taxId) rows.push([profile.taxId]);
  rows.push([]);
  rows.push([title]);
  if (subtitle) rows.push([subtitle]);
  rows.push([generatedAt]);
  rows.push([]);

  return rows;
}
