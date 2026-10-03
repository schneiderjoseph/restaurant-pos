# 11 — Gaps (undecided)

> Questions nobody has ruled on. Until a gap is decided, the code must not encode an answer
> silently (`MEM-001`).

IDs are monotone and never reused (`MEM-004`). A gap is closed by recording the decision — then
either building it, or opening a debt line for it.

Add one with `npx devia gap add "question"`.

| ID | Question | Impact if wrong | Interim behaviour | Status |
|---|---|---|---|---|
| G1 | Orders paid since go-live with exclusive ASI items: were they charged without TCA (no tax on the payment types)? If so, what is done about the shortfall and the tax return? | Tax under-collected and under-declared since go-live | Nothing recomputed: paid orders keep their stored `tax_amount` / `order_taxes`; only orders created after the fix carry line taxes | open |

## Closed

| ID | Question | Decided by |
|---|---|---|
