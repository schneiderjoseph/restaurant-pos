import {LabelValue} from "@/api/model/common.ts";
import type {AccountHeadType, NormalBalance} from "@/api/model/account.ts";

type TranslateFn = (key: string) => string;

export const getHeadTypeOptions = (t: TranslateFn): LabelValue[] => [
  {label: t('headTypes.asset'), value: "asset"},
  {label: t('headTypes.liability'), value: "liability"},
  {label: t('headTypes.equity'), value: "equity"},
  {label: t('headTypes.income'), value: "income"},
  {label: t('headTypes.expense'), value: "expense"},
];

export const getNormalBalanceOptions = (t: TranslateFn): LabelValue[] => [
  {label: t('columns.debit'), value: "debit"},
  {label: t('columns.credit'), value: "credit"},
];

export const defaultNormalBalanceForHead = (headType: AccountHeadType): NormalBalance => {
  if (headType === "asset" || headType === "expense") {
    return "debit";
  }
  return "credit";
};

export const formatMoney = (value: number) => {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
};
