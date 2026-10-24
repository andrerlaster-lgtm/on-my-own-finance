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
- **Lots:** a lot is an item plus a lot number, created by purchases or opening stock that carry one. A lot number can have only one expiry date. Lot on hand = received − used, where each use or removal can be assigned to one or more lots. Uses default to the earliest-expiring lot first (you can enter amounts instead). Lots only say which units were used; cost still uses the weighted average for the whole item.
- **Past uses** that were never assigned to a lot are flagged; one button assigns them earliest-expiring first (it only adds rows).
- **Expiry alerts:** 30 days ahead by default, or a per-item number of days. Expired lots with stock stay flagged until written off.
- **Write-off:** removes the expired units at the average cost with the reason "expired". It is not recorded as an expense; the value appears in the year-end report for your preparer.
- **Lot lookup** shows when a lot arrived, its expiry, and when and how much was used. Uses are not linked to visits or people, so a lot cannot be traced to a patient.
- **Year-end report** (page and CSV): stock and value on Jan 1 and Dec 31, and purchases, uses, expired write-offs and adjustments in between, each valued at the average cost at the time.
- Low-stock alert: on hand is at or below the item's reorder level. No level, no alert.

## Expenses, mileage and receipts
- **Expenses** use a fixed category list for your preparer to confirm. There is deliberately no category for Square processing fees: they are already on each imported payment, so adding them again would count them twice. Inventory purchases are not expenses unless you enter them on the Expenses page; the page shows the month's and year's inventory purchases beside your expenses as a reminder.
- **Estimated profit** = net after processing fees − expenses. It appears only when the period has at least one expense entry; otherwise the dashboard says "no expenses entered". It is before taxes and does not include the mileage deduction.
- **Mileage** is one row per trip (date, miles to a tenth, a fixed purpose, optional odometer readings). No addresses or places are stored. The deduction estimate is miles × the cents-per-mile rate for that trip's tax year, and shows "rate not set" or "not confirmed" until you set and confirm it. Do not also enter actual vehicle costs as expenses if your preparer uses the standard rate.
- **Receipt photos** are JPEGs stored in the app's own database, up to 5 per expense. The browser shrinks each photo and removes location and camera data; the server refuses anything that still carries it. Do not photograph card numbers or patient information.

## Taxes (Phase 4)
- **Payers** are business names only (the lab, a company). No tax IDs, no personal details. An income entry can name its payer; **source** (how it was paid) and **tax form** (how it will be reported) stay separate choices.
- **1099 forms:** you enter the amount printed on each 1099-K or 1099-NEC. The app compares it with its receipts for that form and payer (revenue + tips, before fees). A 1099-K counts gross payments including tips and before fees; the app leaves flagged Square refunds out. Differences are shown, never adjusted.
- **Thresholds** show progress only once the threshold is set and confirmed in the tax-year rules.
- **Set-aside** = the confirmed set-aside percent × estimated profit (before the mileage deduction, so it leans high). It is blank until the percent is set and confirmed and the year has an expense entry. **Tax payments** you made are recorded and compared with it. The app calculates no income tax, self-employment tax or sales tax and sends no reminders; due dates and amounts come from your preparer.
- **Packet and readiness list:** the Taxes page lists what still needs attention (unconfirmed rules, entries with no tax form, expenses without receipts, expired inventory, flagged refunds, form mismatches) and offers one CSV per section. **Snapshots** freeze the packet so later edits don't change what you sent.
- **Set the tax form on imports:** fills in "not decided" Square entries of one year after a preview and confirmation; it never overwrites a choice you made.

## Privacy
No patient or customer names, contact details or health information are stored. Do not type them into any field.
