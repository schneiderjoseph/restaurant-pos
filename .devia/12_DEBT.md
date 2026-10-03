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

## Discharged

| ID | What was missing | Discharged by |
|---|---|---|
