# Session notes — 2026-08-26 (ASI stack + printers + Loyverse isolation)

Operational notes for the ASI / native fork checkout. Complements [PROD-ASI.md](../deploy/PROD-ASI.md) and [LOYVERSE.md](./LOYVERSE.md).

## Stack ownership (hard rule)

| Port / resource | Owner |
|-----------------|--------|
| Vite `:5173` + root `.env` | **ASI** — `VITE_POS_MODE=asi`, `VITE_RESORT_FB=true` |
| Gateway `:3142` | **ASI** — Surreal `posr` / `posr` |
| Surreal `:8001` | Shared process OK; **NS/DB** must match the mode |
| `asi-sync` | Writes **only** `posr`/`posr` |
| `loyverse-sync` | Writes **only** `loyverse`/`loyverse` |

**Do not** flip this checkout’s gateway/Vite to Loyverse for demos. See [LOYVERSE-AGENT-NO.md](./LOYVERSE-AGENT-NO.md). Demo Loyverse UI on another gateway+Vite (ports/worktree).

---

## Features shipped (POS / orders / guests)

1. **Walk-in / local guests** stay visible with PMS in-house in guest lookup.
2. **Orders screen** — multi-select **Clients** filter (`ordersFilters.customers`).
3. **Split by clients** — `src/components/orders/split/split.clients.tsx` from order menu.
4. **Transfer order to another client file** — not “edit profile”:
   - Orders card menu → *Déplacer vers un autre client*
   - Guest folio (In Progress) → same action
   - `db.merge(order, { customer })` + toasts / same-client guard
5. Optional module flags already on `.env` (`VITE_MODULE_*`).

---

## Printers — how routing works

Creating a printer in **Admin → Imprimantes** is **not enough** for temp/final bills.

| Goal | Where |
|------|--------|
| Network ESC/POS device record | Admin → Imprimantes (Type `Network`, IP, port `9100`) |
| KOT Bar vs Cuisine | Admin → **Stations** → articles + **Printers** |
| Temp / final / refund / summary | **Paramètres → Imprimantes par défaut** → select → **Enregistrer** |

Schema notes (SCHEMAFULL `printer`):

- Required: `name`, `prints` (int — form sends `1`; copies live in `print_options`)
- Network: `ip_address`, `port`, `type`
- **No** `path` field — Serial/Bluetooth path is stored in `ip_address`
- Soft-delete: `deleted_at`

### Bugfixes (2026-08-26)

- Create printer failed: missing `prints` → now default `1`
- Create failed: form sent `path: null` → field omitted / Serial path mapped to `ip_address`
- Toast crashed on Error object → string message
- Temp print “No printers configured”: user setting pointed at **deleted** printer ID; load now drops orphans + clearer toast
- Save user printer settings as `StringRecordId` links (not bare strings)

### Print server (local Windows)

1. `cd printing && npm install --ignore-scripts` (Node 24: native `canvas` may fail; text ESC/POS still works)
2. `npx patch-package`
3. Ensure `printing/.env` has `GATEWAY_JWT_SECRET` + `GATEWAY_ALLOWED_ORIGINS` (same as root) — `server.js` loads it
4. Prefer **same-origin** print: empty/`VITE_PRINT_SERVER_URL` + Vite proxy `/print` → print port  
   Or direct `VITE_PRINT_SERVER_URL=http://127.0.0.1:3133` if `:3132` is stuck (`EADDRINUSE`)
5. CORS preflight fails with empty allow-list → set `GATEWAY_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`

Ignore browser noise: Edge **Tracking Prevention**, `requestFullscreen` without user gesture.

---

## i18n

- FR `admin.forms.*` receipt sections (`headerSections`, `addSection`, …)
- FR/EN `settings.printers.orphanedRemoved`, `noneConfigured`
- Orders transfer strings FR/EN (`transferToClient`, `transferHint`, …)

---

## Loyverse (parallel, isolated)

- Service: `loyverse-sync/` → Surreal **`loyverse`/`loyverse`**
- Docs: [LOYVERSE.md](./LOYVERSE.md), agent stop-file [LOYVERSE-AGENT-NO.md](./LOYVERSE-AGENT-NO.md)
- Mode flag: `VITE_POS_MODE=loyverse` only on an **isolated** UI stack

---

## Quick restore ASI

```text
.root .env       → VITE_POS_MODE=asi , VITE_RESORT_FB=true
gateway/.env     → SURREAL_NS=posr , SURREAL_DB=posr
```

Restart gateway + Vite. Leave `loyverse-sync` on its own NS if still polling.
