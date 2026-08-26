# STOP — Loyverse agent: do NOT steal the ASI stack

**Owner decision (2026-08-26): NON.**

The default local checkout (`:5173` Vite + `:3142` gateway + `.env`) belongs to **ASI / Resort F&B** (`VITE_POS_MODE=asi`, Surreal `posr`/`posr`).

## Forbidden

- Do **not** set root `.env` → `VITE_POS_MODE=loyverse`
- Do **not** set `gateway/.env` → `SURREAL_NS=loyverse` / `SURREAL_DB=loyverse`
- Do **not** stop / restart / replace the processes on **5173** or **3142** for Loyverse demos
- Do **not** tell the user to “switch gateway temporarily” onto this same frontend

## Allowed

- Keep writing sync data only into Surreal **`loyverse`/`loyverse`** via `loyverse-sync/` (poller OK)
- Code under `loyverse-sync/`, docs, `source='loyverse'` mappings
- **Preferred:** separate worktree folder `C:\CODE\restaurant-pos-loyverse` (ports **5174** / **3143**)
- Alternate: second gateway+Vite on other ports with copies of env — never share ASI `.env` / ports
- In Loyverse mode, ASI may supply **rooms / PMS guests only** (`ASI_MENU_SYNC=0`) — never ASI catalogue into the Loyverse app

## If you already flipped this checkout

Restore immediately:

```text
.root .env     → VITE_POS_MODE=asi , VITE_RESORT_FB=true
gateway/.env   → SURREAL_NS=posr , SURREAL_DB=posr
```

Restart gateway + Vite for ASI only. Leave `loyverse-sync` on its own NS/DB if needed — it must not touch `posr/posr`.
