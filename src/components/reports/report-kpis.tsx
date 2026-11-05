import type {ReactNode} from 'react';
import {cn} from '@/lib/utils.ts';

export type ReportKpi = {
  label: string;
  /** Displayed value (already formatted). */
  value: ReactNode;
  /** Exact number for the Excel export; parsed from the text when omitted. */
  rawValue?: number;
  rawFormat?: 'money' | 'number' | 'percent' | 'integer';
  /** Small line under the value (e.g. "12 clients", "vs 1 200 G la semaine passée"). */
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
};

const toneClasses: Record<NonNullable<ReportKpi['tone']>, string> = {
  default: 'border-neutral-200 bg-neutral-50',
  good: 'border-emerald-200 bg-emerald-50',
  warn: 'border-amber-200 bg-amber-50',
  bad: 'border-red-200 bg-red-50',
};

const valueTone: Record<NonNullable<ReportKpi['tone']>, string> = {
  default: 'text-neutral-900',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
};

/** Row of headline numbers at the top of a report (exported as a KPI block in Excel). */
export const ReportKpis = ({items, className}: { items: ReportKpi[]; className?: string }) => {
  if (items.length === 0) return null;
  return (
    <div
      data-xlsx-kpis
      className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5', className)}
    >
      {items.map((kpi) => {
        const tone = kpi.tone ?? 'default';
        return (
          <div
            key={kpi.label}
            data-xlsx-kpi
            className={cn('border rounded-lg p-4 break-inside-avoid', toneClasses[tone])}
          >
            <div data-xlsx-kpi-label className="text-xs uppercase tracking-wide text-neutral-500">
              {kpi.label}
            </div>
            <div
              data-xlsx-kpi-value
              {...(kpi.rawValue !== undefined
                ? {'data-xlsx-value': String(kpi.rawValue), 'data-xlsx-format': kpi.rawFormat ?? 'money'}
                : {})}
              className={cn('text-2xl font-semibold mt-1', valueTone[tone])}
            >
              {kpi.value}
            </div>
            {kpi.hint && <div className="text-xs text-neutral-500 mt-1" data-xlsx-ignore>{kpi.hint}</div>}
          </div>
        );
      })}
    </div>
  );
};
