import type {DbClient} from "@/api/reports/shared/types.ts";
import {getCashSettlementAudit} from "@/api/reports/operations/cash-audit.ts";
import {
  getKitchenStationDelays,
  getPrepTimesByOrderType,
} from "@/api/reports/operations/kitchen-timing.ts";
import {getVoidAndCancelSummary} from "@/api/reports/operations/void-cancel.ts";
import {getDiscountSummary} from "@/api/reports/sales/discounts.ts";
import {
  getServerTicketTimes,
  getStaffAccountabilityMetrics,
} from "@/api/reports/sales/server-analytics.ts";
import {
  isCashAuditPrompt,
  isKitchenDelayPrompt,
  isPrepTimePrompt,
  isServerTicketTimePrompt,
  isStaffAccountabilityPrompt,
  isVoidCancelSummaryPrompt,
  isPromotionalDiscountPrompt,
  resolvePromptDateRange,
} from "@/lib/ai/analytics-query.ts";

export interface AnalyticsFastPathResult {
  toolName: string;
  args: Record<string, unknown>;
  data: unknown;
  hint: string;
}

export const tryAnalyticsFastPath = async (
  db: DbClient,
  prompt: string,
): Promise<AnalyticsFastPathResult | null> => {
  const dateRange = resolvePromptDateRange(prompt);

  if (isServerTicketTimePrompt(prompt)) {
    const data = await getServerTicketTimes(db, {...dateRange, limit: 3});
    return {
      toolName: "get_server_ticket_times",
      args: {...dateRange, limit: 3},
      data,
      hint: "Ticket time = created_at to completed_at. Report fastest, slowest, and lowestTurnaroundHighestCheck if relevant.",
    };
  }

  if (isStaffAccountabilityPrompt(prompt)) {
    const data = await getStaffAccountabilityMetrics(db, dateRange);
    return {
      toolName: "get_staff_accountability_metrics",
      args: {...dateRange} as Record<string, unknown>,
      data,
      hint: "Highlight flaggedStaff and compare rates to teamAverages.",
    };
  }

  if (isVoidCancelSummaryPrompt(prompt)) {
    const data = await getVoidAndCancelSummary(db, dateRange);
    return {
      toolName: "get_void_and_cancel_summary",
      args: {...dateRange} as Record<string, unknown>,
      data,
      hint: "Summarize combinedReasons by type (void, cancellation, comp).",
    };
  }

  if (isPromotionalDiscountPrompt(prompt)) {
    const data = await getDiscountSummary(db, {
      ...dateRange,
      billPercentThreshold: 20,
    });
    return {
      toolName: "get_discount_summary",
      args: {...dateRange, billPercentThreshold: 20},
      data,
      hint: "Highlight exceededBillPercentThreshold entries.",
    };
  }

  if (isPrepTimePrompt(prompt)) {
    const data = await getPrepTimesByOrderType(db, dateRange);
    return {
      toolName: "get_prep_times_by_order_type",
      args: {...dateRange} as Record<string, unknown>,
      data,
      hint: "Compare delivery vs dine-in using metricNote (ticket time).",
    };
  }

  if (isKitchenDelayPrompt(prompt)) {
    const hourPhrase = /\b(7\s*pm|peak)\b/i.test(prompt) ? "peak hours" : "7 PM - 9 PM";
    const data = await getKitchenStationDelays(db, {...dateRange, hourPhrase});
    return {
      toolName: "get_kitchen_station_delays",
      args: {...dateRange, hourPhrase},
      data,
      hint: "Report slowest byKitchen and byCategory during peak hours.",
    };
  }

  if (isCashAuditPrompt(prompt)) {
    const data = await getCashSettlementAudit(db, dateRange);
    return {
      toolName: "get_cash_settlement_audit",
      args: {...dateRange} as Record<string, unknown>,
      data,
      hint: "List cash orders with modifications before close.",
    };
  }

  return null;
};
