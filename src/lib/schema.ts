/*
 * Database schema (version 12). Every statement is additive and safe to run more than once: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
 * ON CONFLICT only. Nothing here drops or rewrites data. Privacy rule: no column may hold a client or patient's name,
 * contact details, birth date or health information (tests/schema.test.cjs checks the column names).
 */
export const SCHEMA_VERSION = 12;

export const schemaStatements: string[] = [
  `CREATE TABLE IF NOT EXISTS app_meta (
     key        text PRIMARY KEY,
     value      text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // One row per tax year. Every rule is optional (NULL = "not set yet") and has a "confirmed with the tax preparer" flag.
  `CREATE TABLE IF NOT EXISTS tax_year_rules (
     tax_year                    integer PRIMARY KEY CHECK (tax_year BETWEEN 2000 AND 2100),
     mileage_rate_cents          numeric(6,2) CHECK (mileage_rate_cents IS NULL OR (mileage_rate_cents >= 0 AND mileage_rate_cents <= 500)),
     set_aside_percent           numeric(5,2) CHECK (set_aside_percent IS NULL OR (set_aside_percent >= 0 AND set_aside_percent <= 70)),
     threshold_1099k_dollars     integer CHECK (threshold_1099k_dollars IS NULL OR threshold_1099k_dollars >= 0),
     threshold_1099nec_dollars   integer CHECK (threshold_1099nec_dollars IS NULL OR threshold_1099nec_dollars >= 0),
     sales_tax                   text NOT NULL DEFAULT 'unknown' CHECK (sales_tax IN ('unknown', 'not_applicable', 'applicable')),
     mileage_rate_confirmed      boolean NOT NULL DEFAULT false,
     set_aside_confirmed         boolean NOT NULL DEFAULT false,
     threshold_1099k_confirmed   boolean NOT NULL DEFAULT false,
     threshold_1099nec_confirmed boolean NOT NULL DEFAULT false,
     sales_tax_confirmed         boolean NOT NULL DEFAULT false,
     updated_at                  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id     bigserial PRIMARY KEY,
     at     timestamptz NOT NULL DEFAULT now(),
     action text NOT NULL,
     detail jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
  // ---- version 2: income and inventory. Money is whole cents. Inventory is its own ledger and never touches income or expenses. ----
  `CREATE TABLE IF NOT EXISTS import_batches (
     id                  bigserial PRIMARY KEY,
     imported_at         timestamptz NOT NULL DEFAULT now(),
     source              text NOT NULL CHECK (source IN ('square')),
     rows_read           integer NOT NULL CHECK (rows_read >= 0),
     rows_added          integer NOT NULL CHECK (rows_added >= 0),
     rows_duplicate      integer NOT NULL CHECK (rows_duplicate >= 0),
     rows_refund_flagged integer NOT NULL CHECK (rows_refund_flagged >= 0),
     rows_skipped        integer NOT NULL CHECK (rows_skipped >= 0),
     first_date          date,
     last_date           date
   )`,
  // Where the money came from (source) and how the IRS will classify it (tax_form) are separate, independent columns.
  // gross_cents = service revenue only, tip_cents = tips only (never inside gross), fee_cents = processing fee on the whole charge.
  `CREATE TABLE IF NOT EXISTS income_entries (
     id              bigserial PRIMARY KEY,
     occurred_on     date NOT NULL,
     source          text NOT NULL CHECK (source IN ('square', 'bank_transfer', 'check', 'cash', 'other')),
     tax_form        text NOT NULL DEFAULT 'unknown' CHECK (tax_form IN ('unknown', '1099k', '1099nec', 'none')),
     gross_cents     bigint NOT NULL CHECK (gross_cents >= 0 AND gross_cents <= 99999999999),
     tip_cents       bigint NOT NULL DEFAULT 0 CHECK (tip_cents >= 0 AND tip_cents <= 99999999999),
     fee_cents       bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
     visits          integer NOT NULL DEFAULT 0 CHECK (visits BETWEEN 0 AND 1000),
     external_id     text,
     import_batch_id bigint REFERENCES import_batches(id),
     created_at      timestamptz NOT NULL DEFAULT now(),
     CHECK (fee_cents <= gross_cents + tip_cents)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS income_entries_external_uq ON income_entries (source, external_id) WHERE external_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS income_entries_date_idx ON income_entries (occurred_on)`,
  `CREATE TABLE IF NOT EXISTS inventory_items (
     id            bigserial PRIMARY KEY,
     label         text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
     category      text NOT NULL DEFAULT 'General' CHECK (char_length(category) BETWEEN 1 AND 40),
     unit          text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 20),
     reorder_level integer CHECK (reorder_level IS NULL OR reorder_level BETWEEN 0 AND 1000000),
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_label_uq ON inventory_items (lower(label))`,
  // Append-only ledger: quantity on hand is always calculated from these rows, never typed in. Mistakes are fixed with an adjustment.
  `CREATE TABLE IF NOT EXISTS inventory_movements (
     id             bigserial PRIMARY KEY,
     item_id        bigint NOT NULL REFERENCES inventory_items(id),
     moved_on       date NOT NULL,
     kind           text NOT NULL CHECK (kind IN ('opening', 'purchase', 'use', 'adjust_up', 'adjust_down')),
     quantity       integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
     unit_cost_cents integer CHECK (unit_cost_cents IS NULL OR unit_cost_cents BETWEEN 0 AND 100000000),
     reason         text CHECK (reason IS NULL OR reason IN ('count_correction', 'expired', 'damaged', 'lost', 'other')),
     lot_number     text CHECK (lot_number IS NULL OR lot_number ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
     expires_on     date,
     created_at     timestamptz NOT NULL DEFAULT now(),
     CHECK ((kind IN ('opening', 'purchase')) = (unit_cost_cents IS NOT NULL)),
     CHECK ((kind IN ('adjust_up', 'adjust_down')) = (reason IS NOT NULL)),
     CHECK ((lot_number IS NULL AND expires_on IS NULL) OR kind IN ('opening', 'purchase'))
   )`,
  `CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements (item_id, moved_on)`,
  // ---- version 3: expenses, receipt photos, mileage. No addresses or destinations anywhere (a stop could be a patient's home). ----
  `CREATE TABLE IF NOT EXISTS expenses (
     id              bigserial PRIMARY KEY,
     spent_on        date NOT NULL,
     amount_cents    bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 99999999999),
     category        text NOT NULL CHECK (category IN ('supplies', 'insurance', 'licenses_fees', 'equipment', 'software', 'advertising', 'professional_services', 'phone_internet', 'training', 'other')),
     vendor          text CHECK (vendor IS NULL OR char_length(vendor) BETWEEN 1 AND 60),
     receipt_on_file boolean NOT NULL DEFAULT false,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (spent_on)`,
  // Receipt photos live in this database so they share its access rules and backups. JPEG only, metadata stripped, at most 1.5 MB each.
  `CREATE TABLE IF NOT EXISTS expense_receipts (
     id          bigserial PRIMARY KEY,
     expense_id  bigint NOT NULL REFERENCES expenses(id),
     content_type text NOT NULL DEFAULT 'image/jpeg' CHECK (content_type = 'image/jpeg'),
     bytes_len   integer NOT NULL CHECK (bytes_len BETWEEN 1 AND 1500000),
     data        bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1500000),
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS expense_receipts_expense_idx ON expense_receipts (expense_id)`,
  `CREATE TABLE IF NOT EXISTS mileage_trips (
     id             bigserial PRIMARY KEY,
     driven_on      date NOT NULL,
     miles_tenths   integer NOT NULL CHECK (miles_tenths BETWEEN 1 AND 10000),
     purpose        text NOT NULL CHECK (purpose IN ('patient_visits', 'supply_run', 'lab_dropoff', 'admin_errand', 'other')),
     odometer_start integer CHECK (odometer_start IS NULL OR odometer_start BETWEEN 0 AND 9999999),
     odometer_end   integer CHECK (odometer_end IS NULL OR odometer_end BETWEEN 0 AND 9999999),
     created_at     timestamptz NOT NULL DEFAULT now(),
     CHECK ((odometer_start IS NULL) = (odometer_end IS NULL)),
     CHECK (odometer_start IS NULL OR odometer_end >= odometer_start)
   )`,
  `CREATE INDEX IF NOT EXISTS mileage_trips_date_idx ON mileage_trips (driven_on)`,
  // ---- version 4: which lot each use or removal came from, and per-item expiry warning windows. The movement ledger itself is not changed. ----
  `CREATE TABLE IF NOT EXISTS inventory_lot_uses (
     id          bigserial PRIMARY KEY,
     movement_id bigint NOT NULL REFERENCES inventory_movements(id),
     lot_number  text NOT NULL CHECK (lot_number ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
     quantity    integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS inventory_lot_uses_movement_idx ON inventory_lot_uses (movement_id)`,
  `CREATE TABLE IF NOT EXISTS inventory_settings (
     item_id          bigint PRIMARY KEY REFERENCES inventory_items(id),
     expiry_warn_days integer NOT NULL CHECK (expiry_warn_days BETWEEN 0 AND 730),
     updated_at       timestamptz NOT NULL DEFAULT now()
   )`,
  // ---- version 5: payers, the amounts printed on 1099 forms, estimated tax payments, and frozen packet snapshots. No EIN/SSN/contact columns by design. ----
  `CREATE TABLE IF NOT EXISTS payers (
     id         bigserial PRIMARY KEY,
     label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payers_label_uq ON payers (lower(label))`,
  `CREATE TABLE IF NOT EXISTS income_entry_payers (
     income_id bigint PRIMARY KEY REFERENCES income_entries(id),
     payer_id  bigint NOT NULL REFERENCES payers(id)
   )`,
  `CREATE TABLE IF NOT EXISTS form_1099_entries (
     id           bigserial PRIMARY KEY,
     tax_year     integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
     form_type    text NOT NULL CHECK (form_type IN ('1099k', '1099nec')),
     payer_id     bigint REFERENCES payers(id),
     amount_cents bigint NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 99999999999),
     created_at   timestamptz NOT NULL DEFAULT now(),
     CHECK (form_type = '1099k' OR payer_id IS NOT NULL)
   )`,
  `CREATE TABLE IF NOT EXISTS tax_payments (
     id           bigserial PRIMARY KEY,
     tax_year     integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
     paid_on      date NOT NULL,
     amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 99999999999),
     kind         text NOT NULL CHECK (kind IN ('federal_estimated', 'other')),
     created_at   timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS tax_snapshots (
     id         bigserial PRIMARY KEY,
     tax_year   integer NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
     created_at timestamptz NOT NULL DEFAULT now(),
     packet     jsonb NOT NULL
   )`,
  // ---- version 6: an optional second mileage rate for trips from July 1 (the IRS changed the 2026 business rate mid-year). ----
  `ALTER TABLE tax_year_rules ADD COLUMN IF NOT EXISTS mileage_rate_h2_cents numeric(6,2) CHECK (mileage_rate_h2_cents IS NULL OR (mileage_rate_h2_cents >= 0 AND mileage_rate_h2_cents <= 500))`,
  `ALTER TABLE tax_year_rules ADD COLUMN IF NOT EXISTS mileage_rate_h2_confirmed boolean NOT NULL DEFAULT false`,
  // ---- version 7: chart of accounts and journal. Reports are calculated from your income, expenses and inventory records; only manual entries are stored as journal rows. ----
  `CREATE TABLE IF NOT EXISTS accounts (
     id         bigserial PRIMARY KEY,
     number     integer NOT NULL UNIQUE CHECK (number BETWEEN 1000 AND 7999),
     label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
     type       text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'cost_of_services', 'operating_expense', 'other')),
     normal     text NOT NULL CHECK (normal IN ('debit', 'credit')),
     system_key text UNIQUE,
     active     boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // The starting chart is seeded by the app (seedAccounts in accountingDb.ts), once and only while the table is empty.
  `CREATE TABLE IF NOT EXISTS expense_category_accounts (
     id         bigserial PRIMARY KEY,
     category   text NOT NULL UNIQUE,
     account_id bigint NOT NULL REFERENCES accounts(id)
   )`,
  `CREATE TABLE IF NOT EXISTS expense_accounts (
     id         bigserial PRIMARY KEY,
     expense_id bigint NOT NULL UNIQUE,
     account_id bigint NOT NULL REFERENCES accounts(id)
   )`,
  `CREATE TABLE IF NOT EXISTS income_accounts (
     id         bigserial PRIMARY KEY,
     income_id  bigint NOT NULL UNIQUE,
     account_id bigint NOT NULL REFERENCES accounts(id)
   )`,
  `CREATE TABLE IF NOT EXISTS inventory_item_accounts (
     id         bigserial PRIMARY KEY,
     item_id    bigint NOT NULL UNIQUE REFERENCES inventory_items(id),
     account_id bigint NOT NULL REFERENCES accounts(id)
   )`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
     id          bigserial PRIMARY KEY,
     entry_date  date NOT NULL,
     kind        text NOT NULL CHECK (kind IN ('owner_contribution', 'owner_draw', 'transfer', 'opening_balance', 'manual', 'adjusting', 'reversal')),
     description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 120),
     reverses_id bigint REFERENCES journal_entries(id),
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_one_reversal ON journal_entries (reverses_id) WHERE reverses_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS journal_lines (
     id           bigserial PRIMARY KEY,
     entry_id     bigint NOT NULL REFERENCES journal_entries(id),
     account_id   bigint NOT NULL REFERENCES accounts(id),
     debit_cents  bigint NOT NULL DEFAULT 0 CHECK (debit_cents >= 0 AND debit_cents <= 99999999999),
     credit_cents bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0 AND credit_cents <= 99999999999),
     CHECK ((debit_cents > 0) <> (credit_cents > 0))
   )`,
  // ---- version 8: stops typed while driving, kept only until the end of the next day so the miles can be worked out. Never exported or backed up. ----
  `CREATE TABLE IF NOT EXISTS mileage_pending (
     id         bigserial PRIMARY KEY,
     driven_on  date NOT NULL,
     start_text text NOT NULL CHECK (char_length(start_text) BETWEEN 1 AND 120),
     end_text   text NOT NULL CHECK (char_length(end_text) BETWEEN 1 AND 120),
     purpose    text NOT NULL CHECK (purpose IN ('patient_visits', 'supply_run', 'lab_dropoff', 'admin_errand', 'other')),
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL
   )`,
  // ---- version 9: Secretary (appointments). Only NEW tables; nothing existing is touched and no money or inventory column exists here.
  // PRIVACY: no name, phone, address, birth date, medical or free-text column, by design: only fixed choices, numbers and times. Times are real instants (timestamptz),
  // shown in America/Chicago. The exclusion constraint makes a double booking impossible at the database level (canceled appointments do not block).
  // For the future booking website: `source` + `external_ref` give an idempotency key (the same booking can never be created twice), and appointment_services is the list of services it can offer. ----
  `CREATE TABLE IF NOT EXISTS appointment_services (
     code            text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
     label           text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
     default_minutes integer NOT NULL DEFAULT 30 CHECK (default_minutes BETWEEN 5 AND 720),
     sort_order      integer NOT NULL DEFAULT 100,
     active          boolean NOT NULL DEFAULT true,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `INSERT INTO appointment_services (code, label, default_minutes, sort_order) VALUES
     ('blood_draw', 'Blood draw', 30, 10), ('specimen_collection', 'Specimen collection', 30, 20), ('specimen_delivery', 'Specimen pickup or delivery', 30, 30),
     ('consultation', 'Consultation', 30, 40), ('other_service', 'Other service', 30, 90)
   ON CONFLICT (code) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS appointments (
     id            bigserial PRIMARY KEY,
     type          text NOT NULL CHECK (type IN ('office', 'mobile')),
     status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'completed', 'canceled')),
     service_code  text NOT NULL REFERENCES appointment_services(code),
     starts_at     timestamptz NOT NULL,
     ends_at       timestamptz NOT NULL,
     time_zone     text NOT NULL DEFAULT 'America/Chicago' CHECK (time_zone = 'America/Chicago'),
     cancel_reason text CHECK (cancel_reason IS NULL OR cancel_reason IN ('requested', 'no_show', 'rescheduled', 'unavailable', 'other')),
     canceled_at   timestamptz,
     source        text NOT NULL DEFAULT 'internal' CHECK (source IN ('internal', 'website')),
     external_ref  text CHECK (external_ref IS NULL OR external_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now(),
     CHECK (ends_at > starts_at AND extract(epoch FROM (ends_at - starts_at)) <= 43200),
     CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
     CHECK (cancel_reason IS NULL OR status = 'canceled'),
     EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&) WHERE (status <> 'canceled')
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS appointments_external_ref_idx ON appointments (source, external_ref) WHERE external_ref IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS appointments_starts_idx ON appointments (starts_at)`,
  // ---- version 10: the offered services become exactly four. Only appointment_services rows are touched, never appointments: the four are inserted (or brought up to date,
  // so "blood_draw" becomes "Blood Draw") and the services that used to be offered are DEACTIVATED, not deleted, because existing appointments may still refer to them.
  // Safe to repeat. Runs after the version 9 seed above, so it works whether the database was on version 8 or 9. ----
  `INSERT INTO appointment_services (code, label, default_minutes, sort_order, active) VALUES
     ('blood_draw', 'Blood Draw', 30, 10, true), ('gender_reveal_testing', 'Gender Reveal Testing', 30, 20, true),
     ('therapeutic_draw', 'Therapeutic Draw', 30, 30, true), ('travel_lab', 'Travel Lab', 30, 40, true)
   ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, default_minutes = EXCLUDED.default_minutes, sort_order = EXCLUDED.sort_order, active = true`,
  `UPDATE appointment_services SET active = false WHERE code IN ('specimen_collection', 'specimen_delivery', 'consultation', 'other_service') AND active`,
  // ---- version 11: appointment money and supplies. Two new columns on appointments (a price, and when it was completed) and three new tables. Nothing existing is rewritten.
  // A payment is ONE row here plus ONE existing income_entries row (the table Income already uses), so income, the ledger and tax summaries count it once. Square / Card
  // payments create no income themselves: they wait for the Square import and are linked by exact Square payment ID or an explicit choice. Receivables are not stored:
  // they are price minus payments for completed appointments. Supplies are ordinary inventory "use" movements linked to the appointment. No personal details, no free text. ----
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS price_cents bigint CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 99999999999))`,
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS appointment_payments (
     id               bigserial PRIMARY KEY,
     appointment_id   bigint NOT NULL REFERENCES appointments(id),
     amount_cents     bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 99999999999),
     method           text NOT NULL CHECK (method IN ('cash', 'check', 'bank_transfer', 'square', 'other')),
     paid_on          date NOT NULL,
     income_entry_id  bigint REFERENCES income_entries(id),
     reconcile_state  text NOT NULL DEFAULT 'none' CHECK (reconcile_state IN ('none', 'awaiting_square', 'matched')),
     square_payment_id text CHECK (square_payment_id IS NULL OR square_payment_id ~ '^(t:)?[A-Za-z0-9_-]{1,64}$'),
     request_key      text NOT NULL UNIQUE CHECK (request_key ~ '^[A-Za-z0-9_-]{8,64}$'),
     created_at       timestamptz NOT NULL DEFAULT now(),
     CHECK ((method = 'square') = (reconcile_state <> 'none')),
     CHECK ((reconcile_state = 'awaiting_square') = (income_entry_id IS NULL)),
     CHECK (square_payment_id IS NULL OR method = 'square')
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS appointment_payments_income_uq ON appointment_payments (income_entry_id) WHERE income_entry_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS appointment_payments_square_uq ON appointment_payments (square_payment_id) WHERE square_payment_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS appointment_payments_appt_idx ON appointment_payments (appointment_id)`,
  `CREATE TABLE IF NOT EXISTS appointment_supply_uses (
     id             bigserial PRIMARY KEY,
     appointment_id bigint NOT NULL REFERENCES appointments(id),
     movement_id    bigint NOT NULL UNIQUE REFERENCES inventory_movements(id),
     created_at     timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS appointment_supply_uses_appt_idx ON appointment_supply_uses (appointment_id)`,
  // Records one payment. Runs inside the caller's transaction, repeats of the same request_key return the first result, and an overpayment, a canceled appointment or a
  // Square payment that is already linked is refused with a coded message (OMOF:...). Square / Card never inserts income here.
  `CREATE OR REPLACE FUNCTION app_record_payment(p_appt bigint, p_amount bigint, p_method text, p_paid_on date, p_square text, p_key text) RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE
  v_status text; v_price bigint; v_paid bigint; v_income bigint; v_state text := 'none'; v_pay bigint; v_prev bigint; v_prev_appt bigint; e income_entries%ROWTYPE;
BEGIN
  SELECT id, appointment_id INTO v_prev, v_prev_appt FROM appointment_payments WHERE request_key = p_key;
  IF v_prev IS NOT NULL THEN
    IF v_prev_appt <> p_appt THEN RAISE EXCEPTION 'OMOF:KEY_REUSED'; END IF;
    RETURN v_prev;
  END IF;
  SELECT status, price_cents INTO v_status, v_price FROM appointments WHERE id = p_appt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OMOF:NOT_FOUND'; END IF;
  IF v_status = 'canceled' THEN RAISE EXCEPTION 'OMOF:CANCELED'; END IF;
  IF v_price IS NULL THEN RAISE EXCEPTION 'OMOF:NO_PRICE'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'OMOF:BAD_AMOUNT'; END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO v_paid FROM appointment_payments WHERE appointment_id = p_appt;
  IF v_paid + p_amount > v_price THEN RAISE EXCEPTION 'OMOF:OVERPAYMENT'; END IF;
  IF p_method = 'square' THEN
    v_state := 'awaiting_square';
    IF p_square IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM appointment_payments WHERE square_payment_id = p_square) THEN RAISE EXCEPTION 'OMOF:SQUARE_ID_USED'; END IF;
      SELECT * INTO e FROM income_entries WHERE source = 'square' AND external_id = p_square;
      IF FOUND THEN
        IF EXISTS (SELECT 1 FROM appointment_payments WHERE income_entry_id = e.id) THEN RAISE EXCEPTION 'OMOF:SQUARE_LINKED'; END IF;
        IF e.gross_cents <> p_amount THEN RAISE EXCEPTION 'OMOF:SQUARE_MISMATCH'; END IF;
        v_income := e.id; v_state := 'matched';
      END IF;
    END IF;
  ELSE
    INSERT INTO income_entries (occurred_on, source, tax_form, gross_cents) VALUES (p_paid_on, p_method, 'unknown', p_amount) RETURNING id INTO v_income;
  END IF;
  INSERT INTO appointment_payments (appointment_id, amount_cents, method, paid_on, income_entry_id, reconcile_state, square_payment_id, request_key)
  VALUES (p_appt, p_amount, p_method, p_paid_on, v_income, v_state, p_square, p_key) RETURNING id INTO v_pay;
  RETURN v_pay;
END
$fn$`,
  // A payment on its own (an advance on an open appointment, or a payment against a receivable).
  `CREATE OR REPLACE FUNCTION record_appointment_payment(p jsonb) RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE v_id bigint := (p->>'appointment_id')::bigint;
BEGIN
  PERFORM 1 FROM appointments WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OMOF:NOT_FOUND'; END IF;
  RETURN app_record_payment(v_id, (p->>'amount_cents')::bigint, p->>'method', (p->>'paid_on')::date, p->>'square_payment_id', p->>'request_key');
END
$fn$`,
  // The whole completion in ONE transaction: lock the appointment (a second click waits, then finds it completed), set the price, record the payment, take the supplies out of
  // stock (item rows locked, a stale-stock check, and a final never-negative check), then mark it completed. Any problem raises and NOTHING is saved.
  `CREATE OR REPLACE FUNCTION complete_appointment(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_id bigint := (p->>'appointment_id')::bigint;
  v_status text; v_price bigint; v_start timestamptz; v_paid bigint; v_pay bigint; v_mov bigint; v_item bigint;
  s jsonb; v_n bigint; v_max bigint; v_lu bigint; v_on_hand bigint; v_moves jsonb := '[]'::jsonb;
BEGIN
  SELECT status, price_cents, starts_at INTO v_status, v_price, v_start FROM appointments WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OMOF:NOT_FOUND'; END IF;
  IF v_status = 'completed' THEN RAISE EXCEPTION 'OMOF:ALREADY_COMPLETED'; END IF;
  IF v_status NOT IN ('scheduled', 'confirmed') THEN RAISE EXCEPTION 'OMOF:NOT_OPEN'; END IF;
  IF v_start > now() THEN RAISE EXCEPTION 'OMOF:NOT_STARTED'; END IF;
  IF (p->>'price_cents') IS NOT NULL THEN v_price := (p->>'price_cents')::bigint; END IF;
  IF v_price IS NULL THEN RAISE EXCEPTION 'OMOF:NO_PRICE'; END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO v_paid FROM appointment_payments WHERE appointment_id = v_id;
  IF v_price < v_paid THEN RAISE EXCEPTION 'OMOF:PRICE_BELOW_PAID'; END IF;
  UPDATE appointments SET price_cents = v_price WHERE id = v_id;
  IF jsonb_typeof(p->'payment') = 'object' THEN
    v_pay := app_record_payment(v_id, (p->'payment'->>'amount_cents')::bigint, p->'payment'->>'method', (p->'payment'->>'paid_on')::date, p->'payment'->>'square_payment_id', p->'payment'->>'request_key');
  END IF;
  PERFORM 1 FROM inventory_items WHERE id IN (SELECT (x->>'item_id')::bigint FROM jsonb_array_elements(coalesce(p->'supplies', '[]'::jsonb)) AS x) ORDER BY id FOR UPDATE;
  FOR s IN SELECT x FROM jsonb_array_elements(coalesce(p->'supplies', '[]'::jsonb)) AS x LOOP
    v_item := (s->>'item_id')::bigint;
    SELECT count(*), coalesce(max(id), 0) INTO v_n, v_max FROM inventory_movements WHERE item_id = v_item;
    SELECT count(*) INTO v_lu FROM inventory_lot_uses u JOIN inventory_movements m ON m.id = u.movement_id WHERE m.item_id = v_item;
    IF v_n <> (s->'expect'->>'movements')::bigint OR v_max <> (s->'expect'->>'max_id')::bigint OR v_lu <> (s->'expect'->>'lot_uses')::bigint THEN RAISE EXCEPTION 'OMOF:STALE_INVENTORY'; END IF;
    INSERT INTO inventory_movements (item_id, moved_on, kind, quantity) VALUES (v_item, (s->>'moved_on')::date, 'use', (s->>'quantity')::int) RETURNING id INTO v_mov;
    INSERT INTO inventory_lot_uses (movement_id, lot_number, quantity) SELECT v_mov, a->>'lot_number', (a->>'quantity')::int FROM jsonb_array_elements(coalesce(s->'allocations', '[]'::jsonb)) AS a;
    INSERT INTO appointment_supply_uses (appointment_id, movement_id) VALUES (v_id, v_mov);
    SELECT coalesce(sum(CASE WHEN kind IN ('opening', 'purchase', 'adjust_up') THEN quantity ELSE -quantity END), 0) INTO v_on_hand FROM inventory_movements WHERE item_id = v_item;
    IF v_on_hand < 0 THEN RAISE EXCEPTION 'OMOF:NEGATIVE_STOCK'; END IF;
    v_moves := v_moves || jsonb_build_object('item_id', v_item, 'movement_id', v_mov, 'on_hand', v_on_hand);
  END LOOP;
  UPDATE appointments SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('appointment_id', v_id, 'payment_id', v_pay, 'movements', v_moves);
END
$fn$`,
  // ---- version 12: spreadsheet expense imports. One optional column: the row's import key (date | cents | occurrence), so importing the same file twice adds nothing. Hand-entered expenses keep NULL. ----
  `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS import_key text CHECK (import_key IS NULL OR char_length(import_key) BETWEEN 1 AND 40)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS expenses_import_key_uq ON expenses (import_key) WHERE import_key IS NOT NULL`,
  `INSERT INTO app_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE app_meta.value::int < EXCLUDED.value::int`,
];

/** Tables included in the full export, in order. */
export const EXPORT_TABLES = ["app_meta", "tax_year_rules", "audit_log", "import_batches", "income_entries", "inventory_items", "inventory_movements", "expenses", "expense_receipts", "mileage_trips", "appointment_services", "appointments", "appointment_payments", "appointment_supply_uses", "inventory_lot_uses", "inventory_settings", "payers", "income_entry_payers", "form_1099_entries", "tax_payments", "tax_snapshots", "accounts", "expense_category_accounts", "expense_accounts", "income_accounts", "inventory_item_accounts", "journal_entries", "journal_lines"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Column each exported table is sorted by (every other table has an id column). */
export const EXPORT_ORDER: Record<string, string> = { app_meta: "key", tax_year_rules: "tax_year", inventory_settings: "item_id", income_entry_payers: "income_id", expense_category_accounts: "category", appointment_services: "code" };
