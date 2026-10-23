# How the numbers are counted

Not tax advice. Your tax preparer decides how each item is treated.

## Income
- **Revenue** = service revenue only. It **excludes tips and excludes refunds**.
- **Tips** are stored in their own field and never inside revenue, so nothing is counted twice.
- **Total receipts** = revenue + tips.
- **Processing fees** are the fee charged on the whole payment (revenue + tips).
- **Net after processing fees, before expenses** = total receipts − fees. It is **not profit**; expenses are not tracked yet.
- **Source** (Square, check, cash, bank transfer, other) and **tax form** (1099-K, 1099-NEC, none, not decided) are two separate choices. Neither fills in the other. New entries default to "not decided".
- **Visits** are optional and editable on every entry, including imported ones. Nothing is counted as a visit automatically unless you choose that at import. Dashboard visits are the sum of what you entered. Weeks run Monday to Sunday; "today" is Central time.
- **Refunds:** Square refund rows are flagged when imported and left out of income (see docs/SQUARE_IMPORT.md). There is no refund screen. Because they are left out, revenue totals can be higher than Square's net; the dashboard says so when any were flagged.

## Inventory (a separate ledger)
- Buying stock is **not** recorded as an expense, and using stock is **not** a visit.
- Whole-number quantities, one unit per item (box, pack, each).
- On hand is calculated from the history, never typed in. History is append-only; fix mistakes with an adjustment (reasons come from a fixed list, no free text).
- **Cost = weighted average.** Purchases and opening stock add `quantity × unit cost` to the running value. Using or removing stock takes out `value × quantity ÷ on hand` (all remaining value when the last unit goes). Adjusting up adds at the current average (zero if nothing was on hand).
- A movement that would make stock go negative on any date is refused.
- Lot numbers and expiration dates are recorded on purchases and opening stock only. Per-lot tracking comes later.
- Low-stock alert: on hand is at or below the item's reorder level. No level, no alert.

## Expenses, mileage and receipts
- **Expenses** use a fixed category list for your preparer to confirm. There is deliberately no category for Square processing fees: they are already on each imported payment, so adding them again would count them twice. Inventory purchases are not expenses unless you enter them on the Expenses page; the page shows the month's and year's inventory purchases beside your expenses as a reminder.
- **Estimated profit** = net after processing fees − expenses. It appears only when the period has at least one expense entry; otherwise the dashboard says "no expenses entered". It is before taxes and does not include the mileage deduction.
- **Mileage** is one row per trip (date, miles to a tenth, a fixed purpose, optional odometer readings). No addresses or places are stored. The deduction estimate is miles × the cents-per-mile rate for that trip's tax year, and shows "rate not set" or "not confirmed" until you set and confirm it. Do not also enter actual vehicle costs as expenses if your preparer uses the standard rate.
- **Receipt photos** are JPEGs stored in the app's own database, up to 5 per expense. The browser shrinks each photo and removes location and camera data; the server refuses anything that still carries it. Do not photograph card numbers or patient information.

## Privacy
No patient or customer names, contact details or health information are stored. Do not type them into any field.
