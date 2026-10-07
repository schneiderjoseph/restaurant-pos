import { JournalTemplate } from '@/integrations/accounting/types.ts';
import {
  RESTAURANT_SALE_TEMPLATE_ID,
  restaurantSaleTemplate,
} from '@/integrations/accounting/templates/restaurant-sale.ts';

export const RESTAURANT_SALE_REVERSAL_TEMPLATE_ID = 'restaurant_sale_reversal';

/** Flip debit/credit of restaurant sale for refunds and paid cancels. */
export const restaurantSaleReversalTemplate: JournalTemplate = {
  id: RESTAURANT_SALE_REVERSAL_TEMPLATE_ID,
  name: 'Restaurant Sale Reversal',
  memo: 'POS sale reversal',
  lines: restaurantSaleTemplate.lines.map((line) => ({
    ...line,
    side: line.side === 'debit' ? 'credit' : 'debit',
  })),
};

const TEMPLATES: Record<string, JournalTemplate> = {
  [RESTAURANT_SALE_TEMPLATE_ID]: restaurantSaleTemplate,
  [RESTAURANT_SALE_REVERSAL_TEMPLATE_ID]: restaurantSaleReversalTemplate,
};

export const getJournalTemplate = (templateId: string): JournalTemplate | undefined =>
  TEMPLATES[templateId];

export const listJournalTemplates = (): JournalTemplate[] => Object.values(TEMPLATES);
