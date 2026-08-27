# Loyverse ↔ POSR integration

**Status:** mirror JSON (`loyverse_mirror`) + POSR projection on **isolated** Surreal NS/DB  
**Goal:** Pull Loyverse cloud data into POSR without touching the ASI/native `posr/posr` database.  
**Orthogonal to ASI:** one external mode at a time (`VITE_POS_MODE=asi` **or** `loyverse`).

Official docs: [Developer hub](https://developer.loyverse.com/) · [API reference](https://developer.loyverse.com/docs/)  
Base URL: `https://api.loyverse.com/v1.0`

---

## 0. Isolated database (required)

| Target | Value |
|--------|--------|
| Surreal URL | same instance OK, e.g. `ws://127.0.0.1:8001/rpc` |
| Namespace | **`loyverse`** |
| Database | **`loyverse`** |
| Never | `posr` / `posr` (ASI + native checkout) |

Bootstrap (once):

```bash
node loyverse-sync/scripts/bootstrap-loyverse-db.js
```

If Loyverse rows were written into `posr/posr` by mistake:

```bash
node loyverse-sync/scripts/cleanup-posr-loyverse.js
```

That soft-deletes `source='loyverse'` rows and restores `setting.menus` → `menu:asi_restaurant`.

The poller **refuses** to sync when `SURREAL_NS=posr` and `SURREAL_DB=posr`.

### UI / ports — HARD NO on the shared ASI checkout

See **[LOYVERSE-AGENT-NO.md](./LOYVERSE-AGENT-NO.md)**.

Do **not** flip `C:\CODE\restaurant-pos` root `.env` or `gateway/.env` (ports **5173** / **3142**) to Loyverse.

**Isolated folder (preferred):** git worktree  
`C:\CODE\restaurant-pos-loyverse` (branch `loyverse-pos`)

| Stack | Folder | Vite | Gateway | Surreal | Menu source | Rooms |
|-------|--------|------|---------|---------|-------------|-------|
| **ASI** | `restaurant-pos` | `:5173` | `:3142` | `posr/posr` | ASI SQL | ASI PMS |
| **Loyverse** | `restaurant-pos-loyverse` | `:5174` | `:3143` | `loyverse/loyverse` | Loyverse API | ASI PMS only (`ASI_MENU_SYNC=0`) |

In Loyverse mode: catalogue = Loyverse; **only hotel rooms / in-house guests** may come from ASI FrontDesk — never ASI POS menu/tables.

---

## 1. Auth (POC)

| Choice | Use |
|--------|-----|
| **Personal Access Token (PAT)** | POC / single merchant — Bearer from Back Office → Access Tokens |
| OAuth2 authorization code | Multi-merchant app later |

**POC:** PAT in `loyverse-sync/.env` only — never Vite, never git.

### Scopes

| Scope | Phase |
|-------|--------|
| `CATEGORIES_READ` `ITEMS_READ` `TAXES_READ` `MODIFIERS_READ` `STORES_READ` | 1 |
| `CUSTOMERS_READ` `PAYMENT_TYPES_READ` (discounts via discounts API) | 1b |
| `EMPLOYEES_READ` `SUPPLIERS_READ` `MERCHANT_READ` `INVENTORY_READ` | mirror |
| `RECEIPTS_READ` `SHIFTS_READ` | backfill / incremental |
| `RECEIPTS_WRITE` | push on POSR close (helper ready) |

---

## 2. Architecture (mirror + projection)

```text
Loyverse API ──fetch──► loyverse_mirror (JSON brut)
                              │
                              └──► POSR tables (menu_item, customer, …)
```

| Table | Role |
|-------|------|
| `loyverse_mirror` | Payload API intégral par ressource + `loyverse_id` |
| `loyverse_sync_state` | Curseurs backfill receipts/shifts |

Pipeline (`loyverse-sync/src/index.js`): **fetch → mirror → project POSR**.

Flags: `LOYVERSE_MIRROR_SYNC=1` (default). Receipts/shifts off by default — enable for backfill jobs only.

| Ressource API | Mirror key | Projection POSR |
|---------------|------------|-----------------|
| categories | `category` | `category` |
| items | `item` | `menu_item` (variants) |
| taxes | `tax` | `tax` |
| modifiers | `modifier` | `modifier_group` + `modifier` + links |
| customers | `customer` | `customer` |
| payment_types | `payment_type` | `payment_type` |
| discounts | `discount` | `discount` |
| stores / employees | `store` / `employee` | `setting` meta |
| suppliers / pos_devices / merchant | mirror only | — |
| inventory | `inventory:{variant}:{store}` | optional stock |
| receipts | `receipt` (receipt_number) | `order` read-only shell |

Commands (worktree only):

```bash
cd loyverse-sync
npm run once              # mirror catalogue + project
npm run verify-mirror     # API count vs mirror
npm run backfill-receipts # long job — LOYVERSE_SYNC_RECEIPTS=1
npm run backfill-shifts
npm run webhook           # :3150/webhooks/loyverse
```

---

## 3. Data flow (legacy summary)

```text
Loyverse API ──pull──► loyverse-sync ──upsert──► Surreal loyverse/loyverse
POSR payment close ──push receipt──► Loyverse   (helper: src/receipt-push.js — wire later)
```

| Direction | Resource | Status |
|-----------|----------|--------|
| → POSR | categories, item variants, taxes, modifiers | **synced** |
| → POSR | customers, payment types, discounts | **synced** |
| → POSR | stores + employees (meta in `setting`) | **synced** |
| → Loyverse | receipt on order paid | helper ready, UI hook TBD |

---

## 3. Mapping

| Loyverse | Surreal (`loyverse/loyverse`) |
|----------|-------------------------------|
| Category | `category` `source=loyverse` `loyverse_id` |
| Item variant | `menu_item` per variant; `loyverse_variant_id` |
| Tax | `tax:loyverse_<uuid>` |
| Modifier / options | `modifier_group` / `modifier` |
| Customer | `customer` `guest_code=LV-…` |
| Payment type | `payment_type` |
| Discount | `discount` |
| Store / employee | `setting` keys `loyverse_stores` / `loyverse_employees` |
| Menu | `menu:loyverse_catalog` + `setting key=menus` |

---

## 4. Env

```env
# loyverse-sync/.env
LOYVERSE_ACCESS_TOKEN=
LOYVERSE_STORE_ID=                 # optional
LOYVERSE_MENU_SYNC=1
LOYVERSE_CUSTOMER_SYNC=1
LOYVERSE_PAYMENT_SYNC=1
LOYVERSE_DISCOUNT_SYNC=1
LOYVERSE_MODIFIER_SYNC=1

SURREAL_URL=ws://127.0.0.1:8001/rpc
LOYVERSE_SURREAL_NS=loyverse
LOYVERSE_SURREAL_DB=loyverse
SURREAL_USER=posr
SURREAL_PASS=...

# App (gateway must also use loyverse/loyverse when testing this mode)
VITE_POS_MODE=loyverse
```

```bash
cd loyverse-sync && npm run bootstrap-db && npm install && npm run once
```

---

## 5. Limits

- Receipt push not hooked to payment UI yet (`receipt-push.js` only).
- Modifiers empty on some merchants — stored as `setting` meta (POSR modifiers are dish-linked).
- On the **Loyverse** worktree, `asi-sync` may target `loyverse`/`loyverse` with **`ASI_MENU_SYNC=0` / `ASI_TABLE_SYNC=0`** and rooms/guests only. Never enable ASI menu sync into that DB.
- Never run `loyverse-sync` against `posr`/`posr`.
- Never point the ASI checkout (`:5173` / `:3142`) at the Loyverse Surreal NS/DB.

See also [LOYVERSE-SETUP.md](./LOYVERSE-SETUP.md) for the full build log / ops checklist.
