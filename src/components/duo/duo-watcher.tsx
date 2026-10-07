import {useCallback, useEffect, useRef, useState} from "react";
import {useAtom, useAtomValue, useSetAtom} from "jotai";
import {useTranslation} from "react-i18next";
import {LiveSubscription} from "surrealdb";
import {toast} from "sonner";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Duo, DuoStatus} from "@/api/model/duo.ts";
import {appDuo, appDuoInvite, appPage} from "@/store/jotai.ts";
import {Button} from "@/components/common/input/button.tsx";
import {
  acceptDuo,
  declineDuo,
  DUO_AUTO_END_SECONDS,
  duoPartnerOf,
  endDuo,
  extendDuo,
  fetchMyDuos,
  isDuoEnding,
  isDuoRunning,
  isDuoStale,
  isInviteLive,
  userName,
} from "@/lib/duo.ts";
import {refKey} from "@/lib/order-edit-request.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {playReadyChime, speakOrderReady} from "@/lib/order-ready-announcement.ts";

const REFRESH_DEBOUNCE_MS = 300;

/**
 * Keeps this terminal's duo (src/lib/duo.ts) for the signed-in user: an invitation shows here
 * to be accepted or refused, the inviter hears the answer, and when the duo's time is up both
 * terminals announce it and end it after DUO_AUTO_END_SECONDS unless someone extends it.
 */
