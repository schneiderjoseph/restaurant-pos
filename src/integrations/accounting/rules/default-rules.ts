import { PostingRule, PostingRuleCondition } from '@/integrations/accounting/types.ts';
import { IntegrationEvent } from '@/integrations/core/types.ts';
import { RESTAURANT_SALE_TEMPLATE_ID } from '@/integrations/accounting/templates/restaurant-sale.ts';
import { RESTAURANT_SALE_REVERSAL_TEMPLATE_ID } from '@/integrations/accounting/templates/registry.ts';

export const SALE_COMPLETED_RULE_ID = 'rule:sale-completed-restaurant-sale';
export const SALE_REFUNDED_RULE_ID = 'rule:sale-refunded-restaurant-sale-reversal';
export const ORDER_CANCELLED_RULE_ID = 'rule:order-cancelled-restaurant-sale-reversal';

export const defaultPostingRules: PostingRule[] = [
  {
    id: SALE_COMPLETED_RULE_ID,
    eventName: 'SaleCompleted',
    templateId: RESTAURANT_SALE_TEMPLATE_ID,
    enabled: true,
  },
  {
    id: SALE_REFUNDED_RULE_ID,
    eventName: 'SaleRefunded',
    templateId: RESTAURANT_SALE_REVERSAL_TEMPLATE_ID,
    enabled: true,
  },
  {
    id: ORDER_CANCELLED_RULE_ID,
    eventName: 'OrderCancelled',
    templateId: RESTAURANT_SALE_REVERSAL_TEMPLATE_ID,
    enabled: true,
  },
];

const matchCondition = (payload: Record<string, unknown>, condition: PostingRuleCondition): boolean => {
  const left = payload[condition.field];
  const right = condition.value;
  switch (condition.operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    case 'in':
      return Array.isArray(right) && right.includes(left);
    default:
      return false;
  }
};

export const findMatchingPostingRule = (
  event: IntegrationEvent<any>,
  rules: PostingRule[] = defaultPostingRules
): PostingRule | undefined => {
  const occurred = event.occurredAt ? new Date(event.occurredAt).getTime() : Date.now();
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const branchId = payload.branchId != null ? String(payload.branchId) : undefined;
  const currency = payload.currency != null ? String(payload.currency) : undefined;

  return rules.find((rule) => {
    if (!rule.enabled) {
      return false;
    }
    if (rule.eventName !== event.name) {
      return false;
    }
    if (rule.branchIds?.length && branchId && !rule.branchIds.includes(branchId)) {
      return false;
    }
    if (rule.currencies?.length && currency && !rule.currencies.includes(currency)) {
      return false;
    }
    if (rule.effectiveFrom && occurred < new Date(rule.effectiveFrom).getTime()) {
      return false;
    }
    if (rule.effectiveTo && occurred > new Date(rule.effectiveTo).getTime()) {
      return false;
    }
    if (rule.conditions?.length) {
      return rule.conditions.every((condition) => matchCondition(payload, condition));
    }
    return true;
  });
};
