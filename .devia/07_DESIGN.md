# 07 — Design

> The interface decisions specific to this project. The general rules live in the standard
> (`standard/standard/design/`); this file records what is local.

## Visual direction

TODO(devia): what this product looks like and why — the decision the styling implements. Until
`design.direction` in [`decisions.yaml`](decisions.yaml) is decided or delegated, there is no
direction to implement, and nothing may establish one by accident (`DEC-004`).

Undefined direction is not an invitation to reach for whatever a generated interface usually
looks like. It is a gap, with an owner.

| Decision | Value | Ruled in |
|---|---|---|
| Visual direction | TODO(devia) | `decisions.yaml` → `design.direction` |
| Design system | TODO(devia): existing, custom, or none | `decisions.yaml` → `design.system` |
| Imagery | TODO(devia): photography, illustration, or neither | `decisions.yaml` → `content.imagery` |

Assets are delivered by their owner, not improvised by whoever needs one (`DEC-005`). A missing
logo shows as a missing logo.

## Tokens

| Token set | Source of truth | Consumed by |
|---|---|---|
| TODO(devia) | | |

Git is the source of truth for tokens (`DS-001`); components consume semantic tokens, not raw
values (`DS-002`, `UI-003`).

## Components

| Component | Where | States implemented |
|---|---|---|
| TODO(devia) | | |

Complete means default, hover, focus, active, disabled, loading, empty, error, success — plus
permission-denied and offline where they can occur (`STATE-001`, `STATE-002`, `STATE-003`).

## Patterns fixed for this product

TODO(devia): the choices that must stay consistent — table density, date and currency format,
empty-state voice, how destructive actions are confirmed (`UX-011`).

## Interface decisions

| Decision | Why | Recorded in |
|---|---|---|
| Order number shown as `#012` (`formatOrderNumber`, `src/lib/order.ts`): padded to 3 digits, global counter never reset, split suffix kept. Orders cards and rows, kitchen, order display. Speech and printed tickets keep the plain number | Joseph, field feedback 2026-10-02 | this file |
| Touch mode (`appPage.touch`, on by default, per browser): every text `Input` opens the POS keyboard and is read-only to the native one (`usesPosKeyboard`, `src/components/common/input/keyboard-mode.ts`); opt out with `enableKeyboard={false}`. `ReactSelect` is not searchable unless the caller sets `isSearchable`. A physical keyboard types into the POS keyboard. Not covered: raw `<input>` in back-office forms, date pickers, uncontrolled `type="number"` inputs | Joseph, field feedback 2026-10-02: the tablet's own keyboard slid up over the POS one | this file |
| Orders card: number (no order type — "· Sur place" removed, Joseph 2026-10-03), status, server, guest + one contact (phone, else #code, else masked ID — `formatGuestContact`), `HH:mm · 18 min` while in progress, every line with quantity and line total, Total only (no tax / discount breakdown) | Joseph, field feedback 2026-10-02 | this file |
| Orders list view: one grid shared by a sticky header and the rows (`ORDERS_LIST_GRID_CLASS`, `src/components/orders/order.row.tsx`): N° · Table / Client · Serveur · Statut · Heure · Articles · Total. Rows at least 56px, the whole row opens payment for an in-progress order. Total only, like the card. The filter bar wraps; the merge bar exists only while merging | Joseph, field feedback 2026-10-03 | this file |
| "Open cash drawer" button on the Orders screen is hidden (`SHOW_OPEN_CASH_DRAWER = false`, `src/screens/orders.tsx`); the code, the permission and the translation are kept | Joseph, 2026-10-03 | this file |
| Guest selection page (`src/components/menu/guest.lookup.tsx`): list rows at least 64px with a room chip, list fills the height; a room guest shows the planned departure (`asi_date_out` via `getGuestDeparture`, `src/lib/guest-departure.ts`), in warning colour when it is today or past — informational, never a block; "Démarrer la commande" stays pinned at the bottom of the selected-guest panel; secondary buttons at least 48px | Joseph, field feedback 2026-10-03 | this file |
| Guest selection page, no information twice: a list row carries what identifies the guest (name, #code, phone, room chip or walk-in badge); the selected-guest panel carries the rest (room, planned departure, "Dernière commande : 03 oct. 2026", masked ID document, note) and does not repeat the code or the phone. An ASI guest shows a read-only notice instead of the phone / ID edit buttons | Joseph, 2026-10-03 | this file |
| A wanted time is shown as "Pour 19:30" in warning colour next to the order time (`OrderElapsed`: card, list row, payment screen) and on the cart button that sets it | Joseph, 2026-10-03 | this file |
