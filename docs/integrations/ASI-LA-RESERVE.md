# ASI Point of Sale — La Réserve (discovery & sync plan)

**Status:** phase 1 menu sync **implemented** (2026-08-22) — package `asi-sync/`  
**Property:** La Réserve  
**Goal:** Near-real-time read sync from ASI (source of truth) into POSR (resort F&B POS)

This document records everything found on-site so implementation can proceed without re-discovering the stack.

---

## 1. Host & network

| Field | Value |
|-------|-------|
| Hostname | `LARESERVEPOS-SE` |
| LAN IP | `192.168.15.160` |
| OS | Windows 10 (build 16299) |
| RDP | TCP **3389** open |
| SMB share | `\\Lareservepos-se\asi` (mapped as `X:` on workstations) |
| Share contents | Application folder only: `ASI Point of Sale 6.0.0` — **no database files** |
| SQL TCP from LAN | **Not open historically on 1433**; instance listens on **dynamic port 52788** (must allow in firewall for POSR host only) |

Other shares on the same host (context only):

| Share | Notes |
|-------|--------|
| `BOOTDRV` | Legacy **Aloha** leftovers |
| `Staging` | SQL Express installer, Epson drivers, floor plan docs |
| `PUNCH` | Timeclock DLL |

Vendor: **Anand Systems Inc.** (ASI FrontDesk + ASI POS). Product URLs: anandsystems.com / asifrontdesk.com.

---

## 2. Product install (application)

Path (share): `X:\ASI Point of Sale 6.0.0` → `\\Lareservepos-se\asi\ASI Point of Sale 6.0.0`

| Artifact | Role |
|----------|------|
| `ASIPOS.exe` | Main POS (.NET Framework 4 WinForms) |
| `ASIPOS.exe.config` | Runtime only — **no connection string** |
| `asipos600.license` | POS license |
| `asifd600.license` | FrontDesk license present on POS box (FD may live elsewhere) |
| `ASI.Services.dll`, `ASI.Libraries.dll`, … | App libraries |
| SQL client DLLs | Confirms **SQL Server** backend |
| `POS_ItemList_*.csv` / `.xls` | Manual menu exports (one-shot; not live sync) |

Observed POS capabilities (from binaries / UI strings): items, groups, modifiers, tables, waiters, KOT, bills, taxes, payments, **room posting** to FrontDesk.

---

## 3. SQL Server

### 3.1 Instances (on `LARESERVEPOS-SE`)

| Instance | Registry / version | Role |
|----------|-------------------|------|
| **`ASI2008`** | `MSSQL10_50.ASI2008` (SQL Server **2008 R2**) | **Primary ASI POS databases** |
| `SQLEXPRESS` | `MSSQL11.SQLEXPRESS` | Present; not used for ASI listen path we care about |

Services observed running: `MSSQL$ASI2008`, `SQLBrowser`, etc.

### 3.2 Network endpoint

| Field | Value |
|-------|--------|
| Instance | `.\ASI2008` or `LARESERVEPOS-SE\ASI2008` |
| TCP port | **52788** (dynamic; set in SQL config `TcpDynamicPorts`) |
| Listen | `0.0.0.0:52788` / `[::]:52788` (`sqlservr`) |
| From POSR PC | Prefer `192.168.15.160,52788` once firewall allows |

Default data/backup roots (ASI2008):

```text
C:\Program Files (x86)\Microsoft SQL Server\MSSQL10_50.ASI2008\MSSQL\
C:\Program Files (x86)\Microsoft SQL Server\MSSQL10_50.ASI2008\MSSQL\Backup\
```

### 3.3 Databases on `ASI2008`

| Database | State | Role |
|----------|-------|------|
| **ASIPOS600** | ONLINE | Main POS catalog & transactions (v6) |
| **ASIPGPOS** | ONLINE | ASI Payment Gateway module |
| master / model / msdb / tempdb | ONLINE | System |

**Not found on this instance:** `ASIFD` / FrontDesk DB. In-house hotel guests/rooms for PMS are **not** in `ASIPOS600` (see §5).

### 3.4 Backup naming (examples on `G:`)

```text
G:\ASIPOS_6-2-000-001_20260822_144844.bak    → ASIPOS / ASIPOS600 family
G:\ASIPGPOS_6-2-000-001_20260822_144844.bak  → ASIPGPOS
```

Pattern: `{DBNAME}_{version}_{yyyyMMdd}_{HHmmss}.bak`

