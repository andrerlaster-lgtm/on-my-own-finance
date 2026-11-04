/*
 * Database schema (version 10). Every statement is additive and safe to run more than once: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
 * ON CONFLICT only. Nothing here drops or rewrites data. Privacy rule: no column may hold a client or patient's name,
 * contact details, birth date or health information (tests/schema.test.cjs checks the column names).
 */
export const SCHEMA_VERSION = 10;

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
     category        text NOT NULL CHECK (category IN ('supplies', 'insurance', 'licenses_fees', 'equipment', 'software', 'advertising', 'professional_services', 'phone_internet', 'training', 'vehicle_fuel', 'other')),
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
  // ---- version 9: a "Vehicle expenses" category (id vehicle_fuel). The ONE exception to "additive only": the expenses.category CHECK list must be widened,
  // so it is replaced in a single atomic ALTER (no rows are read, changed or removed; every existing category stays allowed). The account is added only to a chart that already exists. ----
  `ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check, ADD CONSTRAINT expenses_category_check CHECK (category IN ('supplies', 'insurance', 'licenses_fees', 'equipment', 'software', 'advertising', 'professional_services', 'phone_internet', 'training', 'vehicle_fuel', 'other'))`,
  `INSERT INTO accounts (number, label, type, normal, system_key)
   SELECT 6110, 'Vehicle expenses', 'operating_expense', 'debit', 'cat:vehicle_fuel'
   WHERE EXISTS (SELECT 1 FROM accounts) AND NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'cat:vehicle_fuel' OR number = 6110)`,
  // ---- version 10: vehicles. Only NEW tables (nothing existing is altered). A vehicle cost is an ordinary expenses row (category vehicle_fuel) plus one
  // detail row here, so the ledger posts it once. Estimated upcoming maintenance lives only in vehicle_maintenance and is never posted. No plate, VIN or driver columns by design. ----
  `CREATE TABLE IF NOT EXISTS vehicles (
     id         bigserial PRIMARY KEY,
     label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
     active     boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS vehicle_expense_details (
     expense_id       bigint PRIMARY KEY REFERENCES expenses(id),
     vehicle_id       bigint NOT NULL REFERENCES vehicles(id),
     vehicle_category text NOT NULL CHECK (vehicle_category IN ('fuel', 'maintenance', 'repairs', 'tires', 'insurance', 'parking_tolls')),
     odometer         integer CHECK (odometer IS NULL OR (odometer >= 0 AND odometer <= 9999999))
   )`,
  `CREATE INDEX IF NOT EXISTS vehicle_expense_details_vehicle_idx ON vehicle_expense_details (vehicle_id)`,
  `CREATE TABLE IF NOT EXISTS vehicle_maintenance (
     id                   bigserial PRIMARY KEY,
     vehicle_id           bigint NOT NULL REFERENCES vehicles(id),
     status               text NOT NULL CHECK (status IN ('planned', 'done')),
     title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
     due_on               date,
     due_odometer         integer CHECK (due_odometer IS NULL OR (due_odometer >= 0 AND due_odometer <= 9999999)),
     estimated_cost_cents bigint CHECK (estimated_cost_cents IS NULL OR (estimated_cost_cents >= 0 AND estimated_cost_cents <= 99999999999)),
     done_on              date,
     odometer_at          integer CHECK (odometer_at IS NULL OR (odometer_at >= 0 AND odometer_at <= 9999999)),
     expense_id           bigint UNIQUE REFERENCES expenses(id),
     created_at           timestamptz NOT NULL DEFAULT now(),
     CHECK (status <> 'planned' OR due_on IS NOT NULL OR due_odometer IS NOT NULL),
     CHECK ((status = 'done') = (done_on IS NOT NULL))
   )`,
  `CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_idx ON vehicle_maintenance (vehicle_id, status)`,
  // Per tax year: how vehicle costs are treated in tax ESTIMATES. No row = standard mileage (vehicle costs are not claimed).
  `CREATE TABLE IF NOT EXISTS vehicle_tax_method (
     tax_year   integer PRIMARY KEY CHECK (tax_year BETWEEN 2000 AND 2100),
     method     text NOT NULL CHECK (method IN ('standard_mileage', 'actual')),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `INSERT INTO app_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE app_meta.value::int < EXCLUDED.value::int`,
];

/** Tables included in the full export, in order. */
export const EXPORT_TABLES = ["app_meta", "tax_year_rules", "audit_log", "import_batches", "income_entries", "inventory_items", "inventory_movements", "expenses", "expense_receipts", "mileage_trips", "vehicles", "vehicle_expense_details", "vehicle_maintenance", "vehicle_tax_method", "inventory_lot_uses", "inventory_settings", "payers", "income_entry_payers", "form_1099_entries", "tax_payments", "tax_snapshots", "accounts", "expense_category_accounts", "expense_accounts", "income_accounts", "inventory_item_accounts", "journal_entries", "journal_lines"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Column each exported table is sorted by (every other table has an id column). */
export const EXPORT_ORDER: Record<string, string> = { app_meta: "key", tax_year_rules: "tax_year", inventory_settings: "item_id", income_entry_payers: "income_id", expense_category_accounts: "category", vehicle_expense_details: "expense_id", vehicle_tax_method: "tax_year" };
