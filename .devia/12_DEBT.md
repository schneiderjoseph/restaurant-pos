# 12 — Debt (decided, not built)

> The project decided; the code does not honour it yet. Adding a line is mandatory even when you
> are not the one fixing it (`MEM-002`). A line is removed only by the change that discharges it,
> and partial work **reduces** the line rather than deleting it (`MEM-003`).

IDs are monotone and never reused (`MEM-004`). A false line is worse than a missing one
(`MEM-005`).

Add one with `npx devia debt add "what is missing"`.

| ID | Rule | Where | What is missing | Priority | Opened |
|---|---|---|---|---|---|
| D1 |  |  | npm run lint fails: eslint ^10 is installed but the config is .eslintrc.cjs (eslintrc format removed in ESLint 9+); lint cannot run until the config moves to eslint.config.js or eslint is pinned below 9 | P2 | 2026-10-02 |
| D2 |  |  | ASI production: the existing 'Chambre' payment type must be switched to type 'Room' (payment types settings) or the room-charge guard does not apply to it; read the record and confirm with Joseph before writing | P2 | 2026-10-02 |
| D3 |  |  | Auto check close settings filter pt.type !== 'remote' but payment types are stored as 'Remote' (src/components/user_settings/auto_check_close.tsx), so remote tenders are still offered as the auto-close tender | P2 | 2026-10-02 |
| D4 |  |  | The two 2026-10-03 migrations (order_due_at, role_payment_access) were run on SurrealDB 3.2.0 only; run them on 3.0.5 (the prod image) before the ASI production update, per 10_NEVER_ALWAYS | P2 | 2026-10-03 |
| D5 |  |  | migrations/2026_10_03_order_edit_request.surql and the order_edit_request queries (src/lib/order-edit-request.ts) were run on SurrealDB 3.2.0 only; run them on 3.0.5 (the prod image) before the ASI production update, per 10_NEVER_ALWAYS | P2 | 2026-10-03 |
| D6 |  |  | Order change approval strings (orders.editRequest, payment.editRequest, receipts.modifiedKot, the order_edit permission labels) exist in en and fr only; the other nine locales fall back | P2 | 2026-10-03 |
| D7 |  |  | docs/user-guide images cart-panel.png and cart-payment-actions.png still show the Pay now button removed on 2026-10-03; re-run the docs capture (docs-automation/stories/cart.guide.ts) | P2 | 2026-10-03 |
| D8 |  |  | Production: create a payment type named Crédit / Credit with `type = 'Credit'` (Manage → Payment types) or house-account tenders never appear; run migrations `2026_10_10_customer_credit.surql` and `2026_10_10_customer_credit_request.surql` on prod SurrealDB | P2 | 2026-10-10 |
| D12 |  |  | Credit-request and order-edit approval strings (orders.creditRequest, payment.receiving.creditRequest*) exist in en and fr only; other locales fall back | P2 | 2026-10-10 |
| D9 | done | 2026-10-10 | Credit/Room excluded from `amountCollected` / closing `totalOtherPayments`; shown as deferred charges in Summary + sales reports (`getOrderPaymentTotals`). Cash settle of AR still counts as till money when collected | P2 | 2026-10-10 |
| D10 |  |  | Mixed Cash+Credit then partial refund: AR is capped with min(Credit tender, remaining goods), which can over-attribute remaining goods to Credit when Cash also paid; Credit-only partial refund is correct. Full refunds (no active lines) are excluded | P2 | 2026-10-10 |
| D11 |  |  | Partial refund does not recompute tip_amount / service_charge_amount / extras (only taxes via syncOrderTaxes); Credit AR cap uses grandTotalDue so leftover tip/service can keep AR slightly high until a full refund | P2 | 2026-10-10 |

## Discharged

| ID | What was missing | Discharged by |
|---|---|---|
