import {useTranslation} from "react-i18next";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faCodeBranch, faCodeMerge} from "@fortawesome/free-solid-svg-icons";
import {cn} from "@/lib/utils.ts";
import type {OrderLineage} from "@/lib/order-lineage.ts";

/** Where an order comes from / went to after a split or a merge ("Split from #088"). */
export const OrderLineageLabel = ({lineage, className}: {lineage?: OrderLineage, className?: string}) => {
  const {t} = useTranslation('orders');
  if (!lineage) {
    return null;
  }

  const lines = [
    lineage.splitFrom && {icon: faCodeBranch, text: t('lineage.splitFrom', {numbers: lineage.splitFrom})},
    lineage.splitInto && {icon: faCodeBranch, text: t('lineage.splitInto', {numbers: lineage.splitInto})},
    lineage.mergedFrom && {icon: faCodeMerge, text: t('lineage.mergedFrom', {numbers: lineage.mergedFrom})},
    lineage.mergedInto && {icon: faCodeMerge, text: t('lineage.mergedInto', {numbers: lineage.mergedInto})},
  ].filter(Boolean) as {icon: typeof faCodeBranch, text: string}[];

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-col gap-0.5 text-xs font-semibold text-info-700", className)} data-testid="order-lineage">
      {lines.map((line) => (
        <span key={line.text} className="flex items-center gap-1">
          <FontAwesomeIcon icon={line.icon}/>
          {line.text}
        </span>
      ))}
    </div>
  );
};