---

## 4. Schema — `ASIPOS600` (menu sync)

### 4.1 Entity relationship (menu)

```text
mItem
  └─ tItemPOS (itemID, itemgroupID, posID, itemPosID)
        ├─ mItemGroup (categories)
        └─ mItemRate  (itemPOSId → prices rate1..rate5, defaultRate)
```

### 4.2 Core tables

| Table | Purpose |
|-------|---------|
| `mItem` | Item master |
| `mItemGroup` | Categories |
| `tItemPOS` | Link item ↔ group ↔ POS outlet |
| `mItemRate` | Prices / tax / cost per POS item row |
| `tItemModifier` | Modifiers |
| `mItemRecipe` | Recipes (inventory; later / Kontrest) |
| `mCustomerMaster` | POS customers (**empty** on discovery day) |
| `mRoom` / `tRoomPOS` | POS rooms/zones (**empty**; not hotel PMS rooms) |
| `tItemTran` / `tItemPOS` sales paths | Transactions (phase 2+ / analytics) |

Other tables seen in catalog prefix: `mAccount*`, `mCreditor*`, `mCompanyInformation`, `mDepartment`, …

### 4.3 Columns — `mItem`

| Column | Type | Notes |
|--------|------|--------|
| `itemID` | int | PK |
| `itemAlias` | nvarchar | Short code (e.g. `ACR`, `FAC`) |
| `itemName` | nvarchar | Display name |
| `itemDescription` | nvarchar | |
| `purchase` / `sales` / `ingredient` | bit | Use `sales = 1` for menu |
| `isActive` / `isDeleted` | bit | Filter `isDeleted = 0`, `isActive = 1` |
| `supplierID` | int | |
| `InActiveDate` | datetime | |

**No `itemGroupID` on `mItem`** — group comes from `tItemPOS`.

### 4.4 Columns — `mItemGroup`

| Column | Type | Notes |
|--------|------|--------|
| `itemgroupID` | int | PK |
| `itemgroupAlias` | nvarchar | e.g. `AMU`, `BEER`, `CK` |
| `itemgroupName` | nvarchar | e.g. `AMUSES BOUCHE` |
| `itemgroupDescription` | nvarchar | |
| `isActive` / `isDeleted` | bit | |
| `lastUpdatedAt` | timestamp | rowversion — useful for incremental sync |
| `itemgroupImage` | | |
| `itemGroupColor` | | |

### 4.5 Columns — `tItemPOS`

| Column | Type |
|--------|------|
| `itemPosID` | int (PK) |
| `posID` | int |
| `itemgroupID` | int |
| `itemID` | int |

### 4.6 Columns — `mItemRate` (selected)

| Column | Notes |
|--------|--------|
| `itemRateId` | PK |
| `itemPOSId` | FK → `tItemPOS.itemPosID` |
| `unitID`, `seasonId` | |
| `itemCode`, `barCode` | |
| `rate1` … `rate5` | Price tiers |
| `defaultRate` | Which tier is default |
| `isDefaultUnit`, `isInclusiveTax` | |
| `tax1`…`tax5` (+ On / CountOn) | |
| `cost1`…`cost5` | Cost (do not expose as selling price) |

### 4.7 Groups in production (2026-08-22)

| ID | Alias | Name | Suggested POSR station |
|----|-------|------|------------------------|
| 1 | N/A | --N/A-- | ignore / uncategorized |
| 3 | AMU | AMUSES BOUCHE | cuisine |
| 4 | ENT | ENTREE/SALADE/SOUPE | cuisine |
| 5 | SAND | SANDWICHES / WRAP | cuisine |
| 6 | PIZZ | PIZZA | cuisine |
| 7 | VOLAI | VOLAILLES | cuisine |
| 8 | VIAND | VIANDES | cuisine |
| 9 | PATES | PATES | cuisine |
| 10 | GRATI | GRATINS | cuisine |
| 11 | POISS | POISSONS ET FRUITS DE MER | cuisine |
| 12 | ACCOM | ACCOMPAGNEMENTS | cuisine |
| 13 | ADD | ADDITIONEL | cuisine |
| 14 | DESS | DESSERTS | cuisine |
| 15 | MOC | MOCKTAILS | **bar** |
| 16 | JUS | JUS FRAIS | **bar** |
| 17 | NALC | NON-ALCOOLISES | **bar** |
| 18 | BEER | BEER | **bar** |
| 19 | CF | CAFE & THE | **bar** |
| 21 | CK | COCKTAILS MAISON | **bar** |
| 22 | CT | COCKTAILS TRADITIONNELS | **bar** |
| 23 | LQ | LIQUEURS | **bar** |
| 24 | SPI | SPIRITUEUX | **bar** |
| 25 | VM | VINS & MOUSEUX | **bar** |
| 26 | LIV | LIVRAISON | TBD |
| 27 | TOPPZ | TOPPING PIZZA | cuisine |

