-- Taxes a customer does not pay (diplomat, NGO, staff…). A new order for this customer
-- starts with them in order.excluded_taxes, so it is taxed right from the cart.
-- Set from the customer's preferences by a role allowed to remove taxes (orders.apply_tax).
-- Idempotent.

DEFINE FIELD IF NOT EXISTS tax_exemptions ON customer TYPE none | array<record<tax>> | null PERMISSIONS FULL;
