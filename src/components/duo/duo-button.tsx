import {useEffect, useRef, useState} from "react";
import {useAtomValue} from "jotai";
import {useTranslation} from "react-i18next";
import {toast} from "sonner";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faUserGroup} from "@fortawesome/free-solid-svg-icons";
import {useDB} from "@/api/db/db.ts";
import {User} from "@/api/model/user.ts";
import {appDuo, appDuoInvite, appPage} from "@/store/jotai.ts";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {
  cancelDuoInvite,
  duoPartnerOf,
  endDuo,
  fetchDuoCandidates,
  inviteToDuo,
  isInviteLive,
  userName,
} from "@/lib/duo.ts";
import {refKey} from "@/lib/order-edit-request.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {cn} from "@/lib/utils.ts";

/**
 * Sidebar entry for the duo (src/lib/duo.ts): shows the partner while one runs, and opens the
 * window to invite a signed-in colleague, withdraw the invitation, or leave the duo.
 */
export const DuoButton = () => {
  const {t} = useTranslation('orders');
  const db = useDB();
  const page = useAtomValue(appPage);
  const userId = page?.user?.id?.toString() ?? '';
  const running = useAtomValue(appDuo);
  const outgoing = useAtomValue(appDuoInvite);

  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<User[] | null>(null);
  const [busy, setBusy] = useState(false);
  const dbRef = useRef(db);
  dbRef.current = db;

  const waiting = outgoing && isInviteLive(outgoing, Date.now()) ? outgoing : null;
  const partner = running ? duoPartnerOf(running, userId) : undefined;

  useEffect(() => {
    if (!open || running || waiting || !userId) {
      return;
    }
    let cancelled = false;
    setCandidates(null);
    fetchDuoCandidates(dbRef.current, userId)
      .then((users) => {
        if (!cancelled) {
          setCandidates(users);
        }
      })
      .catch((error) => {
        console.error('Duo candidates failed', error);
        if (!cancelled) {
          setCandidates([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, running, waiting, userId]);

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      if (done) {
        toast.success(done);
      }
    } catch (error) {
      console.error('Duo action failed', error);
      toast.error(t('duo.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!userId) {
    return null;
  }

  const label = partner ? t('duo.withShort', {name: partner.first_name || userName(partner)}) : t('duo.title');

  return (
    <>
      <button
        type="button"
        data-testid="nav-duo"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full flex-col items-center gap-1 rounded-xl p-[0.4rem] pressable border-[3px]',
          running ? 'border-success-500 bg-success-100 text-success-800' : 'border-transparent text-neutral-900',
        )}
      >
        <FontAwesomeIcon icon={faUserGroup} size="lg"/>
        <span className="label w-full truncate text-[12px] font-semibold">{label}</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} size="sm" title={t('duo.title')} testId="duo-modal">
        {running ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg">{t('duo.with', {name: userName(partner)})}</p>
            {running.ends_at && (
              <p className="text-neutral-600">
                {t('duo.endsAt', {time: toLuxonDateTime(running.ends_at).toFormat('HH:mm')})}
              </p>
            )}
            <Button
              variant="danger"
              size="lg"
              disabled={busy}
              isLoading={busy}
              data-testid="duo-leave"
              onClick={() => void act(async () => {
                await endDuo(db, running, userId);
                setOpen(false);
              })}
            >
              {t('duo.leave')}
            </Button>
          </div>
        ) : waiting ? (
          <div className="flex flex-col gap-4">
            <p className="text-lg">{t('duo.waiting', {name: userName(waiting.partner as User)})}</p>
            <Button
              variant="danger"
              size="lg"
              disabled={busy}
              data-testid="duo-invite-cancel"
              onClick={() => void act(() => cancelDuoInvite(db, waiting))}
            >
              {t('duo.cancelInvite')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-neutral-600">{t('duo.pick')}</p>
            {candidates === null && <p>{t('duo.loading')}</p>}
            {candidates?.length === 0 && <p className="text-neutral-600">{t('duo.nobody')}</p>}
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {candidates?.map((user) => (
                <Button
                  key={refKey(user)}
                  variant="primary"
                  flat
                  size="lg"
                  disabled={busy}
                  data-testid="duo-candidate"
                  onClick={() => void act(
                    () => inviteToDuo(db, userId, refKey(user)),
                    t('duo.sent', {name: userName(user)}),
                  )}
                >
                  {userName(user)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};
