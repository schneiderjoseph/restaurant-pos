# 03 — Data model

> What is stored, and where its definition lives. The schema itself stays in the migrations
> (`MEM-008`).

## Entities

| Entity | Meaning | Defined in | Notes |
|---|---|---|---|
| `outlet` | Point of sale (Bar, Restaurant, …) — **not** the HR `department` table | `migrations/2026_10_02_outlets.surql`; `src/api/model/outlet.ts` | Managed from Settings → Categories (`OutletsManage`). Set on top-level `category.outlet` (sub-categories inherit through `parent`), optional `kitchen.outlet` (suggestion only). Menu tabs: `src/lib/outlet-tabs.ts`. Copied on each `order_item` when sold: `outlet_id` + `outlet` name |
| `user_session` | One row per live POS session (id = jti): `user`, `device_id`, `expires_at` | `migrations/2026_10_03_user_session.surql`; `gateway/src/active-session-store.js` | Written by the gateway only. Rows of other devices are deleted when the user signs in elsewhere |
| `customer` | A client: walk-in (`source = 'walk-in'`), ASI FrontDesk stay (`source = 'asi-fd'`, id `customer:asi_fd_{checkInID}`), or local | `migrations/latest.surql` + `2026_08_24_asi_guest_fields.surql`, `2026_10_01_customer_notes.surql`, `2026_10_02_customer_id_document.surql`; `src/api/model/customer.ts` | SCHEMAFULL. `id_document_number` is stored normalized (A–Z0–9, `normalizeIdDocument`) and only ever displayed masked (`maskIdDocument`) |

| `order_edit_request` | A change to lines already sent, waiting for (or holding) an approver's answer: `order`, `requested_by`, `status` (`pending` / `approved` / `rejected` / `expired`), `changes` (per line: void or update, with the values to write once approved), `decided_by`, `decided_at` | `migrations/2026_10_03_order_edit_request.surql`; `src/api/model/order_edit_request.ts` | SCHEMALESS (the change entries carry the modifier tree). Written by `src/lib/order-edit-request.ts`. Rows are kept: they are the record of who asked and who answered |
| `order.due_at` | When the guest wants the order (datetime); none / null = as soon as possible | `migrations/2026_10_03_order_due_at.surql`; `src/api/model/order.ts` | Set by the server in the cart (`OrderDueModal`, `src/lib/order-due.ts`). A time already past when the order is saved is stored as null |
| `user_role.payment_types` | The payment types a role may take (`array<record<payment_type>>`); none / empty = every type | `migrations/2026_10_03_role_payment_access.surql`; `src/api/model/user_role.ts` | Edited in the role form; read by `filterPaymentTypesForRole` (`src/lib/payment-access.ts`) |

## Invariants

- A walk-in is created only with a phone (≥ `MIN_PHONE_DIGITS` digits) or an ID document number
  (`hasWalkInContact`, `src/lib/customer-id-document.ts`). Enforced in both walk-in forms:
  `src/components/menu/guest.lookup.tsx` and `src/components/customer/customer.tsx`. Not enforced
  in the database.
- An ID document number never appears in full on screen or on a ticket.
- A customer that comes from ASI FrontDesk (`source = 'asi-fd'`, `isAsiGuest` in `src/lib/guest.ts`)
  is read-only in the POS: no phone or ID document edit on the guest selection page (decided by
  Joseph, 2026-10-03). The staff note (`notes`) stays editable: it is a POS field, carried from
  one stay to the next by `asi-sync`. Enforced on the screen and in the save handlers, not in the
  database.
- A room is never charged, a stay is: a Room tender (`payment_type.type = 'Room'`) is accepted only
  for an `asi-fd` customer with `in_house = true` and `asi_synced_at` under 5 min old
  (`src/lib/room-charge.ts`). `asi_date_out` is informational ("departs today"), never a block.
- An order line's outlet is fixed when it is sold (`resolveOutlet` in `src/lib/outlet.ts`, called
  from `src/components/payment/payment.tsx`): the picked category's outlet, else the dish's
  categories when they all agree, else none ("unclassified"). Sales by outlet read that copy
  (`aggregateSalesByOutlet`), never the category's current outlet. Sides and modifiers are inside
  their dish's line and count with it.
- An order line's taxes are fixed when it is sold (`buildOrderItemPayload`,
  `src/lib/order-item-pricing.ts`): `order_item.tax` stores the line's menu-tax amount in both
  modes. On an exclusive line, `tax > 0` is what makes its own `taxes` apply before payment
  (`orderItemCarriesOwnTaxes`, `src/lib/tax-calculator.ts`); lines stored before 2026-10-02 have
  `tax = 0` and stay taxed by the order tax only, so paid orders keep what they were charged. A
  tax chosen at payment (`order.tax`) replaces the line taxes of exclusive lines
  (`decisions.yaml` → `pricing.tax_rule`). The cart preview runs the same code
  (`previewCartTotals`, `src/lib/cart-tax-preview.ts`).

## Lifecycles

TODO(devia): the state machines that matter (order, payment, subscription): states, allowed
transitions, and where the transition code lives. A transition not listed here does not exist.

## Migrations

| Convention | Value |
|---|---|
| Location | `migrations/*.surql` |
| Naming | `YYYY_MM_DD_<subject>.surql` |
| How they run | `migrations/scripts/run-prod-migrations.cjs` (list `MIGRATION_PLAN`, tracked in `_schema_migration`); the ASI prod updater runs its own list, `$UpgradeMigrations` in `docs/deploy/update-asi-prod.ps1` — a migration goes in both |
| Rollback strategy | TODO(devia) |

Applied migrations are immutable; corrections ship forward (`DB-002`).
