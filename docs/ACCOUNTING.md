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
- **Mileage** is one row per trip (date, miles to a tenth, a fixed purpose, optional odometer readings). Saved trips keep no addresses or places. The one exception is **Quick start and end**: stops typed in a rush are kept in a separate table (`mileage_pending`) until the end of the next day, then erased (every Mileage and Home page load erases expired ones, and none are ever shown after they expire); saving the miles erases them at once, and "Erase now" does it on demand. They are never in the export or backup files and never in the Activity log. Neon's own point-in-time history can still hold a deleted row for the length of your restore window. The miles are typed by you; the app does not look up distances. The deduction estimate is miles × the cents-per-mile rate for that trip's tax year, and shows "rate not set" or "not confirmed" until you set and confirm it. Do not also enter actual vehicle costs as expenses if your preparer uses the standard rate.
- **Receipt photos** are JPEGs stored in the app's own database, up to 5 per expense. The browser shrinks each photo and removes location and camera data; the server refuses anything that still carries it. Do not photograph card numbers or patient information.

## Taxes (Phase 4)
- **Payers** are business names only (the lab, a company). No tax IDs, no personal details. An income entry can name its payer; **source** (how it was paid) and **tax form** (how it will be reported) stay separate choices.
- **1099 forms:** you enter the amount printed on each 1099-K or 1099-NEC. The app compares it with its receipts for that form and payer (revenue + tips, before fees). A 1099-K counts gross payments including tips and before fees; the app leaves flagged Square refunds out. Differences are shown, never adjusted.
- **Thresholds** show progress only once the threshold is set and confirmed in the tax-year rules.
- **Set-aside** = the confirmed set-aside percent × estimated profit (before the mileage deduction, so it leans high). It is blank until the percent is set and confirmed and the year has an expense entry. **Tax payments** you made are recorded and compared with it. The app calculates no income tax, self-employment tax or sales tax and sends no reminders; due dates and amounts come from your preparer.
- **Packet and readiness list:** the Taxes page lists what still needs attention (unconfirmed rules, entries with no tax form, expenses without receipts, expired inventory, flagged refunds, form mismatches) and offers one CSV per section. **Snapshots** freeze the packet so later edits don't change what you sent.
- **Set the tax form on imports:** fills in "not decided" Square entries of one year after a preview and confirmation; it never overwrites a choice you made.

## Accounting area (Phase 6): chart of accounts, ledger and statements

Everything lives under **Accounting** (Dashboard, Transactions, Chart of Accounts, General Ledger, Inventory & Cost of Services, Financial Reports, Accounting Tools). It is **cash basis only**: income counts when received, expenses when paid. Accrual reporting is not offered.

**How it works.** Your own records stay the single source of truth. The ledger is calculated from them every time a page opens, as balanced journal entries, so nothing is copied and nothing can drift or be counted twice. Only manual entries are stored (`journal_entries`, `journal_lines`).

| Record | Posts as |
|---|---|
| Income (Square or manual) | Dr Square balance (or Cash) for revenue + tip - fee; Dr Payment processing fees (fee, once); Cr Service revenue; Cr Tips received (7010, other income, never inside revenue) |
| Expense | Dr the account for its category (or the account you pick on that entry); Cr Cash and bank |
| Supply purchase / opening stock | Dr Inventory (asset); Cr Cash / Opening balance equity. Not an expense |
| Supplies used | Dr Medical supplies consumed (or the item's cost account); Cr Inventory, at weighted-average cost. Cost of services |
| Count adjustments, expired stock | Inventory vs Inventory write-offs (5060) |
| Estimated tax payment | Dr Owner draws; Cr Cash. Personal, not a business expense |
| Owner contribution / draw, Square payout | Manual entries on the Transactions page (equity and transfers, never income or expense) |

Not posted: mileage (a tax-deduction estimate, not money spent) and refunds flagged at Square import (not saved as income).

**Chart of accounts.** Conventional numbering (1000 assets, 2000 liabilities, 3000 equity, 4000 revenue, 5000 cost of services, 6000 operating expenses, 7000 other). Add, rename, renumber or deactivate accounts; never delete. Accounts used by automatic postings can be renamed but not deactivated or moved to another type. An account with history cannot change type. Seeded once when the table is empty.

**Journal entries.** Must have at least two lines, each on one side only, in whole cents, with debits equal to credits. Enforced in the app and again in the database statement that saves them, so an unbalanced or half-saved entry cannot exist. Entries are never edited or deleted: correct one by posting a reversal (each can be reversed once). Every change is also written to the Activity log.

**Reports.** Income Statement (with previous period, year to date, variance $ and %), Cost of Services, General Ledger, Trial Balance, Expense Detail, Revenue by Service, Monthly Profitability Comparison and Monthly Financial Overview. Month, quarter, year or custom range. Amounts link to the transactions behind them. Print, PDF and Excel use the same report definition as the screen. **Balance Sheet and Cash Flow are intentionally not produced**: they need opening bank and Square balances and payout records, and are listed as not available yet instead of showing guessed numbers.

**Integrity checks** (Accounting Tools) re-run on all history: every entry balances, no duplicate entries, revenue, tips, fees and expenses in the ledger equal the source records, and the Inventory account equals the inventory report. Warnings flag an expense that looks like a supply purchase already recorded in Supplies, or one that mentions Square fees.

## Reliability and limits (Phase 5)
- Whole-year totals are always computed from every row of the year; if a view ever had more than 50,000 rows it stops with an error instead of showing totals that are silently incomplete.
- Lists on the Income, Expenses and Mileage pages draw 100 rows at a time ("Show more"); the totals above them still cover everything.
- Web downloads over about 3.5 MB are refused with a message, because Vercel limits one response to about 4.5 MB. Use `npm run backup` for a complete backup.
- Buttons that save something turn themselves off while saving, so a double tap cannot enter it twice.
- **Activity** lists what changed and when, and sign-ins allowed or refused.

## Privacy
No patient or customer names, contact details or health information are stored. Do not type them into any field.

## Published tax-year figures (2026)

- **Tax rules** (Settings) can fill in the figures the IRS and Congress published for a year, using "Fill in the empty fields". For 2026: business mileage 72.5 cents (miles driven January 1 to June 30) and 76 cents (July 1 to December 31, raised mid-year), 1099-K processor threshold $20,000 and more than 200 transactions, 1099-NEC threshold $2,000 (payments made after December 31, 2025).
- It only fills **empty** fields, never changes a value you entered, and leaves every "confirmed with my tax preparer" box unchecked. The set-aside percent is not published; your preparer sets it.
- **Mileage rate from July 1** is optional. When set, trips dated July 1 or later use it and earlier trips use the year's rate; the packet export shows both rates. Leave it empty for years with one rate.
- These figures came from search results (IRS newsroom and tax-industry summaries), not from reading IRS.gov directly. Check them against irs.gov or with your preparer.
