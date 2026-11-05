import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {DayClosing} from "@/api/model/day_closing.ts";
import {cn, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {ReportInsights, type ReportInsight} from "@/components/reports/report-insights.tsx";
import {toLuxonDateTime} from "@/lib/datetime.ts";

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("date") || params.get("start") || params.get("start") || "";
};

const toRecordString = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return value.toString();
  }
  return String(value);
};

export const CashClosingReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [closing, setClosing] = useState<DayClosing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedDate = useMemo(parseFilters, []);

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [rows] = await queryRef.current(
          `
            SELECT * FROM ${Tables.closings}
            WHERE time::format(date_from, "${import.meta.env.VITE_DB_DATABASE_DATE_FORMAT}") = $selectedDate
            ORDER BY created_at DESC
            LIMIT 1
            FETCH closed_by, opened_by
          `,
          {selectedDate}
        );

        setClosing((rows?.[0] || null) as DayClosing | null);
      } catch (err) {
        console.error("Failed to load cash closing report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [selectedDate, t]);

  const safeNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const subtitle = selectedDate || t('labels.selectedDay');
  // The closing screen saves the carried-over balance as previous_day_balance; opening_balance is the legacy name.
  const openingBalance = safeNumber(closing?.opening_balance ?? (closing as (DayClosing & {previous_day_balance?: number}) | null)?.previous_day_balance);
  const totalCash = (closing?.terminal_cash || []).reduce((sum, item: any) => sum + safeNumber(item?.cash_amount), 0);
  const totalOtherPayments = (closing?.payments_data || [])
    .filter((item: any) => {
      const type = String(item?.payment_type?.type || "").toLowerCase();
      return type !== "cash" && type !== "room" && type !== "credit";
    })
    .reduce((sum, item: any) => sum + safeNumber(item?.amount), 0);
  const totalDeferredCharges = (closing?.payments_data || [])
    .filter((item: any) => {
      const type = String(item?.payment_type?.type || "").toLowerCase();
      return type === "room" || type === "credit";
    })
    .reduce((sum, item: any) => sum + safeNumber(item?.amount), 0);
  const totalExpenses = safeNumber(closing?.expenses);
  const closingBalance = safeNumber(closing?.closing_balance);

  const cashAdded = safeNumber(closing?.cash_added);
  // Same formula as the closing screen (closing.tsx netAmount): room/credit charges are not cash in hand.
  const computedBalance = openingBalance + totalCash + cashAdded + totalOtherPayments - totalExpenses;
  const balanceGap = closing ? Math.abs(computedBalance - closingBalance) > 0.5 : false;
  const calcRows = [
    {label: t('labels.openingBalance'), amount: openingBalance, sign: '+'},
    {label: t('labels.totalCash'), amount: totalCash, sign: '+'},
    {label: t('labels.cashAdded'), amount: cashAdded, sign: '+'},
    {label: t('labels.otherPayments'), amount: totalOtherPayments, sign: '+'},
    {label: t('columns.expenses'), amount: totalExpenses, sign: '−'},
  ];
  const collected = totalCash + totalOtherPayments;
  const cashKpis: ReportKpi[] = [
    {label: t('labels.closingBalance'), value: withDualCurrency(closingBalance), rawValue: closingBalance, tone: balanceGap ? 'bad' : 'default'},
    {label: t('cashReport.collected'), value: withDualCurrency(collected), rawValue: collected, hint: t('cashReport.cashShare', {pct: collected > 0 ? Math.round((totalCash / collected) * 100) : 0})},
    {label: t('labels.deferredCharges', { defaultValue: 'Room + credit (not collected)' }), value: withDualCurrency(totalDeferredCharges), rawValue: totalDeferredCharges},
    {label: t('columns.expenses'), value: withDualCurrency(totalExpenses), rawValue: totalExpenses, hint: t('cashReport.expenseLines', {count: (closing?.expenses_data || []).length})},
  ];
  const cashInsights: ReportInsight[] = [];
  if (closing) {
    if (balanceGap) {
      cashInsights.push({id: 'gap', severity: 'bad', text: t('insights.cash.balanceGap', {computed: withCurrency(computedBalance), recorded: withCurrency(closingBalance), gap: withCurrency(closingBalance - computedBalance)})});
    }
    if (String(closing.status || '').toLowerCase() !== 'completed' && !closing.closed_at) {
      cashInsights.push({id: 'open', severity: 'warn', text: t('insights.cash.notClosed')});
    }
    const total = collected + totalDeferredCharges;
    if (totalDeferredCharges > 0 && total > 0) {
      const pct = Math.round((totalDeferredCharges / total) * 100);
      cashInsights.push({id: 'deferred', severity: pct >= 20 ? 'warn' : 'info', text: t('insights.cash.deferred', {amount: withCurrency(totalDeferredCharges), pct})});
    }
    if (totalExpenses > 0 && totalCash > 0) {
      cashInsights.push({id: 'expenses', severity: 'info', text: t('insights.cash.expenses', {amount: withCurrency(totalExpenses), pct: Math.round((totalExpenses / totalCash) * 100)})});
    }
  }

  if (loading) {
    return (
      <ReportsLayout title={t('titles.cashClosing')} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('loading.cashClosing')}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={t('titles.cashClosing')} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div>
      </ReportsLayout>
    );
  }

  if (!closing) {
    return (
      <ReportsLayout title={t('titles.cashClosing')} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('empty.noCashClosing')}</div>
      </ReportsLayout>
    );
  }

  return (
    <ReportsLayout title={t('titles.cashClosing')} subtitle={subtitle}>
      <div className="space-y-6">
        <ReportKpis items={cashKpis}/>
        <ReportInsights items={cashInsights}/>

        <div className="overflow-hidden rounded-lg border border-neutral-200 max-w-2xl">
          <h3 className="bg-neutral-100 px-6 py-3 text-sm font-semibold text-neutral-700">{t('cashReport.calculation')}</h3>
          <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('cashReport.calculation')}>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {calcRows.map((row) => (
                <tr key={row.label}>
                  <td className="py-2.5 pl-6 pr-3 text-sm text-neutral-800">{row.sign} {row.label}</td>
                  <td className={cn('py-2.5 pr-6 text-right text-sm', row.sign === '−' && 'text-red-700')}>{withCurrency(row.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
              <tr>
                <td className="py-2.5 pl-6 pr-3 text-sm">= {t('cashReport.computedBalance')}</td>
                <td className="py-2.5 pr-6 text-right text-sm">{withCurrency(computedBalance)}</td>
              </tr>
              <tr>
                <td className="py-2.5 pl-6 pr-3 text-sm">{t('labels.closingBalance')}</td>
                <td className={cn('py-2.5 pr-6 text-right text-sm', balanceGap ? 'text-red-700' : 'text-emerald-700')}>{withCurrency(closingBalance)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="px-6 py-2 text-xs text-neutral-500" data-xlsx-ignore>{t('cashReport.deferredNote', {amount: withCurrency(totalDeferredCharges)})}</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200">
            <tbody className="divide-y divide-neutral-100 bg-white">
              <tr>
                <td className="py-3 pl-6 pr-3 text-sm font-semibold text-neutral-700">{t('filters.status')}</td>
                <td className="py-3 pr-6 text-sm text-neutral-900 capitalize">{closing.status || "-"}</td>
              </tr>
              <tr>
                <td className="py-3 pl-6 pr-3 text-sm font-semibold text-neutral-700">{t('labels.window')}</td>
                <td className="py-3 pr-6 text-sm text-neutral-900">
                  {toLuxonDateTime(closing.date_from).toFormat("yyyy-LL-dd HH:mm")} - {toLuxonDateTime(closing.date_to).toFormat("yyyy-LL-dd HH:mm")}
                </td>
              </tr>
              <tr>
                <td className="py-3 pl-6 pr-3 text-sm font-semibold text-neutral-700">{t('columns.createdAt')}</td>
                <td className="py-3 pr-6 text-sm text-neutral-900">
                  {toLuxonDateTime(closing.created_at).toFormat("yyyy-LL-dd HH:mm")}
                </td>
              </tr>
              <tr>
                <td className="py-3 pl-6 pr-3 text-sm font-semibold text-neutral-700">{t('columns.closedAt')}</td>
                <td className="py-3 pr-6 text-sm text-neutral-900">
                  {closing.closed_at ? toLuxonDateTime(closing.closed_at).toFormat("yyyy-LL-dd HH:mm") : "-"}
                </td>
              </tr>
              <tr>
                <td className="py-3 pl-6 pr-3 text-sm font-semibold text-neutral-700">{t('labels.notes')}</td>
                <td className="py-3 pr-6 text-sm text-neutral-900">{closing.notes || "-"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <h3 className="bg-neutral-100 px-6 py-3 text-sm font-semibold text-neutral-700">{t('labels.terminalCash')}</h3>
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th className="py-3 pl-6 pr-3 text-left text-xs font-semibold text-neutral-700">{t('labels.terminalDefault')}</th>
                <th className="py-3 px-3 text-right text-xs font-semibold text-neutral-700">{t('columns.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {(closing.terminal_cash || []).length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-sm text-neutral-500">{t('empty.noTerminalCash')}</td>
                </tr>
              ) : (
                (closing.terminal_cash || []).map((terminal: any, index) => (
                  <tr key={toRecordString(terminal?.terminal_id) || String(index)}>
                    <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">{terminal?.terminal_name || t('labels.terminalDefault')}</td>
                    <td className="py-3 px-3 text-right text-sm text-neutral-900">{withDualCurrency(Number(terminal?.cash_amount || 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <h3 className="bg-neutral-100 px-6 py-3 text-sm font-semibold text-neutral-700">{t('labels.paymentSummary')}</h3>
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th className="py-3 pl-6 pr-3 text-left text-xs font-semibold text-neutral-700">{t('filters.paymentType')}</th>
                <th className="py-3 px-3 text-right text-xs font-semibold text-neutral-700">{t('columns.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {(closing.payments_data || []).length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-6 text-center text-sm text-neutral-500">{t('empty.noPaymentSummary')}</td>
                </tr>
              ) : (
                (closing.payments_data || []).map((payment: any, index) => (
                  <tr key={`${toRecordString(payment?.payment_type?.id || payment?.payment_type)}_${index}`}>
                    <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">
                      {payment?.payment_type?.name || toRecordString(payment?.payment_type) || t('common:actions.unknown')}
                    </td>
                    <td className="py-3 px-3 text-right text-sm text-neutral-900">{withDualCurrency(Number(payment?.amount || 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <h3 className="bg-neutral-100 px-6 py-3 text-sm font-semibold text-neutral-700">{t('columns.expenses')}</h3>
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th className="py-3 pl-6 pr-3 text-left text-xs font-semibold text-neutral-700">{t('columns.description')}</th>
                <th className="py-3 px-3 text-left text-xs font-semibold text-neutral-700">{t('columns.category')}</th>
                <th className="py-3 px-3 text-right text-xs font-semibold text-neutral-700">{t('columns.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {(closing.expenses_data || []).length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-sm text-neutral-500">{t('empty.noExpenseRecords')}</td>
                </tr>
              ) : (
                (closing.expenses_data || []).map((expense: any, index) => (
                  <tr key={toRecordString(expense?.id) || String(index)}>
                    <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">{expense?.description || "-"}</td>
                    <td className="py-3 px-3 text-sm text-neutral-700">{expense?.category || "-"}</td>
                    <td className="py-3 px-3 text-right text-sm text-neutral-900">{withDualCurrency(Number(expense?.amount || 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
            {(closing.expenses_data || []).length > 0 && (
              <tfoot className="bg-neutral-50">
                <tr>
                  <td colSpan={2} className="py-3 pl-6 pr-3 text-sm font-semibold text-neutral-900">{t('labels.totalExpenses')}</td>
                  <td className="py-3 px-3 text-right text-sm font-bold text-neutral-900">{withDualCurrency(totalExpenses)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </ReportsLayout>
  );
};