import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { LiveSubscription } from 'surrealdb';
import { toast } from 'sonner';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import {
  CustomerCreditRequest,
  CustomerCreditRequestStatus,
} from '@/api/model/customer_credit_request.ts';
import { appPage } from '@/store/jotai.ts';
import { Button } from '@/components/common/input/button.tsx';
import { fetchUserModules, userModulesGrant } from '@/lib/access.rules.ts';
import { formatOrderNumber } from '@/lib/order.ts';
import { playReadyChime } from '@/lib/order-ready-announcement.ts';
import { postOrderTracking } from '@/lib/tracking.service.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';
import { withCurrency } from '@/lib/utils.ts';
import {
  APPROVE_CREDIT_MODULE,
  approveCreditRequest,
  CREDIT_REQUEST_DECIDED_EVENT,
  dispatchCreditRequestDecided,
  fetchPendingCreditRequests,
  rejectCreditRequest,
  type CreditRequestDecision,
} from '@/lib/credit-request.ts';
import { refKey } from '@/lib/order-edit-request.ts';

const REFRESH_DEBOUNCE_MS = 500;

/**
 * House-credit open requests: holders of `credit.approve` decide on their terminal and set an
 * optional limit. The cashier who asked is told the answer; Credit tender stays a house charge,
 * not cash collected.
 */