### 4.8 Sample items (`sales=1`, active)

Examples: Alaska Milk, Acras, Croquettes de morue, Poutine, Wings, Fish and Chips, La Réserve Platter, Fritay Lakay, Crème de poireaux, …

---

## 5. Guests & hotel rooms

| Source | Finding |
|--------|---------|
| `mCustomerMaster` / `mRoom` on POS box `ASIPOS600` | Empty — not the in-house guest list |
| **PMS host `SERVERCORMIER`** | **FrontDesk found 2026-08-24** |

### 5.1 PMS / FrontDesk (discovered)

| Field | Value |
|-------|--------|
| Hostname | `SERVERCORMIER` |
| LAN IP | **`192.168.0.190`** |
| Instance | **`ASI2017`** (`MSSQL14.ASI2017`, SQL Server 2017) |
| TCP port | **`56479`** (dynamic — freeze static later) |
| FrontDesk DB | **`ASIFD600`** (ONLINE, ~1 GB) |
| Also on same instance | `ASIPOS600`, `ASIPGPOS`, `ASIPG` |
| App path | `C:\Program Files (x86)\ASI\ASI FrontDesk 6.0.0` |

Guest / folio tables already visible in `ASIFD600` (sample):

- `fGuestMaster`, `fCheckInGuestInfo`, `fCheckinGuestInfo_MBR`
- `fSplitFolioMaster`, `cGuestCategory`, `cParameterGuestInfo`

**Implication:** guest/room sync = read from **`SERVERCORMIER\ASI2017` / `ASIFD600`**, not from the POS-only box.  
Room posting write-back still needs Anand-supported path (phase 2+).

---

## 6. Mapping ASI → POSR (phase 1 — menu)

| ASI | POSR field |
|-----|------------|
| `mItem.itemID` | Upsert key `menu_item.number = ASI-{itemID}`; also `asi_item_id` |
| `mItem.itemAlias` | `menu_item.asi_alias` (+ search) |
| `mItem.itemName` | Dish `name` |
| `mItemGroup.itemgroupID` + name/alias | `category` (`asi_group_id`, `asi_alias`, `source=asi`) |
| Bar aliases (§4.7) | Kitchen station **bar** (BDS) via `kitchen.items` + `BAR_CATEGORY_HINTS` |
| Food aliases | Kitchen station **cuisine** (KDS) |
| `mItemRate` via `defaultRate` → `rateN` | Selling `price` (prefer `isDefaultUnit`) |
| `mItem.isActive` / `isDeleted` / `sales` | Soft-delete (`deleted_at`) on ASI-sourced dishes |

**Upsert strategy:** poll every 10–30s (or watch `mItemGroup.lastUpdatedAt` / comparable rowversions where present); never invent prices on the POSR client beyond what ASI returned.

**Out of scope phase 1:** posting charges back to ASI folio, payment gateway `ASIPGPOS`, recipe → Kontrest.

### 6.1 Dining tables (phase 1b — implemented in `asi-sync`)

| ASI | POSR field |
|-----|------------|
| `mTable.tableID` | `floor_table:asi_t_{id}` + `asi_table_id` |
| `mTable.tableAlias` | `asi_alias` (e.g. `TB1`, `B16`) |
| `mTable.tableName` | Display via short `name`+`number` (e.g. `T`+`1`, `B`+`16`) |
| `tTablePOS` left/top | Used only when ≥40% of tables have coords; else compact grid |
| Soft-delete | Missing ASI tables + local `resort_t_*` seed on Salle |

Env: `ASI_TABLE_SYNC` (defaults to follow `ASI_MENU_SYNC` when unset).

---

## 7. Reference SQL (run on ASI host)

List databases:

```text
sqlcmd -S .\ASI2008 -E -Q "SELECT name, state_desc FROM sys.databases ORDER BY name;"
```

Menu join (validate prices + groups):

