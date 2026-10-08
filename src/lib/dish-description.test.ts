import { describe, expect, it } from 'vitest';
import {
  cleanDishDescription,
  dishDescriptionLanguages,
  pickDishDescription,
} from '@/lib/dish-description.ts';

describe('pickDishDescription', () => {
  const description = { fr: 'Tomates fraîches.', en: 'Fresh tomatoes.' };

  it('uses the UI language when the dish has it', () => {
    expect(pickDishDescription(description, 'en')).toEqual({ lang: 'en', text: 'Fresh tomatoes.' });
    expect(pickDishDescription(description, 'fr')).toEqual({ lang: 'fr', text: 'Tomates fraîches.' });
  });

  it('falls back to the base language, then French, then English, then any', () => {
    expect(pickDishDescription({ pt: 'Tomates.', en: 'x' }, 'pt-BR')?.lang).toBe('pt');
    expect(pickDishDescription(description, 'es')?.lang).toBe('fr');
    expect(pickDishDescription({ en: 'Fresh tomatoes.' }, 'es')?.lang).toBe('en');
    expect(pickDishDescription({ de: 'Tomaten.' }, 'es')).toEqual({ lang: 'de', text: 'Tomaten.' });
  });

  it('skips empty texts and returns null without any', () => {
    expect(pickDishDescription({ fr: '  ', en: 'Fresh.' }, 'fr')?.lang).toBe('en');
    expect(pickDishDescription({ fr: '' }, 'fr')).toBeNull();
    expect(pickDishDescription(null, 'fr')).toBeNull();
    expect(pickDishDescription(undefined, 'fr')).toBeNull();
  });
});

describe('dishDescriptionLanguages', () => {
  it('lists the languages that have a text', () => {
    expect(dishDescriptionLanguages({ fr: 'a', en: '', es: 'b' })).toEqual(['fr', 'es']);
    expect(dishDescriptionLanguages(null)).toEqual([]);
  });

  it('puts French and English first', () => {
    expect(dishDescriptionLanguages({ es: 'c', en: 'b', fr: 'a' })).toEqual(['fr', 'en', 'es']);
  });
});

describe('cleanDishDescription', () => {
  it('trims and drops empty languages', () => {
    expect(cleanDishDescription({ fr: ' Bon. ', en: '  ', es: undefined })).toEqual({ fr: 'Bon.' });
  });

  it('returns null when nothing is left, so the field is cleared', () => {
    expect(cleanDishDescription({ fr: '', en: ' ' })).toBeNull();
    expect(cleanDishDescription(null)).toBeNull();
  });
});
