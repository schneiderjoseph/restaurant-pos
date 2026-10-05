import {parseDateRangeWithPhrase} from "@/api/reports/shared/filters.ts";
import type {DbClient} from "@/api/reports/shared/types.ts";
import {getOrders} from "@/api/reports/operations/orders.ts";
import {getOrderDetail} from "@/api/reports/operations/order-detail.ts";
import type {AiChartSpec} from "@/lib/ai/charts.ts";
import {dedupeCharts} from "@/lib/ai/charts.ts";
import {buildAutoChartsFromToolResults} from "@/lib/ai/auto-charts.ts";
import type {AiReportFormat} from "@/lib/ai.report.storage.ts";
import {isLocalAiReportCompactMode} from "@/lib/ai/config.ts";
import {
  isOrderDetailPrompt,
  isOrderListByStatusPrompt,
  resolveOrderDetailQueryFromPrompt,
  resolveOrderListQueryFromPrompt,
} from "@/lib/ai/order-query.ts";
import {isUnsoldProductsPrompt, resolveUnsoldProductsDateRange} from "@/lib/ai/product-query.ts";
import {isCurrentSessionSalesPrompt} from "@/lib/ai/session-query.ts";
import {isTipsPrompt, resolveTipsDateRange, wantsTipDistribution} from "@/lib/ai/tip-query.ts";
import {getCurrentSessionServerSales} from "@/api/reports/operations/sessions.ts";
import {getTips} from "@/api/reports/sales/tips.ts";
import {getUnsoldProducts} from "@/api/reports/sales/products.ts";
import {getAiReportSystemPrompt} from "@/lib/ai/schema.ts";
import {executeAiReportTool} from "@/lib/ai/tools/executor.ts";
import {selectToolsForPrompt} from "@/lib/ai/tools/select-tools.ts";
import {collectOrderRefs, type AiOrderRef} from "@/lib/ai/order-refs.ts";
import {tryAnalyticsFastPath} from "@/lib/ai/analytics-fast-path.ts";
import {tryAccountsFastPath} from "@/lib/ai/accounts-fast-path.ts";
import {isFraudSuspiciousPrompt} from "@/lib/ai/fraud-query.ts";
import {forecastFromPoints} from "@/lib/ai/forecast.ts";
import {getTimeSeries} from "@/api/reports/time-series.ts";
import {
  callOpenAIChat,
  type AiTask,
  type OpenAIChatMessage,
} from "@/lib/openai.service.ts";

const MAX_ITERATIONS = 10;
const COMPACT_HISTORY_TURNS = 2;

const messageText = (content: OpenAIChatMessage["content"]): string => {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part): part is {type: "text"; text: string} => part.type === "text")
    .map(part => part.text)
    .join("\n")
    .trim();
};

/** Map report format / code path to an AI task for profile routing. */
const resolveAiTask = (format: AiReportFormat, kind: "default" | "forecast" = "default"): AiTask => {
  if (kind === "forecast") {
    return "forecast";
  }
  return format === "analysis" ? "analysis" : "reporting";
};

export interface AiReportAgentResult {
  answer: string;
  toolsUsed: {name: string; args: Record<string, unknown>}[];
  charts: AiChartSpec[];
  orderRefs: AiOrderRef[];
}

export interface AiReportAgentOptions {
  format?: AiReportFormat;
  allowedModules?: string[];
  conversationHistory?: {role: "user" | "assistant"; content: string}[];
  onToolStart?: (toolName: string) => void;
}

const buildAgentMessages = (
  format: AiReportFormat,
  compact: boolean,
  domains: ReturnType<typeof selectToolsForPrompt>["domains"],
  conversationHistory: AiReportAgentOptions["conversationHistory"],
): OpenAIChatMessage[] => {
  const history = compact
    ? (conversationHistory ?? []).slice(-COMPACT_HISTORY_TURNS)
    : (conversationHistory ?? []);

  return [
    {role: "system", content: getAiReportSystemPrompt(format, domains, compact)},
    ...history.flatMap(entry => [
      {role: entry.role, content: entry.content} as OpenAIChatMessage,
    ]),
  ];
};

