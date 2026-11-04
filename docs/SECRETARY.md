# Secretary: appointments (Phase 1A)

Internal scheduling for the office and mobile visits. Found under **More → Secretary**; today's appointments also show on the Overview page. Everything is behind the normal sign-in (`requireOwner()`), so it works for every approved user, and the calendar is never public.

## What it does
- **Day and week views** (week = Monday to Sunday), with previous/next, a date jump and a "Today" button. On a phone the week is a single column.
- **Add, edit and cancel** appointments. Each has a start date and time, a **type** (Office or Mobile) and a **service** chosen from four: Blood Draw, Gender Reveal Testing, Therapeutic Draw, Travel Lab. There is no length to pick or see: every appointment holds a 30-minute window internally, which is what the overlap checks use. Editing an appointment never changes its existing window.
- **Statuses:** Scheduled, Confirmed, Completed, Canceled. Completed is final and allowed only once the appointment has started. Canceled needs a fixed reason (requested by the customer, no-show, moved to another time, we were unavailable, other) and can be reinstated (the overlap check runs again). Appointments are never deleted.
- **No double booking:** an appointment that shares any time with an open one is refused with a message naming the one in the way. Back-to-back is fine (one ends exactly when the next starts). Canceled appointments do not block time. The same rule is enforced **inside the database** (an exclusion constraint), so two people saving at the same moment still cannot double book.
- **Time zone:** everything is shown in America/Chicago. Appointments are stored as real instants (UTC), so a 60-minute visit is 60 real minutes even across a clock change. When clocks spring forward the skipped hour (2:00 to 3:00 AM) cannot be chosen; when they fall back, a time in the repeated hour (1:00 to 2:00 AM) is taken as its first occurrence, and every screen shows CST or CDT. The day view says when a day is 23 or 25 hours long.

## Privacy (read this)
An appointment holds **no** names, phone numbers, addresses, birth dates or medical details, and there is **no free-text field** anywhere in it. It is identified as "Appointment #12" and described only by fixed choices (type, service, status, cancel reason), and a date/time. Do not try to work around this by putting details in the service list or elsewhere. A test checks the table's columns and the forms.

## Money and supplies are untouched
Completing an appointment records **no revenue** and changes **no inventory**. The scheduling code does not read or write income, expenses, the ledger, tax or supply tables, and none of those read appointments. Enter income and supply use on their own pages as before.

## Database (version 9 added the tables; version 10 updated the service list)
- `appointment_services`: the service list (code, label, default length, order, active). Version 10 makes the offered services exactly Blood Draw, Gender Reveal Testing, Therapeutic Draw and Travel Lab (inserted or updated), and **deactivates** the earlier ones (Specimen collection, Specimen pickup or delivery, Consultation, Other service) instead of deleting them, so existing appointments keep their service and still display it; an appointment keeps its service when edited. There is no screen to edit the list yet.
- `appointments`: type, status, service, `starts_at`/`ends_at` (timestamptz), time zone (fixed to America/Chicago), cancel reason, `canceled_at`, `source` and `external_ref`.
- Both tables are in the full export (JSON, and per-table CSV), in `npm run backup`, and in the restore order (services before appointments). The restore check compares row counts like every other table. Nothing existing is altered.
- After deploying, press **Update** on the Overview page once (it applies every step still missing, so it is right whether the database is on version 8 or 9). Repeating it is harmless.

## For the future booking website (not built yet)
The booking site should create appointments by calling the same server-side functions (so the same validation and the same database overlap guard apply), never by writing to the table directly from the browser. `source = 'website'` plus `external_ref` (a machine reference, letters/digits/`_`/`-`, up to 64) is unique per source, so a retried submission cannot create the same booking twice. The site can list offered services from `appointment_services` (where `active`), and "is this time free?" is "no open appointment overlaps this span". Customer details must not be stored here; if the site ever needs them, that is a separate, deliberately designed table with its own review.

## Not in Phase 1A
Travel-time buffers, multiple providers or rooms, reminders and notifications, recurring appointments, editing the service list, and any customer-facing page.

## Phase 2: price, payments, receivables and supplies (database version 11)

