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
