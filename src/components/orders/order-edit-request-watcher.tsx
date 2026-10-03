import {useCallback, useEffect, useRef, useState} from "react";
import {useAtomValue} from "jotai";
import {useTranslation} from "react-i18next";
import {LiveSubscription} from "surrealdb";
import {toast} from "sonner";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {OrderEditRequest, OrderEditRequestStatus, SentLineChange} from "@/api/model/order_edit_request.ts";
import {appPage} from "@/store/jotai.ts";
import {Button} from "@/components/common/input/button.tsx";
import {fetchUserModules, userModulesGrant} from "@/lib/access.rules.ts";
import {formatOrderNumber} from "@/lib/order.ts";
import {playReadyChime} from "@/lib/order-ready-announcement.ts";
import {postOrderTracking} from "@/lib/tracking.service.ts";
import {printApprovedOrderEdit} from "@/lib/kitchen/print-order-edit.ts";
import type {KitchenGuestLabelMode} from "@/lib/kitchen-ticket-label.ts";
import {
  approveOrderEditRequest,
  EDIT_SENT_ITEMS_MODULE,
  fetchPendingOrderEditRequests,
  OrderEditDecision,
  refKey,
  rejectOrderEditRequest,
} from "@/lib/order-edit-request.ts";

const REFRESH_DEBOUNCE_MS = 500;

/**
 * Changes to lines already sent, asked for by a user who may not make them: every signed-in
 * user holding `order_edit.sent_items` gets the request on their terminal and accepts or
 * refuses it; the user who asked is told the answer on theirs. Nothing shows on a locked screen.
 */