export const DuoWatcher = () => {
  const {t, i18n} = useTranslation('orders');
  const db = useDB();
  const page = useAtomValue(appPage);
  const userId = page?.user?.id?.toString();
  const [running, setRunning] = useAtom(appDuo);
  const setOutgoing = useSetAtom(appDuoInvite);

  const [incoming, setIncoming] = useState<Duo | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  // `useDB()` and `t` are new on every render: read through refs so the effects run once per user.
  const dbRef = useRef(db);
  dbRef.current = db;
  const tRef = useRef(t);
  tRef.current = t;
  const runningIdRef = useRef<string>('');
  const announcedEndRef = useRef<string>('');
  const endingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      return;
    }
    const duos = await fetchMyDuos(dbRef.current, userId);
    const now = Date.now();

    // Both terminals were off when it ended: whoever comes back closes it.
    for (const stale of duos.filter((duo) => isDuoStale(duo, now))) {
      await endDuo(dbRef.current, stale, null).catch(() => undefined);
    }

    const current = duos.find((duo) => isDuoRunning(duo, now)) ?? null;
    const currentId = current ? refKey(current) : '';
    if (currentId && currentId !== runningIdRef.current) {
      toast.success(tRef.current('duo.started', {name: userName(duoPartnerOf(current!, userId))}));
    } else if (!currentId && runningIdRef.current) {
      toast.info(tRef.current('duo.ended'));
    }
    runningIdRef.current = currentId;
    setRunning(current);

    const live = duos.filter((duo) => isInviteLive(duo, now));
    setIncoming(current ? null : live.find((duo) => refKey(duo.partner) === userId) ?? null);
    setOutgoing(current ? null : live.find((duo) => refKey(duo.inviter) === userId) ?? null);
  }, [userId, setRunning, setOutgoing]);

  useEffect(() => {
    setRunning(null);
    setOutgoing(null);
    setIncoming(null);
    runningIdRef.current = '';
    if (!userId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let subscription: LiveSubscription | null = null;

    const scheduleRefresh = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        refresh().catch(error => console.error('Duo check failed', error));
      }, REFRESH_DEBOUNCE_MS);
    };

    const setup = async () => {
      await refresh().catch(error => console.error('Duo check failed', error));
      const live = await dbRef.current.live<Duo>(Tables.duos, (action, duo) => {
        // The inviter hears a refusal here; an acceptance shows as the duo starting.
        if (action === 'UPDATE' && refKey(duo?.inviter) === userId && duo.status === DuoStatus.declined) {
          toast.warning(tRef.current('duo.declined'));
        }
        scheduleRefresh();
      });
      if (cancelled) {
        await live.kill().catch(() => undefined);
        return;
      }
      subscription = live;
    };

    setup().catch(error => console.error('Duo watch failed', error));

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      subscription?.kill().catch(() => undefined);
    };
  }, [userId, refresh, setRunning, setOutgoing]);

  // The clock: every second while a duo runs or an invitation waits, so its end and the
  // invitation's expiry show on time.
  useEffect(() => {
    if (!running && !incoming) {
      return;
    }
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [running, incoming]);

  // A new invitation rings once.
  const incomingId = incoming ? refKey(incoming) : '';
  useEffect(() => {
    if (incomingId) {
      playReadyChime();
    }
  }, [incomingId]);

  const ending = running && isDuoEnding(running, nowMs) ? running : null;
  const endsAtMs = ending?.ends_at ? toLuxonDateTime(ending.ends_at).toMillis() : 0;
  const secondsLeft = ending
    ? Math.max(0, DUO_AUTO_END_SECONDS - Math.floor((nowMs - endsAtMs) / 1000))
    : DUO_AUTO_END_SECONDS;

  // Announce the end once per end time (an extension announces again at its new end).
  useEffect(() => {
    if (!ending) {
      return;
    }
    const key = `${refKey(ending)}@${endsAtMs}`;
    if (announcedEndRef.current === key) {
      return;
    }
    announcedEndRef.current = key;
    playReadyChime();
    speakOrderReady(tRef.current('duo.endingSpeech'), i18n.language);
  }, [ending, endsAtMs, i18n.language]);

  const finish = useCallback(async (duo: Duo) => {
    if (endingRef.current) {
      return;
    }
    endingRef.current = true;
    try {
      await endDuo(dbRef.current, duo, userId ?? null, duo.ends_at);
      await refresh();
    } catch (error) {
      console.error('Duo end failed', error);
    } finally {
      endingRef.current = false;
    }
  }, [userId, refresh]);

  // Nobody answered: the duo ends by itself.
  useEffect(() => {
    if (ending && secondsLeft <= 0) {
      void finish(ending);
    }
  }, [ending, secondsLeft, finish]);

  const extend = async (duo: Duo) => {
    setBusy(true);
    try {
      await extendDuo(db, duo, duo.ends_at);
      await refresh();
    } catch (error) {
      console.error('Duo extend failed', error);
      toast.error(t('duo.failed'));
    } finally {
      setBusy(false);
    }
  };

  const answer = async (duo: Duo, accept: boolean) => {
    setBusy(true);
    try {
      if (accept) {
        const result = await acceptDuo(db, duo);
        if (result === 'busy') {
          toast.warning(t('duo.busy'));
        } else if (result === 'gone') {
          toast.warning(t('duo.gone'));
        }
      } else {
        await declineDuo(db, duo);
      }
      await refresh();
    } catch (error) {
      console.error('Duo answer failed', error);
      toast.error(t('duo.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (ending && userId) {
    return (
      <div
        className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duo-ending-title"
        data-testid="duo-ending"
      >
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border-4 border-warning-500 bg-white p-8 text-center shadow-2xl">
          <p id="duo-ending-title" className="text-2xl font-bold uppercase text-warning-700">
            {t('duo.endingTitle')}
          </p>
          <p className="text-xl">{t('duo.endingWith', {name: userName(duoPartnerOf(ending, userId))})}</p>
          <div className="flex w-full gap-3">
            <Button
              variant="primary"
              flat
              size="lg"
              className="flex-1"
              disabled={busy}
              data-testid="duo-extend"
              onClick={() => void extend(ending)}
            >
              {t('duo.extend')}
            </Button>
            <Button
              variant="warning"
              size="lg"
              className="flex-1"
              disabled={busy}
              data-testid="duo-end-confirm"
              onClick={() => void finish(ending)}
            >
              {t('duo.endNow', {seconds: secondsLeft})}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!incoming || !isInviteLive(incoming, nowMs) || !userId || page?.locked) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="duo-invite-title"
      data-testid="duo-invite"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-3xl border-4 border-primary-500 bg-white p-8 text-center shadow-2xl">
        <p id="duo-invite-title" className="text-2xl font-bold uppercase">{t('duo.inviteTitle')}</p>
        <p className="text-xl">{t('duo.inviteFrom', {name: userName(duoPartnerOf(incoming, userId))})}</p>
        <div className="flex w-full gap-3">
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            disabled={busy}
            data-testid="duo-invite-decline"
            onClick={() => void answer(incoming, false)}
          >
            {t('duo.decline')}
          </Button>
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            disabled={busy}
            isLoading={busy}
            data-testid="duo-invite-accept"
            onClick={() => void answer(incoming, true)}
          >
            {t('duo.accept')}
          </Button>
        </div>
      </div>
    </div>
  );
};
