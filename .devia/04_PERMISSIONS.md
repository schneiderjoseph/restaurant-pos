# 04 — Permissions

> Who can do what, enforced on the server (`SEC-001`), and what leaves an audit trail
> (`DB-007`). Navigation and tabs are **hidden** client-side when the signed-in user has
> no grant; that hide is UX only — server-side / `protectAction` remains the enforcement
> for actions.

## Roles

| Role | Can | Cannot |
|---|---|---|
| POS user (role modules) | Open modules listed on their `user_role.roles` (and legacy aliases) | Open modules not granted — sidebar/tabs hidden; deep links redirected |
| Manager override | Approve `protectAction` for modules they themselves hold | — |

Permission IDs and hierarchy live in `src/lib/access.rules.ts` (`ACCESS_RULE_MODULES`,
`userModulesGrant`). Visibility rule: an entry with id `m` is shown iff
`userModulesGrant(modules, m)` is true — same test `protectAction` uses to skip the
manager modal.

## Client navigation visibility

| Surface | Behaviour | Where |
|---|---|---|
| Shared grants | Fetched once per signed-in user id | `ModuleAccessProvider` + `useModuleAccess()` in `src/providers/module-access.provider.tsx`, mounted in `ProtectedRoute` |
| Sidebar | Entries from `SIDEBAR_NAV_ENTRIES` filtered by feature flags + `can(role)`; Settings wrench requires `settings` | `src/screens/partials/sidebar.tsx`, `src/lib/module-access.ts` |
| Tabbed screens | Tabs/panels filtered by tab→module maps; first visible tab selected; empty state if none | admin, inventory, hr, delivery, accounts, integrations, reports |
| Route guard | Maps path → permission; redirects to first allowed sidebar page; no-access + logout if none. No redirect while `ready` is false. CLOCK unguarded | `src/routes/protected-route.tsx`, pure helpers in `src/lib/module-access.ts` |

## Enforcement

| Surface | Enforced where | Test |
|---|---|---|
| Module grant predicate | `userModulesGrant` / `protectAction` | `src/lib/access.rules.test.ts` |
| Route / first-allowed helpers | `getRoutePermission`, `getFirstAllowedPath`, `canAccessPath` | `src/lib/module-access.test.ts` |
| In-screen actions (create/update/delete, refunds, …) | Still `protectAction` + manager override — not hidden by this change | — |
| Taking payment, payment types per role | `can('payments.receive')` + `filterPaymentTypesForRole` in `src/components/orders/payment/order.payment.receiving.tsx` (screen only) | `src/lib/payment-access.test.ts` |

Hiding a control in the interface is never enforcement.

## Order visibility

One switch in Manage → General settings (`OrderVisibilitySettingsCard`, setting
`order_visibility.own_orders_only`, off by default): when on, a user sees only the orders they
opened on the Orders screen (`user = $currentUser` in `src/screens/orders.tsx`; the Users filter is
hidden), unless their role holds `order_visibility.all`. The same card lists the roles with a
"sees every order" switch that adds or removes that permission (saving needs `admin.users`).
Rule: `seesAllOrders` in `src/api/model/order_visibility.ts`. The Tables screen is unchanged.
The permission sits in its own section, not under `orders`: every role that opens the Orders
page holds `orders`, and a parent id grants all its children.
`migrations/2026_10_02_order_visibility.surql` gave it once to every role that existed. This
scopes the screen, it is not a data boundary: the database session can still read every order.

## Taking payment

Set per role in the role form (Manage → Roles, block "Encaissement"): a "can receive payment"
switch, which is the `payments.receive` permission, and the payment types the role may take
(`user_role.payment_types`; none ticked = every type).

Without `payments.receive`, the payment screen (`OrderPaymentReceiving`) shows a notice instead of
the quick amounts, the payment-type buttons and Complete; the temp bill, discounts and the rest
stay available. With it, only the role's payment types are offered (after the table's own
`payment_types` restriction, if any). The role is read again from the database when the payment
screen opens; if that read fails, the list read at sign-in is used.

`payments.receive` sits in its own section for the same reason as `order_visibility.all`: `orders`
would grant it to every server. `orders.complete_payment` is only a tracking label, it gates
nothing. `migrations/2026_10_03_role_payment_access.surql` gave `payments.receive` once to every
role that existed, so nothing changes on deploy until a role is edited. This hides controls on the
screen; it is not a data boundary. No manager override is offered here: a cashier signs in with
their own PIN (see `11_GAPS.md`).

## Changing an order already sent

`order_edit.sent_items` (role editor, section "Editing sent orders"; rule `EDIT_SENT_ITEMS_MODULE`,
`src/lib/order-edit-request.ts`) is the right to change a line that was already sent: quantity,
removal, comment, options (`diffSentLines`). Adding dishes to a sent order needs no permission.

A user who holds it saves the change directly, as before. A user who does not still edits the
cart, but on Envoyer (`src/components/payment/payment.tsx`) the sent lines are left as they are,
the new dishes are saved and sent, and the changes go into an `order_edit_request` (pending). The
role is read again from the database at that moment. Every signed-in user holding the permission
gets the request on their own terminal (`OrderEditRequestWatcher`, mounted in `src/app.tsx`, any
page, never on a locked screen): accept, refuse, or later. Only on accept are the lines written
(`approveOrderEditRequest`) and the kitchens told (`printApprovedOrderEdit`). The requester is told
the answer on the terminal where they are signed in.

It sits in its own section for the same reason as `order_visibility.all`. No migration grants it:
after deploy nobody holds it until it is ticked on a role, so until then every change to a sent
line waits with no one to answer it. This is enforced in the POS screens, not in the database.

## Isolation

Data scope is restaurant / tenant via Surreal session; permission modules are per POS user
role. Cross-user elevation goes through manager override UI (`protectAction`).

## One device per user

A user is signed in on one device at a time; the newest login wins (decided 2026-10-03).
Each login sends the browser's `deviceId` (`src/lib/device-id.ts`). The gateway records every
live session in `user_session` (`gateway/src/active-session-store.js`); a login from another
device revokes all the user's sessions from other devices and closes their `/rpc` sockets with
code 4001 (`gateway/src/ws-relay.js`). Same-device logins (unlock, reload, second tab) keep
each other. The replaced tablet notices within 10 s or when it comes back to the foreground
(`SessionReplacedWatcher`, `GET /auth/session` → `code: session_revoked`), shows why, and returns
to the login screen. This relies on clients reaching the database through the gateway relay
(nginx `/rpc`): the Surreal token handed out at login is not per user.

## Audited actions

Manager overrides and auto-allowed `protectAction` successes write tracking via
`postTracking` in `useSecurity`.

| Action | Written where |
|---|---|
| protectAction success (auto or manager) | tracking service (`src/hooks/useSecurity.ts`) |
| Change to sent lines asked for, and its answer | `order_edit_request` row: `requested_by`, `changes`, `status`, `decided_by`, `decided_at`; accept / refuse also go to the tracking service (`OrderEditRequestWatcher`) |
| Session replaced by a login on another device | `audit_log` `session_revoked` (`gateway/src/auth.routes.js`) |
