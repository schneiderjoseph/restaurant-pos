import type { BuyXGetYCondition } from '@/api/model/discount.ts'

export const DEFAULT_BXGY_CONDITIONS: BuyXGetYCondition = {
  buy_quantity: 2,
  get_quantity: 1,
  buy_targets: {},
  get_targets: {},
  get_value_type: 'free',
  get_value: 100,
}

export const normalizeBxgyConditions = (
  value?: BuyXGetYCondition | null
): BuyXGetYCondition => {
  const base = value || DEFAULT_BXGY_CONDITIONS
  const getValueType = base.get_value_type || 'free'
  const rawValue = Number(base.get_value)
  const getValue = Number.isFinite(rawValue)
    ? rawValue
    : getValueType === 'fixed_amount'
      ? 0
      : 100

  return {
    buy_quantity: Math.max(1, Number(base.buy_quantity) || 1),
    get_quantity: Math.max(1, Number(base.get_quantity) || 1),
    buy_targets: {
      item_ids: base.buy_targets?.item_ids || [],
      category_ids: base.buy_targets?.category_ids || [],
    },
    get_targets: {
      item_ids: base.get_targets?.item_ids || [],
      category_ids: base.get_targets?.category_ids || [],
    },
    get_value_type: getValueType,
    get_value: getValue,
  }
}
