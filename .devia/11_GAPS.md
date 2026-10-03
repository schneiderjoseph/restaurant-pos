# 11 — Gaps (undecided)

> Questions nobody has ruled on. Until a gap is decided, the code must not encode an answer
> silently (`MEM-001`).

IDs are monotone and never reused (`MEM-004`). A gap is closed by recording the decision — then
either building it, or opening a debt line for it.

Add one with `npx devia gap add "question"`.

| ID | Question | Impact if wrong | Interim behaviour | Status |
|---|---|---|---|---|
| G1 | Orders paid since go-live with exclusive ASI items: were they charged without TCA (no tax on the payment types)? If so, what is done about the shortfall and the tax return? | Tax under-collected and under-declared since go-live | Nothing recomputed: paid orders keep their stored `tax_amount` / `order_taxes`; only orders created after the fix carry line taxes | open |
| G2 | Role without payments.receive: the tender buttons are hidden with a notice and no manager-PIN override is offered (a cashier signs in). Is an override wanted, as for discounts? | | | open |
| G3 | Order due time (order.due_at) is printed on the kitchen ticket and shown on the Orders screen, but not on the kitchen display screen nor on the temp / final bill. Wanted there too? | | | open |
| G4 | A user holding order_edit.sent_items changes a sent line directly: the change is saved but no kitchen ticket prints (only an approved request prints one, and a removed line only cancels its kitchen rows). Should the direct change print the same tickets? | | | open |
| G5 | A server who reopens an order with a change request still pending sees the order as sent, with no sign that a request is waiting, and can send a second one. Show the pending request in the cart, or replace the earlier one? | | | open |
| G6 | Order change requests never time out: with no user holding order_edit.sent_items signed in, a request stays pending until the order is paid (then it expires when someone opens it). Is a timeout or an alert to the server wanted? | | | open |

## Closed

| ID | Question | Decided by |
|---|---|---|
