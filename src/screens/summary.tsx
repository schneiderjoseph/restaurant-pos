import {Layout} from "@/screens/partials/layout.tsx";
import {Order as OrderModel, ORDER_FETCHES, OrderStatus} from "@/api/model/order.ts";
import {Tables} from "@/api/db/tables.ts";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {DateValue} from "react-aria-components";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faArrowLeft, faArrowRight, faPrint, faSpinner} from "@fortawesome/free-solid-svg-icons";
import {Calendar} from "@/components/common/antd/calendar.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {DailySalesSummaryReport} from '@/components/summary/daily.sales.summary.report.tsx';
import {useDB} from "@/api/db/db.ts";
import {useQueryBuilder} from "@/api/db/query-builder.ts";
import type {Closing as ClosingModel} from "@/api/model/closing.ts";
import {getOrderFilteredItems} from "@/lib/order.ts";
import {orderSellers} from "@/lib/duo.ts";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {getOrderTaxAmount} from "@/lib/tax-calculator.ts";
import {TimeEntry} from "@/api/model/time_entry.ts";
import {formatNumber, withCurrency} from "@/lib/utils.ts";
import {printDocument} from "@/lib/export.document.ts";
import {printLetterTableReport} from "@/lib/summary-letter-print.ts";
import {
  buildClosingThermalRows,
  closingToPrintData,
  ordersToCashSettlementPrintData,
} from "@/lib/closing-print.ts";
import {dispatchPrint} from "@/lib/print.service.ts";
import {PRINT_TYPE} from "@/lib/print.registry.tsx";
import {appPage} from "@/store/jotai.ts";
import {useAtom} from "jotai";
import {toast} from "sonner";
import ScrollContainer from "react-indiana-drag-scroll";
import {useSecurity} from "@/hooks/useSecurity.ts";
import { useActionVisible } from "@/hooks/useActionVisible.ts";
import {calendarDateToAppDateTime, toJsDate, toSurrealDateTime} from "@/lib/datetime.ts";
import {getToday} from "@/utils/date.ts";
import {useTranslation} from "react-i18next";
import {DocumentTitle} from "@/components/common/document-title.tsx";

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIdString = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as { id?: unknown; toString?: () => string };
    if (obj.id != null) return String(obj.id);
    if (typeof obj.toString === 'function') return obj.toString();
  }
  return String(value);
};

