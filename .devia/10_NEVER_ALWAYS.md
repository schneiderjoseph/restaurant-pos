# 10 — Never / Always

> Rules this project earned. Each line comes from a real incident or a decision that was actually
> contested, and names the trap **and** the correct move (`MEM-010`).

## Never

- Never keep state in an `atomWithStorage` field that its storage strips before writing: jotai
  re-reads storage every time the atom is mounted again, so the field is wiped (the lock → unlock
  cart loss). Keep it in memory through the storage wrapper (`keepOrderGraphInMemory`) or a plain `atom`.
- Never ship a migration listed only in `run-prod-migrations.cjs`: the ASI prod updater
  (`docs/deploy/update-asi-prod.ps1`) runs its own `$UpgradeMigrations` list. Add it there too,
  idempotent, and run it on SurrealDB **3.0.5** (the prod image) first — a `GROUP BY` query that
  passes on 3.2 broke the ASI production update on 2026-10-02.

- Never pass an ISO string to a SurrealDB `datetime` field or comparison without
  `<datetime>$value`: SurrealDB 3 does not coerce. The gateway's revocation writes failed
  this way, so every logout was lost on restart (found 2026-10-03).

- Never put a permission that only some order-taking roles must hold under `orders.*`: a parent
  id grants all its children (`userModulesGrant`), so every role holding `orders` gets it. Give it
  its own section, as `order_visibility.all` and `payments.receive` do.
- Never put the value of `useDB()` in a hook dependency array when the effect sets state: the
  hook returns a new object on every render, so the effect runs on every render and never settles
  (`OrderEditRequestWatcher` looped this way in production on 2026-10-03, one query and one live
  subscription per turn, and sign-in hung). Read it through a ref (`dbRef.current`), as
  `ModuleAccessProvider` does, and key the effect on the user id.
- Never stamp the kitchen rows of one send with a per-row `time::now()`: the kitchen display
  groups rows into a ticket by `created_at` to the second, so a send that ran across a second
  boundary showed as two tickets (field report 2026-10-04). Take `kitchenFireTime(db)` once per
  send and pass it as `firedAt` to every `createStageRows` call.
- Never let a cart line take the selected category when the dish was not picked from it:
  `MenuDish` stamps `state.category` on the line, and `resolveOutlet` reads `category_id` first, so a
  dish found by search was sold under the wrong category and point of sale (found in review
  2026-10-04, before deployment). `MenuDishes.onClick` falls back to the dish's own category.

## Always

- Always read the memory file for a surface before changing it (`AGT-001`).
- Always update `.devia/` in the same change as the code (`MEM-009`).
- Always use `userModulesGrant` (via `useModuleAccess().can`) for nav/tab visibility — same
  predicate as `protectAction` auto-allow. Do not invent a second access check.

## How a line gets added

```text
Something broke, or a decision was argued twice
        ↓
Fix it
        ↓
Add ONE line: what not to do, and what to do instead
```

A line nobody has ever violated is noise, and noise teaches agents to skim. Delete it.
