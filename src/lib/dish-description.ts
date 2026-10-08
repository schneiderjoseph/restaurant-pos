import type { DishDescription } from '@/api/model/dish.ts';

/** Languages tried after the UI language: the house menu is written in French then English. */
const FALLBACK_LANGUAGES = ['fr', 'en'];

const textOf = (description: DishDescription | null | undefined, lang: string): string =>
  (description?.[lang] ?? '').trim();

const rank = (lang: string) => {
  const index = FALLBACK_LANGUAGES.indexOf(lang);
  return index === -1 ? FALLBACK_LANGUAGES.length : index;
};

/** Language codes holding a non-empty text: French, English, then the others as stored. */
export const dishDescriptionLanguages = (description: DishDescription | null | undefined): string[] =>
  Object.keys(description ?? {})
    .filter((lang) => textOf(description, lang) !== '')
    .sort((a, b) => rank(a) - rank(b));

/**
 * The description to show for the UI language: exact code, then its base ("pt-BR" → "pt"),
 * then French, English, then any language that has a text. Null when the dish has none.
 */
export const pickDishDescription = (
  description: DishDescription | null | undefined,
  uiLanguage: string,
): { lang: string; text: string } | null => {
  const available = dishDescriptionLanguages(description);
  if (available.length === 0) {
    return null;
  }
  const base = uiLanguage.split('-')[0];
  const candidates = [uiLanguage, base, ...FALLBACK_LANGUAGES, ...available];
  const lang = candidates.find((code) => available.includes(code)) ?? available[0];
  return { lang, text: textOf(description, lang) };
};

/** Trimmed copy without empty languages; null when nothing is left (clears the field). */
export const cleanDishDescription = (
  description: Record<string, string | null | undefined> | null | undefined,
): DishDescription | null => {
  const cleaned: DishDescription = {};
  for (const [lang, text] of Object.entries(description ?? {})) {
    const value = (text ?? '').trim();
    if (value) {
      cleaned[lang] = value;
    }
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
};
