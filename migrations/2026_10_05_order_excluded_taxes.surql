-- Taxes removed from an order at payment (Payment screen → Tax): the ids listed here are
-- left out of the order's tax, whether they come from the items or from the payment type.
-- NONE / empty = every tax applies. order is SCHEMAFULL: apply before deploying the SPA, or
-- saving a payment fails.

DEFINE FIELD IF NOT EXISTS excluded_taxes ON order TYPE none | array<record<tax>> | null PERMISSIONS FULL;
