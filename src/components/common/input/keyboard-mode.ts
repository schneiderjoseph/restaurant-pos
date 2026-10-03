const NON_TEXT_TYPES = new Set([
  'checkbox',
  'radio',
  'file',
  'hidden',
  'color',
  'range',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
]);

/** Whether an input opens the POS keyboard: touch mode, a text-like type, and not opted out. */
export const usesPosKeyboard = (
  touch: boolean | undefined,
  type: string | undefined,
  enableKeyboard: boolean | undefined,
): boolean => {
  if (!touch) return false;
  if (enableKeyboard === false) return false;
  const resolvedType = type ?? 'text';
  if (NON_TEXT_TYPES.has(resolvedType)) return false;
  return true;
};
