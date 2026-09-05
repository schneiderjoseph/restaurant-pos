'use strict';

/**
 * ASI group aliases that route to Bar (BDS).
 * Keep in sync with docs/integrations/ASI-DISCOVERY.md and resort-stations BAR hints.
 */
const BAR_GROUP_ALIASES = new Set([
  'MOC',
  'JUS',
  'NALC',
  'BEER',
  'CF',
  'CK',
  'CT',
  'LQ',
  'SPI',
  'VM',
]);

const BAR_NAME_HINTS = [
  'mocktail',
  'cocktail',
  'beer',
  'bière',
  'biere',
  'jus',
  'non-alcool',
  'soft',
  'cafe',
  'café',
  'thé',
  'tea',
  'liqueur',
  'spirit',
  'vin',
  'mousseux',
  'wine',
];

function isBarGroup(alias, name) {
  const a = String(alias || '')
    .trim()
    .toUpperCase();
  if (a && BAR_GROUP_ALIASES.has(a)) return true;
  const n = String(name || '')
    .trim()
    .toLowerCase();
  return BAR_NAME_HINTS.some((h) => n.includes(h));
}

function stationForGroup(alias, name) {
  return isBarGroup(alias, name) ? 'bar' : 'cuisine';
}

module.exports = {
  BAR_GROUP_ALIASES,
  isBarGroup,
  stationForGroup,
};
