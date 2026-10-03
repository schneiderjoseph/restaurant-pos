# 05 — Flows

> The journeys the product cannot afford to break (`TST-005`).

## Critical journeys

| Journey | Steps | Covered by |
|---|---|---|
| Room charge only on an open stay | Payment → Room tender (`payment_type.type = 'Room'`) → customer re-read from the DB → `checkRoomCharge`: `source = 'asi-fd'`, `in_house`, sync < 5 min. Checked when the tender is added and again before the order is completed. Auto check close never uses a Room tender | `src/lib/room-charge.test.ts`, `asi-sync/src/guest-upsert.test.js` |
| Lock / unlock keeps the order being placed | Menu → add dishes → lock (`lockSession`) → same PIN unlocks → same cart. Another PIN → `switch-user` clears the order selection (`login.tsx`, `clearedOrderSelection`) | `src/store/app-state-storage.test.ts`, `src/lib/session-resume.test.ts` |
| Same total from cart to Orders screen | Menu → add dishes (cart shows each line's own taxes, `previewCartTotals`) → Envoyer en cuisine → order created with `order_item.tax` and `order_taxes` (`syncOrderTaxes`) → Orders card shows the same total before any payment | `src/lib/tax-calculator.test.ts` |
| Server hears their order is ready | Server sends an order → kitchen completes every line → on the terminal where that server is signed in (any page, lock screen included, not the order display screen) `MyOrderReadyAlert` chimes, says "Commande 12, Jean Dupont, est prête" (else the table) and shows a popup until OK | `src/lib/my-order-ready.test.ts` |
| One device per user | Server signed in on tablet A → signs in on tablet B → A's database socket closes, A's tokens are refused, A shows "connecté sur un autre appareil" and returns to login; unlock on A itself never signs A out; survives a gateway restart | `gateway/src/active-session-store.test.js`, `src/lib/session-check.test.ts` |
| Order wanted for a set time | Menu → cart → "Pour quand" (`OrderDueModal`: as soon as possible, in 15 min … 2 h, or a time today / tomorrow) → Envoyer → `order.due_at` → kitchen ticket prints `POUR 19:30` under the order number (`getOrderDueAt`, `printing/lib/order-mapping.js`; the day too when it is not today), add-on and duplicate tickets included → Orders card and list row show "Pour 19:30". Editing an order keeps its time unless the server changes it | `src/lib/order-due.test.ts`, `printing/lib/order-mapping.due.test.js` |
| Only the roles that cash take payment | Role form → "Peut recevoir le paiement" + payment types → payment screen offers only those types, or a notice when the role does not cash | `src/lib/payment-access.test.ts` |
| Classify menu by point of sale | Admin Categories → set `category.outlet` (or Appliquer les suggestions from kitchen stations) → Menu tabs filter via `outletOfCategory` → payment copies outlet onto the line → Sales summary `aggregateSalesByOutlet` | `src/lib/outlet.test.ts`, `src/lib/outlet-tabs.test.ts`, `src/api/reports/sales/outlet.test.ts` |

## Failure behaviour

For each critical journey: what the user sees when it fails, and what the system does — retry,
refund, queue, alert (`STATE-002`, `UX-012`).

| Journey | Failure mode | User sees | System does |
|---|---|---|---|
| Room charge only on an open stay | Guest checked out in ASI | Room button disabled + "Check-out fait dans ASI : ce client paie directement" | Room tender refused; other tenders unchanged; the order keeps its customer |
| Room charge only on an open stay | ASI sync late or customer read fails | Room button disabled + "Séjour non vérifiable" | Room tender refused (fail closed) |
| Server hears their order is ready | No tap on the terminal since the page loaded | Popup only, no sound (browser autoplay rule) | Sound unlocks on the first tap (`unlockSpeech`, `unlockReadyChime`) |
| Server hears their order is ready | Server signed in on no terminal, or another PIN took over | Nothing | No alert; the ready state is still on the order display screen |
| One device per user | Gateway unreachable while the other login happens | Nothing until it is back | The replaced tablet's socket is already closed by the gateway; the check treats network errors as unknown and never signs an offline tablet out |
| Order wanted for a set time | The chosen time is already past when the order is sent | Nothing | Saved as "as soon as possible" (`isDueAhead`); the ticket prints no time |
| Only the roles that cash take payment | Every payment type ticked on the role was deleted since | No payment-type button | Nothing can be tendered until the role is edited |
| Lock / unlock keeps the order being placed | Page reload while locked | Empty cart after unlock | Nothing: the cart is never written to localStorage (`slimAppStateForStorage`), only kept in this tab's memory (`keepOrderGraphInMemory`) |

A journey with no stated failure behaviour is a journey whose failure behaviour is an accident.