export const runAiReportAgent = async (
  db: DbClient,
  prompt: string,
  options: AiReportAgentOptions = {},
): Promise<AiReportAgentResult> => {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error("Prompt cannot be empty.");
  }

  const format = options.format ?? "table";
  const task = resolveAiTask(format);
  const compact = isLocalAiReportCompactMode(task);
  const {tools, domains} = selectToolsForPrompt(
    trimmedPrompt,
    format,
    options.allowedModules ?? [],
    compact,
  );

  const messages = buildAgentMessages(format, compact, domains, options.conversationHistory);

  const toolsUsed: AiReportAgentResult["toolsUsed"] = [];
  const charts: AiChartSpec[] = [];
  const context = {charts};
  const toolResults: Array<{name: string; result: unknown}> = [];

  const finish = (answer: string): AiReportAgentResult => {
    if (format === "chart" && charts.length === 0) {
      charts.push(...buildAutoChartsFromToolResults(toolResults));
    }
    return {answer, toolsUsed, charts: dedupeCharts(charts), orderRefs: collectOrderRefs(toolResults)};
  };

  const analyticsFastPath = await tryAnalyticsFastPath(db, trimmedPrompt);
  if (analyticsFastPath) {
    options.onToolStart?.(analyticsFastPath.toolName);
    toolsUsed.push({name: analyticsFastPath.toolName, args: analyticsFastPath.args});
    toolResults.push({name: analyticsFastPath.toolName, result: analyticsFastPath.data});

    const response = await callOpenAIChat({
      messages: [
        ...messages,
        {
          role: "user",
          content: `${trimmedPrompt}\n\n${analyticsFastPath.toolName}:\n${JSON.stringify(analyticsFastPath.data)}\n\n${analyticsFastPath.hint}`,
        },
      ],
      tools: [],
      task,
    });

    const answer = messageText(response.choices[0]?.message?.content);
    if (!answer) {
      throw new Error("AI returned an empty response.");
    }
    return finish(answer);
  }

  const accountsFastPath = await tryAccountsFastPath(db, trimmedPrompt);
  if (accountsFastPath) {
    options.onToolStart?.(accountsFastPath.toolName);
    toolsUsed.push({name: accountsFastPath.toolName, args: accountsFastPath.args});
    toolResults.push({name: accountsFastPath.toolName, result: accountsFastPath.data});

    const response = await callOpenAIChat({
      messages: [
        ...messages,
        {
          role: "user",
          content: `${trimmedPrompt}\n\n${accountsFastPath.toolName}:\n${JSON.stringify(accountsFastPath.data)}\n\n${accountsFastPath.hint}`,
        },
      ],
      tools: [],
      task,
    });

    const answer = messageText(response.choices[0]?.message?.content);
    if (!answer) {
      throw new Error("AI returned an empty response.");
    }
    return finish(answer);
  }

  const fraudWorkflowHint = isFraudSuspiciousPrompt(trimmedPrompt)
    ? "\n\nWorkflow: Start with get_voids, get_staff_accountability_metrics, and get_cash_settlement_audit. "
      + "Call get_activity_log only if findings warrant tracking detail — use a narrow date range and limit."
    : "";

  messages.push({role: "user", content: trimmedPrompt + fraudWorkflowHint});

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await callOpenAIChat({messages, tools, task});
    const choice = response.choices[0]?.message;

    if (!choice) {
      throw new Error("AI returned an empty response.");
    }

    if (!choice.tool_calls?.length) {
      const answer = messageText(choice.content);
      if (!answer) {
        throw new Error("AI returned an empty response.");
      }

      return finish(answer);
    }

    messages.push(choice);

    for (const toolCall of choice.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
      toolsUsed.push({name: toolCall.function.name, args});
      options.onToolStart?.(toolCall.function.name);

      try {
        const result = await executeAiReportTool(db, toolCall.function.name, args, context);
        if (toolCall.function.name !== "render_chart") {
          toolResults.push({name: toolCall.function.name, result});
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: err instanceof Error ? err.message : "Tool execution failed",
          }),
        });
      }
    }
  }

  throw new Error("AI report exceeded maximum tool iterations. Try a simpler question.");
};