export const CreditRequestWatcher = () => {
  const { t } = useTranslation(['orders', 'payment']);
  const db = useDB();
  const page = useAtomValue(appPage);
  const user = page?.user;
  const userId = user?.id?.toString();

  const [canApprove, setCanApprove] = useState(false);
  const [requests, setRequests] = useState<CustomerCreditRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitInput, setLimitInput] = useState('');
  const knownIdsRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  userRef.current = user;
  const dbRef = useRef(db);
  dbRef.current = db;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    setCanApprove(false);
    setRequests([]);
    setOpen(false);
    setLimitInput('');
    knownIdsRef.current = new Set();
    if (!userId) return;

    let cancelled = false;
    fetchUserModules(dbRef.current, userRef.current)
      .then((modules) => {
        if (!cancelled) {
          setCanApprove(userModulesGrant(modules, APPROVE_CREDIT_MODULE));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    const pending = await fetchPendingCreditRequests(dbRef.current);
    const hasNew = pending.some((request) => !knownIdsRef.current.has(refKey(request)));
    knownIdsRef.current = new Set(pending.map(refKey));
    setRequests(pending);
    if (hasNew) {
      setOpen(true);
      setLimitInput('');
      playReadyChime();
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let subscription: LiveSubscription | null = null;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refresh().catch((error) => console.error('Credit requests check failed', error));
      }, REFRESH_DEBOUNCE_MS);
    };

    const setup = async () => {
      if (canApprove) {
        await refresh().catch((error) => console.error('Credit requests check failed', error));
      }
      const live = await dbRef.current.live<CustomerCreditRequest>(
        Tables.customer_credit_requests,
        (action, request) => {
          if (canApprove) {
            scheduleRefresh();
          }
          if (action !== 'UPDATE' || refKey(request?.requested_by) !== userId) {
            return;
          }
          if (request.status === CustomerCreditRequestStatus.approved) {
            toast.success(tRef.current('creditRequest.answerApproved'));
            dispatchCreditRequestDecided(request.customer);
          } else if (request.status === CustomerCreditRequestStatus.rejected) {
            toast.error(tRef.current('creditRequest.answerRejected'));
            dispatchCreditRequestDecided(request.customer);
          } else if (request.status === CustomerCreditRequestStatus.expired) {
            toast.warning(tRef.current('creditRequest.answerExpired'));
            dispatchCreditRequestDecided(request.customer);
          }
        },
      );
      if (cancelled) {
        await live.kill().catch(() => undefined);
        return;
      }
      subscription = live;
    };

    setup().catch((error) => console.error('Credit requests watch failed', error));

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription?.kill().catch(() => undefined);
    };
  }, [userId, canApprove, refresh]);

  const decide = async (request: CustomerCreditRequest, approve: boolean) => {
    setBusy(true);
    try {
      let decision: CreditRequestDecision;
      if (approve) {
        const trimmed = limitInput.trim().replace(',', '.');
        const limit = trimmed === '' ? null : Number(trimmed);
        if (trimmed !== '' && (!Number.isFinite(limit) || (limit as number) <= 0)) {
          toast.error(t('creditRequest.invalidLimit'));
          return;
        }
        decision = await approveCreditRequest(db, request, userId, limit);
      } else {
        decision = await rejectCreditRequest(db, request, userId);
      }

      if (decision === 'approved') {
        toast.success(t('creditRequest.approved'));
        dispatchCreditRequestDecided(request.customer);
      } else if (decision === 'rejected') {
        toast.success(t('creditRequest.rejected'));
        dispatchCreditRequestDecided(request.customer);
      } else if (decision === 'expired') {
        toast.warning(t('creditRequest.expired'));
      } else {
        toast.info(t('creditRequest.taken'));
      }

      if (decision === 'approved' || decision === 'rejected') {
        postOrderTracking({
          module: APPROVE_CREDIT_MODULE,
          page: page?.page,
          orderId: request.order ? refKey(request.order) : undefined,
          payload: {
            request: refKey(request),
            decision,
            customer: refKey(request.customer),
            requested_by: refKey(request.requested_by),
            approved_limit: approve ? (limitInput.trim() || null) : undefined,
          },
          user,
        });
      }
      setLimitInput('');
      await refresh();
    } catch (error) {
      console.error('Credit request decision failed', error);
      toast.error(t('creditRequest.failed'));
    } finally {
      setBusy(false);
    }
  };

  const current = requests[0];
  if (!canApprove || !current || page?.locked) {
    return null;
  }

  if (!open) {
    return (
      <div className="fixed left-1/2 top-2 z-[1000] -translate-x-1/2">
        <Button
          variant="warning"
          filled
          size="lg"
          data-testid="credit-requests-open"
          onClick={() => {
            setOpen(true);
            setLimitInput('');
          }}
        >
          {t('creditRequest.pendingCount', { count: requests.length })}
        </Button>
      </div>
    );
  }

  const guest = current.customer ? formatGuestLabel(current.customer) : '';
  const requester = `${current.requested_by?.first_name ?? ''} ${current.requested_by?.last_name ?? ''}`.trim();
  const order = current.order;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="credit-request-title"
      data-testid="credit-request"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col gap-4 rounded-3xl border-4 border-warning-500 bg-white p-6 shadow-2xl">
        <div className="text-center">
          <p id="credit-request-title" className="text-xl font-bold uppercase text-warning-700">
            {t('creditRequest.title')}
          </p>
          {requests.length > 1 && (
            <p className="text-sm text-neutral-600">{t('creditRequest.more', { count: requests.length - 1 })}</p>
          )}
        </div>
        <div className="text-center space-y-1">
          <p className="text-3xl font-black">{guest}</p>
          {order && (
            <p className="text-lg font-semibold tabular-nums">{formatOrderNumber(order)}</p>
          )}
          <p className="text-neutral-700">{t('creditRequest.requestedBy', { name: requester })}</p>
          <p className="text-sm text-neutral-600">{t('creditRequest.notAPayment')}</p>
        </div>
        <div className="space-y-2" data-testid="credit-request-limit">
          <label className="block text-sm font-semibold" htmlFor="credit-request-limit-input">
            {t('creditRequest.limitLabel')}
          </label>
          <input
            id="credit-request-limit-input"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className="w-full rounded-lg border border-neutral-300 px-3 py-3 text-lg"
            placeholder={t('creditRequest.limitPlaceholder')}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-neutral-500">
            {limitInput.trim()
              ? t('creditRequest.limitPreview', {
                  amount: withCurrency(Number(limitInput.replace(',', '.')) || 0),
                })
              : t('creditRequest.limitOptional')}
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            disabled={busy}
            data-testid="credit-request-reject"
            onClick={() => void decide(current, false)}
          >
            {t('creditRequest.reject')}
          </Button>
          <Button
            variant="primary"
            flat
            size="lg"
            className="flex-1"
            disabled={busy}
            data-testid="credit-request-later"
            onClick={() => setOpen(false)}
          >
            {t('creditRequest.later')}
          </Button>
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            disabled={busy}
            isLoading={busy}
            data-testid="credit-request-approve"
            onClick={() => void decide(current, true)}
          >
            {t('creditRequest.approve')}
          </Button>
        </div>
      </div>
    </div>
  );
};
