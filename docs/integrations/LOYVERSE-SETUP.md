# Loyverse integration — what was built (2026-08-26)

## Goal

Second POS profile parallel to ASI: sell with **Loyverse cloud catalogue** in Surreal, without stealing the operator ASI stack (`:5173` / `:3142` / `posr`).

## Hard isolation rules

See [LOYVERSE-AGENT-NO.md](./LOYVERSE-AGENT-NO.md).

| Stack | Folder | Vite | Gateway | Surreal | Menu | Rooms |
|-------|--------|------|---------|---------|------|-------|
| ASI | `C:\CODE\restaurant-pos` | `:5173` | `:3142` | `posr`/`posr` | ASI SQL | ASI PMS |
| Loyverse | `C:\CODE\restaurant-pos-loyverse` (worktree `loyverse-pos`) | `:5174` | `:3143` | `loyverse`/`loyverse` | Loyverse API | ASI PMS **only** |

Never flip root `.env` / `gateway/.env` on the ASI checkout to Loyverse.

## Deliverables

### Surreal

- NS/DB **`loyverse`/`loyverse`** on same Surreal host (`ws://127.0.0.1:8001/rpc`)
- Migration `migrations/2026_08_26_loyverse_sync_fields.surql` (+ ASI room/guest field migrations when syncing PMS rooms)
- Scripts: `loyverse-sync/scripts/bootstrap-loyverse-db.js`, `clean-loyverse-db.js` (keeps `user` / `user_role`), `cleanup-posr-loyverse.js` (if ASI DB was polluted), `copy-users-from-posr.js`

### Poller `loyverse-sync/`

- PAT Bearer client, cursor pagination, 429 backoff
- Pull: categories, item **variants**, taxes, customers, payment types, discounts, stores/employees meta, modifiers (meta)
- Upsert with `source='loyverse'` + `loyverse_id` / `loyverse_variant_id`
- Menu `menu:loyverse_catalog` + `setting key=menus`
- Refuses `posr`/`posr`
- Receipt helper `src/receipt-push.js` (not wired to payment UI yet)

### App mode

- `VITE_POS_MODE=native|asi|loyverse`
- `isLoyverseMode()`, `isExternalCatalogueMode()`, `usesAsiPmsRooms()`
- Loyverse + `VITE_RESORT_FB=true` → hotel rooms / in-house guests from ASI FrontDesk; **menu stays Loyverse**
- Cache reload: `useEnsureLoyverseMenuCache`

### ASI sync in Loyverse worktree

`asi-sync/.env` there must be:

```env
ASI_MENU_SYNC=0
ASI_TABLE_SYNC=0
ASI_ROOM_SYNC=1
ASI_FD_SYNC=1
SURREAL_NS=loyverse
SURREAL_DB=loyverse
```

### Worktree setup

```bash
git worktree add -b loyverse-pos C:/CODE/restaurant-pos-loyverse HEAD
# own .env → VITE_POS_MODE=loyverse, VITE_RESORT_FB=true
# gateway/.env → port 3143, NS/DB loyverse
# bun install && cd gateway && node server.js
# bun run dev   # :5174
# cd loyverse-sync && npm start
# cd asi-sync && npm start   # rooms/guests only
```

UI: **http://localhost:5174/**  
ASI stays: **http://localhost:5173/**

## Secrets

Never commit: `loyverse-sync/.env`, `asi-sync/.env`, `gateway/.env`, `gateway/.env.loyverse` (use examples only).

## Still TODO

- Wire receipt push on POSR payment close
- Full Loyverse modifier → POSR dish-linked modifiers
- Multi-store beyond `LOYVERSE_STORE_ID`
