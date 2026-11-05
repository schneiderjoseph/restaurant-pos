import {useTranslation} from 'react-i18next';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {
  faCircleCheck,
  faCircleInfo,
  faTriangleExclamation,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import {cn} from '@/lib/utils.ts';

/**
 * Rule-based observation computed from the report data (no AI).
 * `text` is already translated by the caller.
 */
export type ReportInsight = {
  id: string;
  severity: 'info' | 'good' | 'warn' | 'bad';
  text: string;
};

const iconFor = {
  info: faCircleInfo,
  good: faCircleCheck,
  warn: faTriangleExclamation,
  bad: faCircleExclamation,
};

const colorFor = {
  info: 'text-sky-600',
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
};

const order = {bad: 0, warn: 1, info: 2, good: 3};

/** "À retenir" box: the few things worth acting on, most urgent first. */
export const ReportInsights = ({items, className}: { items: ReportInsight[]; className?: string }) => {
  const {t} = useTranslation('reports');
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <section className={cn('border border-sky-100 bg-sky-50/60 rounded-lg p-4 mb-5 break-inside-avoid', className)}>
      <h2 data-xlsx-heading className="text-sm font-semibold text-neutral-800 mb-2">
        {t('insights.title')}
      </h2>
      <ul data-xlsx-insights className="space-y-1.5">
        {sorted.map((insight) => (
          <li key={insight.id} className="flex gap-2 text-sm text-neutral-800">
            <FontAwesomeIcon
              icon={iconFor[insight.severity]}
              className={cn('mt-0.5 shrink-0', colorFor[insight.severity])}
              data-xlsx-ignore
            />
            <span>{insight.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
