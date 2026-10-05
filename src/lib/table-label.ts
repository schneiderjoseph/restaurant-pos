import i18n from 'i18next';

type TableLike = {
  name?: string | null;
  number?: string | number | null;
  source?: string | null;
  asi_alias?: string | null;
} | null | undefined;

/**
 * Short place code shown on screens: "T7", "B3". A hotel room (ASI FrontDesk unit) is stored
 * as R + number and reads CH20 in French, R20 in every other language.
 */
export const formatTableLabel = (table: TableLike, language: string = i18n.language ?? ''): string => {
  if (!table) return '';
  const number = String(table.number ?? '').trim();

  if (table.source === 'asi-room') {
    const prefix = language.toLowerCase().startsWith('fr') ? 'CH' : 'R';
    return `${prefix}${number || String(table.asi_alias ?? '').trim()}`;
  }

  return `${table.name ?? ''}${number}`.trim();
};
