import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { appDuo, appPage } from "@/store/jotai.ts";
import { duoMemberIds } from "@/lib/duo.ts";

/**
 * The users whose orders this user sees and hears about: themselves, and their duo partner
 * while a duo runs. Stable between renders while the duo does not change.
 */
export const useDuoUserIds = (): string[] => {
  const page = useAtomValue(appPage);
  const duo = useAtomValue(appDuo);
  const userId = page?.user?.id?.toString();
  const members = duoMemberIds(duo).join("|");

  return useMemo(() => {
    if (!userId) {
      return [];
    }
    const ids = members ? members.split("|") : [];
    return ids.includes(userId) ? ids : [userId];
  }, [userId, members]);
};
