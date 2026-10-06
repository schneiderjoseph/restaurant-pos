import React, {useState} from "react";

/**
 * Tap a line, then tap the split it goes to. HTML drag and drop never fires on touch
 * screens, so without this a line cannot leave its split on the POS tablets.
 */
export const useTapToMove = <T extends {id: unknown}>(move: (item: T, splitId: string) => void) => {
  const [selected, setSelected] = useState<T | null>(null);
  const isSelected = (item: T) => selected != null && String(selected.id) === String(item.id);

  return {
    selected,
    isSelected,
    itemProps: (item: T) => ({
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        setSelected(isSelected(item) ? null : item);
      },
      role: 'button',
      'aria-pressed': isSelected(item),
    }),
    splitProps: (splitId: string) => ({
      onClick: () => {
        if (selected) {
          move(selected, splitId);
          setSelected(null);
        }
      },
    }),
  };
};

/** Highlight for the line picked to be moved. */
export const tapSelectedClass = 'ring-2 ring-primary-500 bg-primary-50';