One appointment, one completion workflow. Everything below reuses existing systems: payments are rows in **Income**, supplies are **Inventory** "use" movements, and nothing is added to the ledger.

### Price and expected revenue
- Each appointment has a **service price** (in cents). Empty = not decided; **0 = an explicit no-charge service**. Older appointments have no price until you record one.
- The price can be changed while the appointment is open (never below what has already been received). A completed appointment's price is final.
- A scheduled or confirmed appointment's unpaid price is **expected revenue**. It is shown on the day and week views and the Overview. It is **not income** and **not a receivable**. Canceling removes it.

### Completing an appointment (one screen)
Open an appointment → **Mark completed**. One form holds the service and price, the payment, and the supplies used. **Complete appointment** saves everything in a single database transaction, or nothing: if one part fails (for example not enough stock) the appointment stays open and no payment, income or stock change is saved. A second tap, a second tab or a double click cannot repeat anything: the appointment is locked while it saves and a repeat finds it already completed.
- **Paid in full:** the payment goes into Income (once) → *Completed / Paid*.
- **Part paid:** the amount received goes into Income; the rest becomes a receivable → *Completed / Partially Paid*.
- **Unpaid** (empty or 0): no income; the whole price becomes a receivable → *Completed / Unpaid*.
- **Advance payments** (recorded on an open appointment with **Record an advance payment**) are income on the day received and are never recorded again at completion; only the remainder is paid or owed.
- **Canceled** before completion: no income, no receivable, cancellation history kept. A payment already received is **never reversed automatically**. Refunds and corrections must be entered deliberately (there is no automatic refund).
- A completed appointment is final. Supply quantities are corrected with an inventory adjustment on the Inventory page (kept in the audit trail).

### Accounts Receivable (More → Receivables)
Lists completed appointments with their balance: appointment number, service, service date, original price, amount paid, balance and status. Record payments against a balance there or on the appointment page. The full payment history stays on the appointment. The receivable is calculated (price minus payments), never stored, so it cannot drift, and it never touches cash-basis income, the Profit & Loss or tax figures. (The chart of accounts still has its own "Accounts receivable" name; the cash-basis books do not post to it.)

### Payment methods and Square
Cash, Check, Bank transfer, Square / Card, Other, with the actual date received. Cash, check, bank transfer and other create exactly one Income entry per payment. **Square / Card never creates income itself**: your Square import is the single record of card income (with its real fees), so a card payment is recorded as *awaiting Square import*, still counts toward the appointment balance, and is linked to the imported entry:
- automatically after an import, when you typed the **Square payment ID** and it matches the imported entry's ID exactly (and the revenue amount equals the payment), or at once if that entry was already imported; or
- by your explicit choice on Accounts Receivable, from imported Square entries with exactly the same revenue amount.
Matching is never done by amount and date alone. A Square entry can back only one appointment payment, and one Square ID can be used on only one payment. Anything that cannot be linked stays flagged on Accounts Receivable. The Square import itself, its fees and its duplicate checks are unchanged.

### Supplies
The completion form lists your Inventory items with what is on hand; enter only what you used (all optional, different quantities per item). Each becomes a normal inventory **use** movement dated the service date, linked to the appointment number, taken earliest-expiring lot first. Stock can never go negative; the item rows are locked while saving and re-checked, so two appointments racing for the last units cannot both succeed. Inventory valuation and cost-of-supplies accounting come from those movements exactly as before: no expense is created. Canceling never returns or consumes stock.

### Reorder warnings
The existing reorder level is the only rule: an item at or below its level shows **Reorder needed** on the Overview, the Inventory page and the completion screen, and the appointment page lists the items your completion just pushed to or below their level.

### Tables, backups and safety
New tables `appointment_payments` and `appointment_supply_uses`, plus two columns on `appointments` (`price_cents`, `completed_at`), are in the export, `npm run backup` and the restore order (restore also upserts the seeded service list). Income created from an appointment payment cannot be deleted from the Income page. Nothing here stores a name, phone, address, date of birth or medical detail; the only typed value is an optional Square payment ID.
