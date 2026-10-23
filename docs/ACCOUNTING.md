# How the numbers are counted

Not tax advice. Your tax preparer decides how each item is treated.

## Income
- **Revenue** = service revenue only. It **excludes tips and excludes refunds**.
- **Tips** are stored in their own field and never inside revenue, so nothing is counted twice.
- **Total receipts** = revenue + tips.
- **Processing fees** are the fee charged on the whole payment (revenue + tips).
- **Net after processing fees, before expenses** = total receipts − fees. It is **not profit**; expenses are not tracked yet.
- **Source** (Square, check, cash, bank transfer, other) and **tax form** (1099-K, 1099-NEC, none, not decided) are two separate choices. Neither fills in the other. New entries default to "not decided".
- **Visits** are entered per row (manual entries). Weeks run Monday to Sunday; "today" is Central time.
- **Refunds:** Square refund rows are flagged when imported and left out of income (see docs/SQUARE_IMPORT.md). There is no refund screen. Because they are left out, revenue totals can be higher than Square's net; the dashboard says so when any were flagged.

## Inventory (a separate ledger)
- Buying stock is **not** recorded as an expense, and using stock is **not** a visit.
- Whole-number quantities, one unit per item (box, pack, each).
- On hand is calculated from the history, never typed in. History is append-only; fix mistakes with an adjustment (reasons come from a fixed list, no free text).
- **Cost = weighted average.** Purchases and opening stock add `quantity × unit cost` to the running value. Using or removing stock takes out `value × quantity ÷ on hand` (all remaining value when the last unit goes). Adjusting up adds at the current average (zero if nothing was on hand).
- A movement that would make stock go negative on any date is refused.
- Lot numbers and expiration dates are recorded on purchases and opening stock only. Per-lot tracking comes later.
- Low-stock alert: on hand is at or below the item's reorder level. No level, no alert.

## Privacy
No patient or customer names, contact details or health information are stored. Do not type them into any field.
