import {useCallback, useEffect, useMemo, useState} from "react";
import {useTranslation} from "react-i18next";
import {REPORTS_AI} from "@/routes/posr.ts";
import {Button} from "@/components/common/input/button.tsx";
import {Textarea} from "@/components/common/input/textarea.tsx";
import {AiExamplePrompts} from "@/components/reports/ai/ai.example.prompts.tsx";
import {AiFormatSelector} from "@/components/reports/ai/ai.format.selector.tsx";
import {AiReportHistory} from "@/components/reports/ai/ai.report.history.tsx";
import {
  type AiReportFormat,
  type AiReportHistoryEntry,
  loadAiReportFormat,
  saveAiReportFormat,
  saveAiReportPrompt,
} from "@/lib/ai.report.storage.ts";
import {AI_EXAMPLE_PROMPTS} from "@/lib/ai/example.prompts.ts";
import {fetchAiUsage, type AiUsageStatus} from "@/lib/openai.service.ts";

export const AiReportFilter = () => {
  const {t} = useTranslation("reports");
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<AiReportFormat>(() => loadAiReportFormat());
  const [usage, setUsage] = useState<AiUsageStatus | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState(false);

  const refreshUsage = useCallback(async (cancelled?: () => boolean) => {
    setUsageLoading(true);
    setUsageError(false);
    try {
      const next = await fetchAiUsage();
      if (cancelled?.()) return;
      if (next == null) {
        setUsage(null);
        setUsageError(true);
      } else {
        setUsage(next);
      }
    } catch {
      if (!cancelled?.()) {
        setUsage(null);
        setUsageError(true);
      }
    } finally {
      if (!cancelled?.()) {
        setUsageLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshUsage(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refreshUsage]);

  const usageLabel = useMemo(() => {
    if (!usage || !usage.enabled) {
      return null;
    }
    const parts: string[] = [];
    if (usage.daily.limit !== null) {
      parts.push(t("filters.aiUsageDaily", {used: usage.daily.used, limit: usage.daily.limit}));
    }
    if (usage.monthly.limit !== null) {
      parts.push(t("filters.aiUsageMonthly", {used: usage.monthly.used, limit: usage.monthly.limit}));
    }
    return parts.length ? parts.join(" · ") : null;
  }, [t, usage]);

  const handleFormatChange = (nextFormat: AiReportFormat) => {
    setFormat(nextFormat);
    saveAiReportFormat(nextFormat);
  };

  const handleHistorySelect = (entry: AiReportHistoryEntry) => {
    setPrompt(entry.prompt);
    setFormat(entry.format);
    saveAiReportFormat(entry.format);
  };

  const handleExampleSelect = (selected: string) => {
    setPrompt(selected);
    const isChartPrompt = AI_EXAMPLE_PROMPTS.some(
      p => p.prompt === selected && p.category === "charts",
    );
    if (isChartPrompt) {
      setFormat("chart");
      saveAiReportFormat("chart");
    }
  };

  const canRun = Boolean(prompt.trim()) && !usageLoading && !usageError && usage?.enabled === true;

  const handleRun = () => {
    if (!canRun) {
      return;
    }

    saveAiReportPrompt(prompt);
    saveAiReportFormat(format);
    window.open(REPORTS_AI, "_blank");
  };

  return (
    <div className="flex flex-col gap-3 items-start w-full">
      <label className="text-sm text-gray-600 w-full">
        {t("filters.prompt")}
        <Textarea
          className="mt-1 min-h-40 w-full"
          placeholder={t("filters.aiPrompt")}
          value={prompt}
          onChange={event => setPrompt(event.currentTarget.value)}
          enableKeyboard={false}
        />
      </label>

      <AiExamplePrompts
        disabled={usage?.enabled === false || usageLoading || usageError}
        onSelect={handleExampleSelect}
      />

      <AiReportHistory onSelect={handleHistorySelect}/>

      <AiFormatSelector format={format} onChange={handleFormatChange} size="md"/>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          filled
          onClick={handleRun}
          disabled={!canRun}
        >
          {t("filters.run")}
        </Button>
        {usageLabel && (
          <span className="text-sm text-gray-500">{usageLabel}</span>
        )}
        {usageError && (
          <span className="text-sm text-danger-600">{t("filters.aiUsageUnavailable")}</span>
        )}
        {usage && !usage.enabled && (
          <span className="text-sm text-danger-600">{t("filters.aiDisabled")}</span>
        )}
      </div>
    </div>
  );
};
