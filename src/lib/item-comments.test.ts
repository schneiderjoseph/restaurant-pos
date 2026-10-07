import { describe, expect, it } from 'vitest';
import {
  getItemPourLabel,
  hasItemCommentPreset,
  joinItemComments,
  parseItemPourParts,
  setItemPourComment,
  splitItemComments,
  toggleItemCommentPreset,
} from './item-comments.ts';

describe('item-comments', () => {
  it('splits and joins comma-separated parts', () => {
    expect(splitItemComments('Sans sel,  Sans sucre')).toEqual(['Sans sel', 'Sans sucre']);
    expect(joinItemComments(['Sans sel', 'Sans sucre'])).toBe('Sans sel, Sans sucre');
  });

  it('toggles presets on and off', () => {
    const once = toggleItemCommentPreset('', 'Sans sel');
    expect(once).toBe('Sans sel');
    expect(hasItemCommentPreset(once, 'Sans sel')).toBe(true);
    expect(toggleItemCommentPreset(once, 'Sans sel')).toBe('');
  });

  it('clears POUR when toggling immediate on', () => {
    const withPour = setItemPourComment('Sans sel', '19:30');
    expect(withPour).toBe('Sans sel, POUR 19:30');
    const next = toggleItemCommentPreset(withPour, 'Immédiat', { clearsPour: true });
    expect(next).toBe('Sans sel, Immédiat');
    expect(getItemPourLabel(next)).toBeNull();
  });

  it('sets POUR and clears the immediate preset', () => {
    const next = setItemPourComment('Immédiat, Sans sel', '19:30', {
      immediateLabel: 'Immédiat',
    });
    expect(next).toBe('Sans sel, POUR 19:30');
    expect(getItemPourLabel(next)).toBe('19:30');
  });

  it('clears POUR when dueLabel is null', () => {
    expect(setItemPourComment('Sans sel, POUR 19:30', null)).toBe('Sans sel');
  });

  it('parses simple POUR labels for the picker', () => {
    expect(parseItemPourParts('19:30')).toEqual({
      dayOffset: 0,
      hour: 19,
      minute: 30,
    });
    expect(parseItemPourParts('dem. 08:00')).toEqual({
      dayOffset: 1,
      hour: 8,
      minute: 0,
    });
    expect(parseItemPourParts('06/10 08:00')).toEqual({
      dayOffset: 0,
      hour: 8,
      minute: 0,
    });
  });
});
