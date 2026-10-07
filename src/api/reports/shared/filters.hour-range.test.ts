import {describe, expect, it} from 'vitest';
import {parseHourRangeFromPhrase} from '@/api/reports/shared/filters.ts';

describe('parseHourRangeFromPhrase', () => {
  it('keeps a morning range in the morning', () => {
    expect(parseHourRangeFromPhrase('9 am - 11 am')).toEqual({startHour: 9, endHour: 11});
  });

  it('applies a single pm to both sides', () => {
    expect(parseHourRangeFromPhrase('6-9 pm')).toEqual({startHour: 18, endHour: 21});
  });

  it('reads each side on its own', () => {
    expect(parseHourRangeFromPhrase('11 am to 2 pm')).toEqual({startHour: 11, endHour: 14});
  });

  it('does not push a bare morning start past a pm end', () => {
    expect(parseHourRangeFromPhrase('11 - 2 pm')).toEqual({startHour: 11, endHour: 14});
  });
});