const getUserDisplayName = (user: unknown, unknownLabel: string): string => {
  if (!user || typeof user !== 'object') return unknownLabel;
  const u = user as { first_name?: string; last_name?: string; name?: string; login?: string };
  const first = (u.first_name || '').trim();
  const last = (u.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ') || u.name || u.login || unknownLabel;
};

/** Orders of the day, with who added each line (every seller named in Server sales). */
const SUMMARY_ORDER_FETCHES = [...ORDER_FETCHES, 'items.created_by', 'duo', 'duo.inviter', 'duo.partner'];

const getOrderSale = (order: OrderModel): number => {
  const itemsTotal = (getOrderFilteredItems(order) || []).reduce((sum, item) => {
    return sum + safeNumber(calculateOrderItemPrice(item));
  }, 0);
  const extrasTotal = (order.extras || []).reduce((sum, extra) => sum + safeNumber(extra?.value), 0);
  const taxAmount = getOrderTaxAmount(order);
  const serviceAmount = safeNumber(order.service_charge_amount);
  const discountAmount = safeNumber(order.discount_amount) + safeNumber(order.coupon?.discount);
  return safeNumber(itemsTotal + extrasTotal + taxAmount + serviceAmount - discountAmount);
};

/** [start, end) of the selected calendar day in the app timezone (SurrealDB formats datetimes in UTC). */
const getDayBounds = (date: DateValue) => {
  const dayStart = calendarDateToAppDateTime({year: date.year, month: date.month, day: date.day});
  return {dayStart, dayEnd: dayStart.plus({days: 1})};
};

const formatDuration = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const Summary = () => {
  const {t} = useTranslation(["summary", "toast", "common", "closing"]);
  const {t: tNav} = useTranslation('navigation');
  const db = useDB();
  const [page] = useAtom(appPage);
  const {protectAction} = useSecurity();
  const isVisible = useActionVisible();
  const canPrintSummary = isVisible("summary.print");
  const canPrintProductMix = isVisible("summary.product_mix");
  const canPrintServerSales = isVisible("summary.server_sales");
  // Règlement de caisse (thermal): same people who can print summary or open Closing.
  const canPrintCashClosing = canPrintSummary || isVisible("closing");
  const showPrintActions = canPrintSummary || canPrintProductMix || canPrintServerSales || canPrintCashClosing;

  const [date, setDate] = useState<DateValue>(getToday());
  const [orders, setOrders] = useState<OrderModel[]>([]);
  // Query params the loaded `orders` were fetched with (identity-compared with the current day's).
  const [loadedParams, setLoadedParams] = useState<object | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPrintingMix, setIsPrintingMix] = useState(false);
  const [isPrintingServerSales, setIsPrintingServerSales] = useState(false);
  const [isPrintingCashClosing, setIsPrintingCashClosing] = useState(false);
  const fetchSeq = useRef(0);

  const {orderFilters, orderFilterParams} = useMemo(() => {
    const {dayStart, dayEnd} = getDayBounds(date);
    return {
      orderFilters: [`status = '${OrderStatus.Paid}'`, `created_at >= $dayStart`, `created_at < $dayEnd`],
      orderFilterParams: {
        dayStart: toSurrealDateTime(dayStart),
        dayEnd: toSurrealDateTime(dayEnd),
      },
    };
  }, [date]);

  const ordersQb = useQueryBuilder(
    Tables.orders, '*', orderFilters.map(item => `and ${item}`), 99999, 0, ['created_at desc'],
    SUMMARY_ORDER_FETCHES
  );

  useEffect(() => {
    ordersQb.setWheres(orderFilters.map(item => `and ${item}`));
    ordersQb.setParameters(orderFilterParams);
  }, [orderFilters, orderFilterParams]);

  const fetchOrders = useCallback(async () => {
    // The query builder picks up new params one render after a date change; only query
    // once it holds the params for the selected day.
    const params = ordersQb.parameters as typeof orderFilterParams | Record<string, never>;
    if (!params?.dayStart) return;
    const seq = ++fetchSeq.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const [listQuery] = await db.query(ordersQb.queryString, params);
      if (seq !== fetchSeq.current) return;
      setOrders(Array.isArray(listQuery) ? listQuery as OrderModel[] : []);
      setLoadedParams(params);
    } catch (error) {
      if (seq !== fetchSeq.current) return;
      console.error('Summary: failed to load orders', error);
      setOrders([]);
      setLoadedParams(null);
      setLoadFailed(true);
      toast.error(t("toast:summary.loadFailed"));
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
    // `db` is left out on purpose: useDB() returns a new object every render.
  }, [ordersQb.queryString, ordersQb.parameters]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // Prints and the on-screen report only use orders loaded for the selected day.
  const ordersReady = !isLoading && loadedParams === orderFilterParams;
  const todayDate = getToday();

  // Daily summary → Letter (browser printer dialog).
  const handlePrintSummary = useCallback(() => {
    if (!ordersReady) return;
    printDocument();
  }, [ordersReady]);

  const closingThermalLabels = useMemo(() => ({
    terminalCash: t('summary:print.closing.terminalCash'),
    amount: t('summary:print.closing.amount'),
    totalCash: t('summary:print.closing.totalCash'),
    paymentSummary: t('summary:print.closing.paymentSummary'),
    otherPayments: t('summary:print.closing.otherPayments'),
    expenses: t('summary:print.closing.expenses'),
    netAmount: t('summary:print.closing.netAmount'),
  }), [t]);

  // Règlement de caisse → imprimante thermique (summary_print_printers).
  const handlePrintCashClosing = useCallback(async () => {
    if (!ordersReady) return;
    setIsPrintingCashClosing(true);
    try {
      const selectedDate = date.toString();
      const [rows] = await db.query(
        `
          SELECT * FROM ${Tables.closings}
          WHERE time::format(date_from, "${import.meta.env.VITE_DB_DATABASE_DATE_FORMAT}") = $selectedDate
          ORDER BY created_at DESC
          LIMIT 1
        `,
        {selectedDate},
      );
      const closing = (Array.isArray(rows) && rows[0] ? rows[0] : null) as ClosingModel | null;
      const title = t('summary:print.closing.title', {date: selectedDate});
      const data = closing
        ? closingToPrintData(closing, title)
        : ordersToCashSettlementPrintData(orders, title);

      if (!closing && (orders || []).length === 0) {
        toast.error(t('toast:summary.noCashClosing'));
        return;
      }

      const ok = await dispatchPrint(db, PRINT_TYPE.summary, {
        printType: 'table',
        rows: buildClosingThermalRows(data, closingThermalLabels, formatNumber),
        cut: true,
      }, {userId: page?.user?.id});
      if (!ok) return;
      if (!closing) {
        toast.message(t('toast:summary.cashClosingLive'));
      }
    } catch (error) {
      console.error('Summary: cash closing print failed', error);
      toast.error(t('common:toast.printError'));
    } finally {
      setIsPrintingCashClosing(false);
    }
  }, [closingThermalLabels, date, db, orders, ordersReady, page?.user?.id, t]);

  const handlePrintProductMix = useCallback(async () => {
    if (!ordersReady) return;
    setIsPrintingMix(true);
    try {
      const dishMap = new Map<string, { name: string; qty: number; total: number }>();

      (orders || []).forEach((order) => {
        (getOrderFilteredItems(order) || []).forEach((item) => {
          const key = String(item?.item?.name || t("summary:report.unknownItem"));
          const qty = safeNumber(item?.quantity);
          const total = safeNumber(calculateOrderItemPrice(item));
          const prev = dishMap.get(key) || {name: key, qty: 0, total: 0};
          prev.qty += qty;
          prev.total += total;

          dishMap.set(key, prev);
        });
      });

      const rows = Array.from(dishMap.values())
        .sort((a, b) => b.total - a.total);

      const totalSale = rows.reduce((sum, row) => sum + row.total, 0);
      if (rows.length === 0) {
        toast.error(t("toast:summary.noProductMix"));
        return;
      }

      const title = t('summary:print.productMixTitle', {date: date.toString()});
      const ok = printLetterTableReport(
        title,
        [
          {key: 'item', label: t('summary:print.item')},
          {key: 'qty', label: t('summary:print.qty'), align: 'right'},
          {key: 'total', label: t('summary:print.total'), align: 'right'},
          {key: 'pct', label: '%', align: 'right'},
        ],
        rows.map((row) => {
          const percent = totalSale > 0 ? (row.total / totalSale) * 100 : 0;
          return {
            item: row.name,
            qty: formatNumber(row.qty),
            total: formatNumber(row.total),
            pct: `${percent.toFixed(2)}%`,
          };
        }),
        {
          item: t('summary:print.grandTotal'),
          qty: '',
          total: withCurrency(undefined) + formatNumber(totalSale),
          pct: '',
        },
      );
      if (!ok) toast.error(t("common:toast.printError"));
    } finally {
      setIsPrintingMix(false);
    }
  }, [date, orders, ordersReady, t]);

  const handlePrintServerSales = useCallback(async () => {
    if (!ordersReady) return;
    setIsPrintingServerSales(true);
    try {

      const reportDate = date.toString();
      const {dayStart, dayEnd} = getDayBounds(date);
      // Shifts started that day (app timezone), including ones still open.
      const [entryRes] = await db.query(
        `SELECT *
         FROM ${Tables.time_entries}
         WHERE clock_in >= $dayStart
           AND clock_in < $dayEnd
             FETCH user`,
        {dayStart: toSurrealDateTime(dayStart), dayEnd: toSurrealDateTime(dayEnd)}
      );

      const entries = (Array.isArray(entryRes) ? entryRes : []) as TimeEntry[];
      const nowMs = Date.now();

      const perUser = new Map<string, {
        name: string;
        durationMs: number;
        guests: number;
        checks: number;
        sales: number
      }>();
      const ensureRow = (user: unknown) => {
        const userId = toIdString(user);
        if (!userId) return null;
        let row = perUser.get(userId);
        if (!row) {
          row = {
            name: getUserDisplayName(user, t("summary:unknown.user")),
            durationMs: 0,
            guests: 0,
            checks: 0,
            sales: 0,
          };
          perUser.set(userId, row);
        }
        return row;
      };

      entries.forEach((entry) => {
        const current = ensureRow(entry.user);
        if (!current) return;
        const inAt = entry.clock_in ? toJsDate(entry.clock_in).getTime() : 0;
        // Open shift: count up to now.
        const outAt = entry.clock_out ? toJsDate(entry.clock_out).getTime() : nowMs;
        if (inAt > 0 && outAt > inAt) current.durationMs += (outAt - inAt);
      });

      // Every paid order counts, even when its server never clocked in, so the total matches the day.
      // An order counts for each server by the lines they added (a duo, a colleague adding to it).
      (orders || []).forEach((order) => {
        const sale = getOrderSale(order);
        orderSellers(order).forEach(({user, share}) => {
          const row = ensureRow(user);
          if (!row) return;
          row.checks += share;
          row.guests += safeNumber(order.covers) * share;
          row.sales += sale * share;
        });
      });

      const rows = Array.from(perUser.values()).sort((a, b) => b.sales - a.sales);
      if (rows.length === 0) {
        toast.error(t("toast:summary.noServerSales"));
        return;
      }

      const totals = rows.reduce((acc, row) => ({
        durationMs: acc.durationMs + row.durationMs,
        guests: acc.guests + row.guests,
        checks: acc.checks + row.checks,
        sales: acc.sales + row.sales,
      }), {durationMs: 0, guests: 0, checks: 0, sales: 0});

      const title = t('summary:print.serverSalesTitle', {date: reportDate});
      const ok = printLetterTableReport(
        title,
        [
          {key: 'name', label: t('summary:print.name')},
          {key: 'time', label: t('summary:print.time'), align: 'right'},
          {key: 'guests', label: t('summary:print.guests'), align: 'right'},
          {key: 'checks', label: t('summary:print.checks'), align: 'right'},
          {key: 'sale', label: t('summary:print.sale'), align: 'right'},
        ],
        rows.map((row) => ({
          name: row.name,
          time: formatDuration(row.durationMs),
          guests: String(Math.round(row.guests)),
          checks: String(Math.round(row.checks)),
          sale: formatNumber(row.sales),
        })),
        {
          name: t('summary:print.grandTotal'),
          time: formatDuration(totals.durationMs),
          guests: String(Math.round(totals.guests)),
          checks: String(Math.round(totals.checks)),
          sale: withCurrency(undefined) + formatNumber(totals.sales),
        },
      );
      if (!ok) toast.error(t("common:toast.printError"));
    } catch (error) {
      console.error('Summary: server sales print failed', error);
      toast.error(t("common:toast.printError"));
    } finally {
      setIsPrintingServerSales(false);
    }
  }, [db, date, orders, ordersReady, t]);

  return (
    <Layout overflowHidden>
      <DocumentTitle parts={[tNav('sidebar.summary')]} />
      {/* Letter 8.5×11 for on-screen summary; product mix / server sales open a Letter window. */}
      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          body { background: white !important; }
        }
      `}</style>
      <div className="flex gap-5 p-3 flex-col print:p-0 print:gap-0" data-testid="summary-page">
        <div className="bg-white rounded-xl flex gap-10 justify-center px-5 print:rounded-none print:shadow-none print:px-0 print:block">
          <div className="flex justify-center items-center flex-col flex-1 print:hidden">
            <div className="w-[450px]" data-testid="summary-calendar">
              <Calendar
                onChange={setDate}
                value={date}
                maxValue={todayDate}
              />
            </div>
            <div className="flex gap-3 mt-3">
              <Button
                icon={faArrowLeft} size="lg" variant="primary" filled
                onClick={() => {
                  setDate(prevState => {
                    return prevState.subtract({
                      days: 1
                    })
                  })
                }}
              >
                {t("summary:screen.previousDate")}</Button>
              <Button
                rightIcon={faArrowRight} size="lg" variant="primary" filled
                disabled={date.compare(todayDate) >= 0}
                onClick={() => {
                  setDate(prevState => {
                    return prevState.add({
                      days: 1
                    })
                  })
                }}
              >
                {t("summary:screen.nextDate")}</Button>
            </div>
            {showPrintActions && (
              <div className="flex gap-3 mt-3 flex-wrap" data-testid="summary-print-actions">
                {canPrintSummary && (
                  <Button
                    icon={faPrint}
                    variant="lg"
                    disabled={!ordersReady}
                    onClick={() => {
                      protectAction(handlePrintSummary, {
                        description: t("summary:security.printSummaryDescription"),
                        module: 'summary.print',
                      });
                    }}
                  >{t("summary:screen.printSummary")}</Button>
                )}
                {canPrintProductMix && (
                  <Button
                    icon={faPrint}
                    variant="lg"
                    isLoading={isPrintingMix}
                    disabled={!ordersReady}
                    onClick={() => {
                      protectAction(handlePrintProductMix, {
                        description: t("summary:security.productMixDescription"),
                        module: 'summary.product_mix',
                      });
                    }}
                  >
                    {t("summary:screen.productMixReport")}
                  </Button>
                )}
                {canPrintServerSales && (
                  <Button
                    icon={faPrint}
                    variant="lg"
                    isLoading={isPrintingServerSales}
                    disabled={!ordersReady}
                    onClick={() => {
                      protectAction(handlePrintServerSales, {
                        description: t("summary:security.serverSalesDescription"),
                        module: 'summary.server_sales',
                      });
                    }}
                  >
                    {t("summary:screen.serverSales")}
                  </Button>
                )}
                {canPrintCashClosing && (
                  <Button
                    icon={faPrint}
                    variant="lg"
                    isLoading={isPrintingCashClosing}
                    disabled={!ordersReady}
                    onClick={() => {
                      protectAction(handlePrintCashClosing, {
                        description: t("summary:security.printCashClosingDescription"),
                        module: 'summary.print',
                      });
                    }}
                    data-testid="summary-print-cash-closing"
                  >
                    {t("summary:screen.printCashClosing")}
                  </Button>
                )}
              </div>
            )}
          </div>
          <ScrollContainer className="max-h-[calc(100vh_-_30px)] overflow-y-auto flex-1 flex-basis-[500px] py-10 select-none print:max-h-none print:overflow-visible print:py-0 print:flex-none" data-testid="summary-report">
            {loadFailed ? (
              <div className="flex w-full justify-center items-center flex-1 text-neutral-500 print:hidden">
                {t("toast:summary.loadFailed")}
              </div>
            ) : !ordersReady ? (
              <div className="flex h-screen w-full justify-center items-center flex-1 print:hidden">
                <FontAwesomeIcon icon={faSpinner} spin size="5x"/>
              </div>
            ) : (
              <>
                <DailySalesSummaryReport orders={orders} date={date.toString()} />
              </>
            )}
          </ScrollContainer>
        </div>
      </div>
    </Layout>
  );
}
