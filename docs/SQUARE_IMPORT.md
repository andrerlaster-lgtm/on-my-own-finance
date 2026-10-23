# Square CSV import

**Status: built on provisional headers.** Replace them with the real export's headers when available (see "Updating the format").

## Use
Income → Import Square CSV → choose the Transactions export → **Preview** (nothing is saved) → **Import**.

## Rules
- Columns are matched by header name, not position. Only the fields in `src/lib/squareFormat.ts` are read; every other column is skipped, and the file itself is never stored.
- Counted as income: rows whose status is complete and whose amounts add up.
- Flagged and **not** counted: refunds (refund event or status, a partial-refund amount, a refund reason, or a negative total), failed or declined payments, and unclear rows (unknown status or event, sales tax present, missing payment ID, unreadable date or amount, fee larger than the payment, or Net Total not equal to Total Collected minus fees). The preview lists these by row number and a fixed reason only.
- A partly refunded sale is flagged as a refund and not counted; enter it by hand if it should count.
- Amounts: tip = Tip; revenue = Total Collected − Tip − Tax; fee = |Fees|. Revenue + tip = Total Collected, so nothing is counted twice. Each imported payment is one visit.
- Imported rows are saved with tax form "not decided" and source "Square"; which 1099 applies is the preparer's call.
- **Duplicates:** each payment is keyed by (source, Payment ID), or `t:` + Transaction ID if there is no Payment ID. The database refuses a second copy, so re-importing the same file or an overlapping date range adds nothing. The preview shows how many were already imported.
- Limits: 2 MB file, 5,000 payments per import. Export a shorter date range if needed.
- The home page shows the last import's refund-row count (refunds are never subtracted from revenue).

## Updating the format
Edit only `src/lib/squareFormat.ts`: the accepted header names per field, the completed-status words, and the refund/failed word lists. Then run the tests; they use synthetic data.
