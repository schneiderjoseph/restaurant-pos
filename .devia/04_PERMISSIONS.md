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

Hiding a control in the interface is never enforcement.

## Order visibility

A role without `order_visibility.all` sees only the orders its user opened on the Orders screen
(`user = $currentUser` added to the list query in `src/screens/orders.tsx`; the Users filter is
hidden). The Tables screen is unchanged (decided 2026-10-02). The permission sits in its own
section, not under `orders`: every role that opens the Orders page holds `orders`, and a parent
id grants all its children. `migrations/2026_10_02_order_visibility.surql` gave it once to every
role that existed (marker `order_visibility_grant_existing_roles`), so the restriction starts
when it is removed from the server roles; roles created later start without it. This scopes the
screen, it is not a data boundary: the database session can still read every order.

## Isolation

Data scope is restaurant / tenant via Surreal session; permission modules are per POS user
role. Cross-user elevation goes through manager override UI (`protectAction`).

## Audited actions

Manager overrides and auto-allowed `protectAction` successes write tracking via
`postTracking` in `useSecurity`.

| Action | Written where |
|---|---|
| protectAction success (auto or manager) | tracking service (`src/hooks/useSecurity.ts`) |