```sql
SELECT TOP 50
  i.itemID,
  i.itemAlias,
  i.itemName,
  g.itemgroupID,
  g.itemgroupAlias,
  g.itemgroupName,
  r.defaultRate,
  r.rate1,
  r.rate2,
  r.rate3,
  r.rate4,
  r.rate5,
  p.itemPosID,
  p.posID
FROM mItem i
INNER JOIN tItemPOS p ON p.itemID = i.itemID
INNER JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
LEFT JOIN mItemRate r ON r.itemPOSId = p.itemPosID
WHERE i.isDeleted = 0
  AND i.sales = 1
  AND i.isActive = 1
  AND g.isDeleted = 0
ORDER BY g.itemgroupName, i.itemName;
```

---

## 8. Connectivity checklist (before coding sync)

### 8.1 Menu sync — POS SQL (`LARESERVEPOS-SE` / historical path)

On **LARESERVEPOS-SE** (admin) — or wherever live `ASIPOS600` for menu is served:

1. **Firewall:** allow inbound TCP **52788** (or current POS SQL port) from POSR machine IP only.  
2. Prefer fixing a **static** TCP port later so it does not change after SQL restart.  
3. Create read-only SQL login on `ASIPOS600` (`posr_sync` / `db_datareader`).

> Note 2026-08-24: PMS box `SERVERCORMIER` also hosts `ASIPOS600` on `ASI2017:56479`. Confirm which host is the live menu source of truth before pointing `asi-sync`.

### 8.2 Guest / room sync — FrontDesk (`SERVERCORMIER`)

On **SERVERCORMIER** (admin):

1. **Firewall:** allow inbound TCP **56479** from the POSR machine IP only (not whole LAN).  
2. Prefer freezing **56479** to a static TCP port later.  
3. Create read-only SQL login on **`ASIFD600`** only:

```sql
CREATE LOGIN posr_fd_sync WITH PASSWORD = '<strong password>';
USE ASIFD600;
CREATE USER posr_fd_sync FOR LOGIN posr_fd_sync;
ALTER ROLE db_datareader ADD MEMBER posr_fd_sync;
```

4. Test from POSR PC:

```text
Server=192.168.0.190,56479;Database=ASIFD600;User ID=posr_fd_sync;Password=***;
```

5. Discovery script (re-run anytime): `scripts/find-asi-pms-database.ps1` on the PMS host.

### 8.3 Menu login SQL (reference — POS host)

```sql
CREATE LOGIN posr_sync WITH PASSWORD = '<strong password>';
USE ASIPOS600;
CREATE USER posr_sync FOR LOGIN posr_sync;
ALTER ROLE db_datareader ADD MEMBER posr_sync;
```

Test from POSR PC: `scripts/test-asi-sql-connection.ps1`  
Never commit passwords to git.

---

## 9. Target architecture

### 9.1 Menu (implemented)

```text
ASIPOS600 (read-only posr_sync)  ← confirm live host: POS box and/or SERVERCORMIER
        │  poll 30s (asi-sync/)
        ▼
   SurrealDB POSR
        ├─ category + menu_item (ASI-*)
        └─ kitchen cuisine / bar items
```

### 9.2 Guests / rooms (FrontDesk — implemented in `asi-sync`, off by default)

```text
SERVERCORMIER\ASI2017
  ASIFD600 (read-only posr_fd_sync)   192.168.0.190:56479
        │  poll 30s when ASI_FD_SYNC=1
        ▼
   SurrealDB POSR customers (THIS repo only)
        ├─ id: customer:asi_fd_{checkInID}
        ├─ guest_code = FD-{checkInID}
        ├─ name from first/middle/last
        ├─ room = cUnit.unitAlias
        ├─ asi_folio_no / asi_guest_id / asi_checkin_id / asi_unit_id
        └─ tags: asi, asi-fd, in-house (cleared on checkout) + in_house bool
```

**Source query:** `fCheckInInfo` where `isCheckOut = 0` and `isAnonymized = 0`, joined to `cUnit` for room.  
**Modules:** `asi-sync/src/fd-query.js`, `asi-sync/src/guest-upsert.js`.  
**Migration:** `migrations/2026_08_24_asi_guest_fields.surql`.

Do **not** point this poller at another POSR Surreal (e.g. a fork DB). Enable only with this checkout’s `SURREAL_URL`.

### Run the menu / guest sync

1. Apply schema fields once:

```powershell
surreal sql --endpoint http://127.0.0.1:8002 --user posr --pass <pass> --namespace posr --database posr --file migrations/2026_08_24_asi_guest_fields.surql
```