export const OrderEditRequestWatcher = () => {
  const {t} = useTranslation(['orders', 'payment', 'kitchen']);
  const db = useDB();
  const page = useAtomValue(appPage);
  const user = page?.user;
  const userId = user?.id?.toString();

  const [canApprove, setCanApprove] = useState(false);
  const [requests, setRequests] = useState<OrderEditRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  userRef.current = user;
  // `useDB()` and `t` are new on every render: the effects read them through refs so they run
  // once per user, not once per render (a state change in an effect keyed on `db` never settles).
  const dbRef = useRef(db);
  dbRef.current = db;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    setCanApprove(false);
    setRequests([]);
    setOpen(false);
    knownIdsRef.current = new Set();
    if (!userId) {
      return;
    }

    let cancelled = false;
    fetchUserModules(dbRef.current, userRef.current)
      .then((modules) => {
        if (!cancelled) {
          setCanApprove(userModulesGrant(modules, EDIT_SENT_ITEMS_MODULE));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    const pending = await fetchPendingOrderEditRequests(dbRef.current);
    const hasNew = pending.some((request) => !knownIdsRef.current.has(refKey(request)));
    knownIdsRef.current = new Set(pending.map(refKey));
    setRequests(pending);
    if (hasNew) {
      setOpen(true);
      playReadyChime();
    }
  }, []);

  useEffect(() => {
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
        refresh().catch(error => console.error('Order edit requests check failed', error));
      }, REFRESH_DEBOUNCE_MS);
    };

    const setup = async () => {
      if (canApprove) {
        await refresh().catch(error => console.error('Order edit requests check failed', error));
      }
      const live = await dbRef.current.live<OrderEditRequest>(Tables.order_edit_requests, (action, request) => {
        if (canApprove) {
          scheduleRefresh();
        }
        if (action !== 'UPDATE' || refKey(request?.requested_by) !== userId) {
          return;
        }
        if (request.status === OrderEditRequestStatus.approved) {
          toast.success(tRef.current('editRequest.answerApproved'));
        } else if (request.status === OrderEditRequestStatus.rejected) {
          toast.error(tRef.current('editRequest.answerRejected'));
        } else if (request.status === OrderEditRequestStatus.expired) {
          toast.warning(tRef.current('editRequest.answerExpired'));
        }
      });
      if (cancelled) {
        await live.kill().catch(() => undefined);
        return;
      }
      subscription = live;
    };

    setup().catch(error => console.error('Order edit requests watch failed', error));

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      subscription?.kill().catch(() => undefined);
    };
  }, [userId, canApprove, refresh]);

  const decide = async (request: OrderEditRequest, approve: boolean) => {
    setBusy(true);
    try {
      const approval = approve ? await approveOrderEditRequest(db, request, userId) : undefined;
      const decision: OrderEditDecision = approval
        ? approval.decision
        : await rejectOrderEditRequest(db, request, userId);

      // The kitchens already hold these lines: tell them what changed.
      if (approval?.decision === 'approved') {
        void printApprovedOrderEdit({
          db,
          orderId: refKey(request.order),
          changes: approval.applied,
          userId,
          title: t('payment:print.kitchenTitle'),
          guestLabelMode: (page?.menuConfig?.kitchenGuestLabel ?? 'name') as KitchenGuestLabelMode,
          placeLabels: {room: t('kitchen:labels.room'), table: t('kitchen:labels.table')},
        }).catch((error) => {
          console.error('Order edit kitchen print failed', error);
        });
      }

      if (decision === 'approved') {
        toast.success(t('editRequest.approved'));
      } else if (decision === 'rejected') {
        toast.success(t('editRequest.rejected'));
      } else if (decision === 'expired') {
        toast.warning(t('editRequest.expired'));
      } else {
        toast.info(t('editRequest.taken'));
      }

      if (decision === 'approved' || decision === 'rejected') {
        postOrderTracking({
          module: EDIT_SENT_ITEMS_MODULE,
          page: page?.page,
          orderId: refKey(request.order),
          payload: {
            request: refKey(request),
            decision,
            requested_by: refKey(request.requested_by),
            changes_count: request.changes?.length ?? 0,
          },
          user,
        });
      }
      await refresh();
    } catch (error) {
      console.error('Order edit request decision failed', error);
      toast.error(t('editRequest.failed'));
    } finally {
      setBusy(false);
    }
  };

  const describe = (change: SentLineChange): string[] => {
    if (change.action === 'void') {
      return [t('editRequest.changeVoid', {quantity: change.quantity, name: change.name})];
    }
    const lines: string[] = [];
    if (change.quantity !== change.from_quantity) {
      lines.push(t('editRequest.changeQuantity', {
        name: change.name,
        from: change.from_quantity,
        to: change.quantity,
      }));
    }
    if (change.comments_changed) {
      lines.push(change.comments
        ? t('editRequest.changeComment', {name: change.name, comment: change.comments})
        : t('editRequest.changeCommentRemoved', {name: change.name}));
    }
    if (change.modifiers_changed) {
      lines.push(t('editRequest.changeModifiers', {name: change.name}));
    }
    return lines;
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
          data-testid="order-edit-requests-open"
          onClick={() => setOpen(true)}
        >
          {t('editRequest.pendingCount', {count: requests.length})}
        </Button>
      </div>
    );
  }

  const order = current.order;
  const table = order?.table ? `${order.table.name ?? ''}${order.table.number ?? ''}`.trim() : '';
  const requester = `${current.requested_by?.first_name ?? ''} ${current.requested_by?.last_name ?? ''}`.trim();

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="order-edit-request-title"
      data-testid="order-edit-request"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col gap-4 rounded-3xl border-4 border-warning-500 bg-white p-6 shadow-2xl">
        <div className="text-center">
          <p id="order-edit-request-title" className="text-xl font-bold uppercase text-warning-700">
            {t('editRequest.title')}
          </p>
          {requests.length > 1 && (
            <p className="text-sm text-neutral-600">{t('editRequest.more', {count: requests.length - 1})}</p>
          )}
        </div>
        <div className="text-center">
          <p className="text-4xl font-black tabular-nums">{order ? formatOrderNumber(order) : ''}</p>
          {table && <p className="text-lg font-semibold">{t('readyAlert.table', {table})}</p>}
          <p className="text-neutral-700">{t('editRequest.requestedBy', {name: requester})}</p>
        </div>
        <ul className="flex flex-col gap-2 overflow-y-auto text-lg" data-testid="order-edit-request-changes">
          {(current.changes ?? []).flatMap(describe).map((line, index) => (
            <li key={index} className="rounded-md bg-neutral-100 px-3 py-2">{line}</li>
          ))}
        </ul>
        <div className="flex gap-3">
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            disabled={busy}
            data-testid="order-edit-request-reject"
            onClick={() => void decide(current, false)}
          >
            {t('editRequest.reject')}
          </Button>
          <Button
            variant="primary"
            flat
            size="lg"
            className="flex-1"
            disabled={busy}
            data-testid="order-edit-request-later"
            onClick={() => setOpen(false)}
          >
            {t('editRequest.later')}
          </Button>
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            disabled={busy}
            isLoading={busy}
            data-testid="order-edit-request-approve"
            onClick={() => void decide(current, true)}
          >
            {t('editRequest.approve')}
          </Button>
        </div>
      </div>
    </div>
  );
};
