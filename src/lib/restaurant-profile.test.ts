import { describe, expect, it } from 'vitest';
import {
  applyRestaurantProfileToPrintConfig,
  restaurantProfileHeaderSections,
} from '@/lib/restaurant-profile.ts';
import type { RestaurantProfile } from '@/api/model/restaurant_profile.ts';

const profile: RestaurantProfile = {
  name: 'Cafe Test',
  address: '12 Rue Demo',
  phone: '555-0100',
  email: 'hi@cafe.test',
  website: 'https://cafe.test',
  taxId: 'NIF-1',
  logo: null,
};

describe('restaurant profile print merge', () => {
  it('builds header lines from profile fields', () => {
    const sections = restaurantProfileHeaderSections(profile);
    expect(sections.map((s) => s.content)).toEqual([
      'Cafe Test',
      '12 Rue Demo',
      '555-0100 · hi@cafe.test',
      'https://cafe.test',
      'NIF-1',
    ]);
  });

  it('fills logo and headers when the print type has none', () => {
    const merged = applyRestaurantProfileToPrintConfig(
      { showLogo: true },
      profile,
      'data:image/png;base64,abc'
    );
    expect(merged.logo).toBe('data:image/png;base64,abc');
    expect(merged.showLogo).toBe(true);
    expect(merged.vatNumber).toBe('NIF-1');
    expect(Array.isArray(merged.headerSections)).toBe(true);
  });

  it('keeps an existing print-type logo', () => {
    const merged = applyRestaurantProfileToPrintConfig(
      { logo: 'data:image/png;base64,keep', showLogo: true, headerSections: [{ type: 'text', content: 'Custom', enabled: true }] },
      profile,
      'data:image/png;base64,abc'
    );
    expect(merged.logo).toBe('data:image/png;base64,keep');
    expect(merged.headerSections).toEqual([{ type: 'text', content: 'Custom', enabled: true }]);
  });
});