2. Copy `asi-sync/.env.example` → `asi-sync/.env` and set SQL + Surreal creds. Keep `ASI_FD_SYNC=0` / `ASI_MENU_SYNC=0` until ready.

3. Install and run (only when intentional):

```powershell
npm --prefix asi-sync install
# guests only:
#   ASI_MENU_SYNC=0  ASI_FD_SYNC=1
npm run asi-sync:once
npm run asi-sync
```

Logs look like: `Sync complete { menu: {…}, guests: { inHouse, created, updated, checkedOut } }`.

Tooling already in repo:

- `scripts/find-asi-database.ps1` — run **on the ASI PC** to rediscover instance/port/files
- `scripts/test-asi-sql-connection.ps1` — TCP + SqlClient from the POSR PC
- `asi-sync/` — menu + optional FrontDesk guest poller

---

## 10. Open questions

| # | Question | Impact |
|---|----------|--------|
| 1 | ~~Where is ASI FrontDesk DB?~~ **Found:** `SERVERCORMIER\ASI2017` / `ASIFD600` @ `192.168.0.190:56479` | Guest/room sync |
| 2 | Which `posID` is the live outlet for restaurant vs bar? | Filter `tItemPOS` (`ASI_POS_ID`) |
| 3 | Which rate tier is used on property (`defaultRate` → rate1–5)? | Correct selling price |
| 4 | Currency in ASI vs POSR (`HTG` / `USD`)? | Display + payment |
| 5 | Freeze dynamic ports (`52788` POS / `56479` PMS) to static? | Ops reliability |
| 6 | Write-back room posting: Anand-supported API vs direct SQL? | Phase 2 compliance |
| 7 | ~~Exact `ASIFD600` columns~~ **Mapped:** `fCheckInInfo` + `cUnit.unitAlias`; code `FD-{checkInID}` | Done |

---

## 11. Discovery / delivery log

| Date | Action |
|------|--------|
| 2026-08-22 | Mapped share `\\Lareservepos-se\asi`; studied POS 6.0.0 binaries & CSV export |
| 2026-08-22 | LAN probe: RDP/SMB open; 1433 closed |
| 2026-08-22 | On-host script: instances `ASI2008` + `SQLEXPRESS`; port **52788** |
| 2026-08-22 | Databases `ASIPOS600`, `ASIPGPOS` |
| 2026-08-22 | Schema + sample data for groups/items; empty customers/rooms |
| 2026-08-22 | Created SQL login `posr_sync` (db_datareader, `CHECK_POLICY=OFF`, SQL 2008 `sp_addrolemember`) |
| 2026-08-22 | **Verified from POSR PC:** TCP 52788 + SQL auth → `ASIPOS600`; sellable active items **216** |
| 2026-08-22 | **Implemented** `asi-sync/` phase 1: upsert categories/dishes, soft-delete, cuisine/bar `kitchen.items` |
| 2026-08-22 | **Verified once:** 24 ASI groups → 25 categories; **213** active `ASI-*` dishes; kitchen cuisine **111** / bar **102**; re-run idempotent |
| 2026-08-24 | **PMS found** on `SERVERCORMIER`: instance `ASI2017`, port **56479**, DB **`ASIFD600`** ONLINE; LAN **192.168.0.190**; guest tables `fGuestMaster`, `fCheckInGuestInfo`, `fSplitFolioMaster`, … |

### Verified connection string (read-only)

```text
Server=192.168.15.160,52788;Database=ASIPOS600;User ID=posr_sync;Password=***;
```

Password lives only on the ASI box / ops secrets — never commit. Test script: `scripts/test-asi-sql-connection.ps1`.

**Sync note:** join `mItem`→`tItemPOS`→`mItemRate` can return duplicate item rows (multiple units/rates). Prefer `isDefaultUnit = 1` and/or `defaultRate` → `rate1`…`rate5`, then upsert one dish per `itemID` (+ group). Implemented in `asi-sync/src/asi-query.js`.

---

## 12. Related POSR docs

- Resort F&B mode / guest lookup (local Surreal) — app code under resort settings  
- Integrations framework: `docs/integrations/framework.md`  
- Future: emit sales toward Kontrest Cost Intelligence (`SaleEvent`) — separate from ASI read sync  

---

*Document owner: POSR / La Réserve integration. Update this file when FrontDesk location or TCP port changes.*
