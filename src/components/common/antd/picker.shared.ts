import { useAtom } from "jotai";
import { appPage } from "@/store/jotai.ts";

export const antPickerPopupProps = {
  placement: "bottomLeft" as const,
  getPopupContainer: (trigger: HTMLElement) =>
    (trigger.closest(".react-aria-Modal") as HTMLElement) ?? trigger.parentElement!,
  styles: {
    popup: {
      root: {zIndex: 1100},
    },
  },
};

/**
 * Touch mode: the picker field is read-only, so tapping it opens the calendar without
 * raising the device keyboard. With touch mode off the value can still be typed.
 */
export const usePickerTouchProps = () => {
  const [page] = useAtom(appPage);
  return { inputReadOnly: !!page.touch };
};
