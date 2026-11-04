const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const X = require("../.testbuild/schedule.js"), S = require("../.testbuild/schema.js"), F = require("../.testbuild/backupFormat.js");
const rd = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const at = (d, t) => { const r = X.fromLocal(d, t); assert.equal(r.ok, true, `${d} ${t}`); return r.ms; };
const appt = (id, d, t, minutes, status = "scheduled") => ({ id, status, starts_at: at(d, t), ends_at: at(d, t) + minutes * 60000 });

// ---------- time zone and daylight saving ----------
test("Chicago times: summer is CDT (UTC-5), winter is CST (UTC-6), and a typed time round-trips", () => {
  assert.equal(new Date(at("2026-07-04", "09:00")).toISOString(), "2026-07-04T14:00:00.000Z");
  assert.equal(new Date(at("2026-01-04", "09:00")).toISOString(), "2026-01-04T15:00:00.000Z");
  assert.deepEqual(X.toLocal(at("2026-07-04", "09:00")), { date: "2026-07-04", time: "09:00", zone: "CDT" });
  assert.deepEqual(X.toLocal(at("2026-01-04", "09:00")), { date: "2026-01-04", time: "09:00", zone: "CST" });
  for (const d of ["2026-01-15", "2026-03-07", "2026-03-09", "2026-06-30", "2026-10-31", "2026-11-02", "2027-12-31"]) for (const t of ["00:00", "07:45", "12:00", "23:59"]) { const l = X.toLocal(at(d, t)); assert.deepEqual([l.date, l.time], [d, t]); }
  assert.equal(X.fromLocal("2026-02-30", "09:00").ok, false); assert.equal(X.fromLocal("2026-02-01", "9:00").ok, false); assert.equal(X.fromLocal("2026-02-01", "24:00").ok, false); assert.equal(X.fromLocal("2026-02-01", "09:60").ok, false);
});

test("spring forward (March 8, 2026 and March 14, 2027): the skipped hour is refused and the day is 23 hours", () => {
  for (const [d, skipped, after] of [["2026-03-08", "02:30", "03:00"], ["2027-03-14", "02:00", "03:30"]]) {
    const r = X.fromLocal(d, skipped); assert.equal(r.ok, false); assert.match(r.error, /does not exist/);
    assert.equal(X.fromLocal(d, after).ok, true);
    const b = X.dayBounds(d); assert.equal((b.to - b.from) / 3600000, 23);
    assert.equal(X.toLocal(at(d, "01:59")).zone, "CST"); assert.equal(X.toLocal(at(d, "03:00")).zone, "CDT");
  }
  // 1:30 AM CST + 60 real minutes lands on 3:30 AM CDT (not a nonexistent 2:30)
  const start = at("2026-03-08", "01:30"), end = start + 60 * 60000;
  assert.deepEqual(X.toLocal(end), { date: "2026-03-08", time: "03:30", zone: "CDT" });
  assert.match(X.rangeLabel({ starts_at: start, ends_at: end }), /1:30 AM to 3:30 AM CDT \(starts CST\)/);
});

test("fall back (November 1, 2026): the repeated hour is taken as its first occurrence, and the day is 25 hours", () => {
  const r = X.fromLocal("2026-11-01", "01:30"); assert.equal(r.ok, true); assert.equal(r.ambiguous, true);
  assert.equal(new Date(r.ms).toISOString(), "2026-11-01T06:30:00.000Z", "first 1:30 is CDT");
  assert.equal(X.toLocal(r.ms).zone, "CDT"); assert.equal(X.toLocal(r.ms + 3600000).zone, "CST", "an hour later the same wall clock reads CST");
  assert.equal(X.toLocal(r.ms + 3600000).time, "01:30");
  assert.equal(X.fromLocal("2026-11-01", "02:30").ambiguous, false); assert.equal(X.fromLocal("2026-11-01", "00:59").ambiguous, false);
  const b = X.dayBounds("2026-11-01"); assert.equal((b.to - b.from) / 3600000, 25);
  const ordinary = X.dayBounds("2026-11-02"); assert.equal((ordinary.to - ordinary.from) / 3600000, 24);
  assert.equal(b.to, ordinary.from, "days tile with no gap or overlap");
  // an appointment spanning the change keeps its real length
  const start = at("2026-11-01", "00:30"), end = start + 120 * 60000;
  assert.equal(X.minutesOf({ starts_at: start, ends_at: end }), 120); assert.deepEqual(X.toLocal(end), { date: "2026-11-01", time: "01:30", zone: "CST" });
});

test("a late-evening appointment belongs to its Chicago day, not the UTC day; weeks run Monday to Sunday", () => {
  const ms = at("2026-07-04", "21:00"); assert.equal(new Date(ms).toISOString().slice(0, 10), "2026-07-05");
  assert.equal(X.dateOf(ms), "2026-07-04");
  const b = X.dayBounds("2026-07-04"); assert.ok(ms >= b.from && ms < b.to);
  assert.equal(X.weekStart("2026-11-04"), "2026-11-02"); assert.equal(X.weekStart("2026-11-08"), "2026-11-02"); assert.equal(X.weekStart("2026-11-09"), "2026-11-09");
  assert.deepEqual(X.weekDates("2026-11-04").map((d) => d.slice(8)), ["02", "03", "04", "05", "06", "07", "08"]);
  assert.equal(X.weekDates("2026-12-30")[6], "2027-01-03", "a week can cross the year");
  assert.equal(X.clock("00:05"), "12:05 AM"); assert.equal(X.clock("12:00"), "12:00 PM"); assert.equal(X.clock("13:30"), "1:30 PM"); assert.equal(X.dayLabel("2026-11-04"), "Wed Nov 4");
  const g = X.groupByDate([appt(2, "2026-11-03", "10:00", 30), appt(1, "2026-11-03", "08:00", 30), appt(3, "2026-11-04", "08:00", 30)]);
  assert.deepEqual([...g.keys()], ["2026-11-03", "2026-11-04"]); assert.deepEqual(g.get("2026-11-03").map((a) => a.id), [1, 2]);
});

// ---------- double bookings ----------
test("overlaps: touching is fine, any shared time is not, canceled never blocks, and an edit ignores itself", () => {
  const a = appt(1, "2026-11-04", "09:00", 30);
  assert.equal(X.overlaps(a, appt(2, "2026-11-04", "09:30", 30)), false, "starts exactly when the first ends");
  assert.equal(X.overlaps(a, appt(2, "2026-11-04", "08:30", 30)), false);
  for (const [t, m] of [["09:29", 30], ["08:45", 30], ["09:10", 5], ["08:00", 240], ["09:00", 30]]) assert.equal(X.overlaps(a, appt(2, "2026-11-04", t, m)), true, `${t}+${m}`);
  assert.equal(X.overlaps(a, appt(2, "2026-11-04", "09:00", 30, "canceled")), false); assert.equal(X.overlaps({ ...a, status: "canceled" }, appt(2, "2026-11-04", "09:00", 30)), false);
  assert.equal(X.overlaps(a, appt(2, "2026-11-04", "09:10", 10, "completed")), true, "completed visits still occupy their time");
  const list = [a, appt(2, "2026-11-04", "10:00", 60), appt(3, "2026-11-04", "09:20", 20, "canceled")];
  assert.deepEqual(X.findConflicts(list, { starts_at: at("2026-11-04", "09:15"), ends_at: at("2026-11-04", "10:15"), status: "scheduled" }).map((c) => c.id), [1, 2]);
  assert.deepEqual(X.findConflicts(list, { id: 1, starts_at: at("2026-11-04", "09:00"), ends_at: at("2026-11-04", "09:45"), status: "scheduled" }), [], "moving an appointment within its own slot is fine");
  assert.match(X.conflictText([a]), /overlaps an existing appointment: #1 on Wed Nov 4, 9:00 AM to 9:30 AM CST/);
  // DST: two real-time-adjacent bookings across the repeated hour do not collide even though their wall clocks match
  const first = X.fromLocal("2026-11-01", "01:30").ms, second = first + 3600000;
  assert.equal(X.overlaps({ starts_at: first, ends_at: first + 1800000, status: "scheduled" }, { starts_at: second, ends_at: second + 1800000, status: "scheduled" }), false);
});

test("status rules: scheduled, confirmed, completed, canceled", () => {
  assert.deepEqual(X.STATUSES.map((s) => s.id), ["scheduled", "confirmed", "completed", "canceled"]);
  assert.deepEqual(X.allowedNext("scheduled"), ["confirmed", "completed", "canceled"]); assert.deepEqual(X.allowedNext("completed"), []); assert.deepEqual(X.allowedNext("canceled"), ["scheduled"]);
  const now = at("2026-11-04", "12:00"), past = at("2026-11-04", "09:00"), future = at("2026-11-05", "09:00");
  assert.equal(X.checkTransition("scheduled", "confirmed", future, now), null); assert.equal(X.checkTransition("confirmed", "completed", past, now), null);
  assert.match(X.checkTransition("scheduled", "completed", future, now), /only after it has started/);
  assert.match(X.checkTransition("completed", "canceled", past, now), /cannot be changed/); assert.match(X.checkTransition("completed", "scheduled", past, now), /cannot be changed/);
  assert.equal(X.checkTransition("canceled", "scheduled", future, now), null, "a canceled appointment can be reinstated (the database re-checks overlaps)");
  assert.equal(X.isEditable("scheduled"), true); assert.equal(X.isEditable("confirmed"), true); assert.equal(X.isEditable("completed"), false); assert.equal(X.isEditable("canceled"), false);
  assert.equal(X.parseCancelReason("no_show"), "no_show"); assert.equal(X.parseCancelReason("because Mrs. Smith is sick"), null);
});

// ---------- forms ----------
const services = [{ code: "blood_draw", active: true }, { code: "old_service", active: false }];
test("the appointment form accepts only fixed choices, a real Chicago time and a sensible length", () => {
  const f = (o) => X.parseAppointmentForm({ date: "2026-11-04", time: "09:30", minutes: "30", type: "mobile", service_code: "blood_draw", ...o }, services);
  const ok = f({}); assert.equal(ok.ok, true);
  assert.deepEqual([ok.value.type, ok.value.service_code, ok.value.starts_at === at("2026-11-04", "09:30"), ok.value.ends_at - ok.value.starts_at], ["mobile", "blood_draw", true, 1800000]);
  for (const bad of [{ type: "home" }, { type: "" }, { service_code: "mystery" }, { service_code: "old_service" }, { minutes: "0" }, { minutes: "7" }, { minutes: "725" }, { minutes: "abc" }, { minutes: "-30" }, { date: "nope" }, { time: "25:00" }, { time: "02:30", date: "2026-03-08" }])
    assert.equal(f(bad).ok, false, JSON.stringify(bad));
  assert.equal(f({ type: "office" }).ok, true);
  assert.equal(f({ date: "2026-11-01", time: "01:30" }).value.ambiguous, true);
  // extra fields a person might try to send are ignored, never stored
  assert.deepEqual(Object.keys(f({ patient_name: "Jane Doe", phone: "5551234567", notes: "has diabetes" }).value).sort(), ["ambiguous", "ends_at", "service_code", "starts_at", "type"]);
});

// ---------- privacy ----------
test("appointments store no names, contact details, medical details or free text", () => {
  const sql = S.schemaStatements.filter((s) => /appointment/.test(s)).join("\n");
  const body = (t) => new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(([\\s\\S]*?)\\n   \\)`).exec(sql)[1];
  const cols = [...body("appointments").split("\n"), ...body("appointment_services").split("\n")].map((l) => l.trim().split(/\s+/)[0].toLowerCase()).filter((c) => /^[a-z_]+$/.test(c) && !["check", "exclude"].includes(c));
  assert.deepEqual(cols.sort(), ["active", "ends_at", "starts_at", "canceled_at", "cancel_reason", "code", "created_at", "default_minutes", "external_ref", "id", "label", "service_code", "sort_order", "source", "status", "time_zone", "type", "updated_at", "created_at"].sort(), "the full list of columns: nothing that could hold a person's details");
  for (const bad of ["name", "patient", "client", "customer", "email", "phone", "address", "dob", "birth", "diagnosis", "note", "notes", "memo", "comment", "description", "location", "reason_text"]) assert.ok(!cols.some((c) => c === bad || c.startsWith(bad + "_") || c.endsWith("_" + bad)), bad);
  for (const col of ["type", "status", "cancel_reason", "source"]) assert.match(body("appointments"), new RegExp(`${col}\\s+text[^\\n]*CHECK \\(${col}[^\\n]*IN \\(`), `${col} is a fixed list`);
  assert.match(body("appointments"), /external_ref\s+text CHECK \(external_ref IS NULL OR external_ref ~ '\^\[A-Za-z0-9_-\]\{1,64\}\$'\)/, "the only free-ish field is a machine reference with no spaces");
  const ui = ["src/components/AppointmentForm.tsx", "src/app/secretary/page.tsx", "src/app/secretary/week/page.tsx", "src/app/secretary/new/page.tsx", "src/app/secretary/[id]/page.tsx", "src/components/AppointmentRow.tsx"].map(rd).join("\n");
  assert.doesNotMatch(ui, /<textarea|type="text"|type="tel"|type="email"|<input[^>]*name="(name|phone|address|note|notes)"/, "no way to type free text");
  assert.match(rd("src/components/AppointmentForm.tsx"), /No names, phone numbers, addresses or medical details/);
});

// ---------- database, backups, accounting protection ----------
test("version 9 only adds new tables; double bookings are blocked by the database itself; the website can integrate safely", () => {
  assert.ok(S.SCHEMA_VERSION >= 9);
  const stmts = S.schemaStatements.filter((s) => /appointment/.test(s));
  assert.ok(stmts.every((s) => /^\s*(CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|INSERT INTO appointment_services)/.test(s)) && stmts.length === 5, "tables, an idempotent seed and two indexes, nothing else");
  assert.match(stmts.find((s) => /^\s*INSERT/.test(s)), /ON CONFLICT \(code\) DO NOTHING/);
  const t = stmts.find((s) => /CREATE TABLE IF NOT EXISTS appointments/.test(s));
  assert.match(t, /EXCLUDE USING gist \(tstzrange\(starts_at, ends_at\) WITH &&\) WHERE \(status <> 'canceled'\)/);
  assert.match(t, /starts_at\s+timestamptz NOT NULL/); assert.match(t, /time_zone\s+text NOT NULL DEFAULT 'America\/Chicago' CHECK \(time_zone = 'America\/Chicago'\)/);
  assert.match(t, /service_code\s+text NOT NULL REFERENCES appointment_services\(code\)/);
  assert.match(t, /CHECK \(\(status = 'canceled'\) = \(canceled_at IS NOT NULL\)\)/);
  assert.match(stmts.join("\n"), /CREATE UNIQUE INDEX IF NOT EXISTS appointments_external_ref_idx ON appointments \(source, external_ref\) WHERE external_ref IS NOT NULL/, "idempotency key for the future booking site");
  assert.doesNotMatch(stmts.join("\n"), /REFERENCES (income|expenses|inventory|journal|accounts|mileage|tax)/, "no link to money, supplies or tax tables");
  assert.ok(S.schemaStatements.at(-1).includes("schema_version"));
  // the seeded services match the app's defaults
  for (const sv of X.DEFAULT_SERVICES) assert.ok(stmts.join("\n").includes(`'${sv.code}', '${sv.label}', ${sv.default_minutes}, ${sv.sort}`), sv.code);
});

test("new tables are in the export, the backup and the restore order (parents first)", () => {
  for (const t of ["appointment_services", "appointments"]) { assert.ok(S.EXPORT_TABLES.includes(t), `${t} exported`); assert.ok(F.RESTORE_ORDER.includes(t), `${t} restored`); }
  assert.ok(F.RESTORE_ORDER.indexOf("appointment_services") < F.RESTORE_ORDER.indexOf("appointments"));
  assert.equal(S.EXPORT_ORDER.appointment_services, "code");
  assert.match(rd("docs/BACKUPS.md") + rd("docs/SECRETARY.md"), /appointments/);
});

test("the Secretary never touches money or supplies, and the accounting code cannot see appointments", () => {
  const db = rd("src/lib/db.ts"), sec = db.slice(db.indexOf("// ---- Secretary"));
  assert.doesNotMatch(sec, /income_entries|expenses|inventory_|journal_|accounts|tax_|mileage_|audit_log|receipt/i, "the Secretary code reads and writes only appointment tables (and the activity log through audit())".replace("audit_log|", ""));
  assert.doesNotMatch(sec, /INSERT INTO (income|expenses)|revenue/i);
  for (const f of ["src/lib/ledger.ts", "src/lib/accountingDb.ts", "src/lib/statements.ts", "src/lib/reports.ts", "src/lib/packet.ts", "src/lib/inventory.ts", "src/lib/income.ts", "src/lib/expenses.ts"]) assert.doesNotMatch(rd(f), /appointment|schedule/i, `${f} knows nothing about appointments`);
  assert.doesNotMatch(rd("src/lib/schedule.ts").replace(/\/\*[\s\S]*?\*\//g, ""), /income|expense|inventory|revenue|cents/i, "scheduling logic has no money or stock concepts");
});

test("Secretary is private, in the menu, on the dashboard, and the authentication code is untouched", () => {
  for (const f of ["src/app/secretary/page.tsx", "src/app/secretary/week/page.tsx", "src/app/secretary/new/page.tsx", "src/app/secretary/[id]/page.tsx"]) {
    const s = rd(f); assert.match(s, /requireOwner\(\)/, f); assert.match(s, /export const dynamic = "force-dynamic"/, f);
  }
  for (const f of ["src/app/secretary/new/page.tsx", "src/app/secretary/[id]/page.tsx"]) for (const m of rd(f).matchAll(/"use server";\s*\n\s*(.*)/g)) assert.match(m[1], /requireOwner/, `${f}: action without an access check`);
  assert.match(rd("src/components/Nav.tsx"), /href: "\/secretary", label: "Secretary"/);
  const home = rd("src/app/page.tsx"); assert.match(home, /Today&rsquo;s appointments/); assert.match(home, /dayBounds\(today\)/); assert.match(home, /listAppointments\(dayB\.from, dayB\.to\)/);
  assert.match(home, /\.catch\(\(\) => \[null, null\]/, "an appointments problem cannot hide the money dashboard");
  const auth = rd("src/lib/auth.ts"); assert.doesNotMatch(auth, /secretary|appointment/i);
  assert.match(rd("src/lib/activity.ts"), /add_appointment/);
});

test("database writes are guarded: no double booking race, no stale status overwrite, only open appointments editable", () => {
  const db = rd("src/lib/db.ts"), sec = db.slice(db.indexOf("// ---- Secretary"));
  assert.match(sec, /isOverlapError/); assert.match(sec, /WHERE id = \$1::bigint AND status IN \('scheduled', 'confirmed'\)/); assert.match(sec, /WHERE id = \$1::bigint AND status = \$2 RETURNING id/);
  assert.doesNotMatch(sec, /DELETE FROM appointments/, "appointments are canceled, never deleted");
  assert.match(sec, /findConflicts\(await overlapping/);
});

// ---------- appointments that cross midnight ----------
test("an appointment that crosses midnight is shown on every Chicago day it occupies, once per day, as one appointment", () => {
  const late = { id: 7, status: "scheduled", starts_at: at("2026-11-03", "23:30"), ends_at: at("2026-11-03", "23:30") + 60 * 60000 }; // 11:30 PM to 12:30 AM
  assert.deepEqual(X.occupiedDates(late), ["2026-11-03", "2026-11-04"]);
  assert.equal(X.occursOn(late, "2026-11-03"), true); assert.equal(X.occursOn(late, "2026-11-04"), true);
  assert.equal(X.occursOn(late, "2026-11-02"), false); assert.equal(X.occursOn(late, "2026-11-05"), false);
  assert.deepEqual(X.continuation(late, "2026-11-03"), { fromPrev: false, toNext: true }); assert.deepEqual(X.continuation(late, "2026-11-04"), { fromPrev: true, toNext: false });
  // the week groups it under both days, and it is the same appointment (same id), never a copy
  const other = { id: 8, status: "scheduled", starts_at: at("2026-11-04", "09:00"), ends_at: at("2026-11-04", "09:30") };
  const g = X.groupByDate([other, late]);
  assert.deepEqual([...g.keys()], ["2026-11-03", "2026-11-04"]);
  assert.deepEqual(g.get("2026-11-03").map((a) => a.id), [7]); assert.deepEqual(g.get("2026-11-04").map((a) => a.id), [7, 8], "listed first on the second day because it started earlier");
  assert.equal(new Set([...g.values()].flat().map((a) => a.id)).size, 2, "two appointments in total, however many days they span");
  assert.equal(g.get("2026-11-03")[0], g.get("2026-11-04")[0], "the very same record");
  assert.equal(X.spanLabel(late), "Tue Nov 3, 11:30 PM to Wed Nov 4, 12:30 AM CST");
  assert.equal(X.spanLabel(other), X.rangeLabel(other), "a same-day appointment is labelled as before");
});

test("midnight edges: ending exactly at midnight stays on one day; starting exactly at midnight is not on the day before", () => {
  const endsAtMidnight = { starts_at: at("2026-11-03", "23:00"), ends_at: at("2026-11-04", "00:00") };
  assert.deepEqual(X.occupiedDates(endsAtMidnight), ["2026-11-03"]); assert.equal(X.occursOn(endsAtMidnight, "2026-11-04"), false);
  const startsAtMidnight = { starts_at: at("2026-11-04", "00:00"), ends_at: at("2026-11-04", "01:00") };
  assert.deepEqual(X.occupiedDates(startsAtMidnight), ["2026-11-04"]); assert.equal(X.occursOn(startsAtMidnight, "2026-11-03"), false);
  assert.deepEqual(X.continuation(startsAtMidnight, "2026-11-04"), { fromPrev: false, toNext: false });
  const longest = { starts_at: at("2026-11-03", "20:00"), ends_at: at("2026-11-03", "20:00") + 12 * 3600000 }; // the 12-hour maximum
  assert.deepEqual(X.occupiedDates(longest), ["2026-11-03", "2026-11-04"]);
});

test("crossing midnight on a daylight-saving day uses real elapsed time and Chicago days", () => {
  const fall = { starts_at: at("2026-10-31", "23:30"), ends_at: at("2026-10-31", "23:30") + 120 * 60000 }; // lands on Nov 1, 12:30 AM CDT
  assert.deepEqual(X.occupiedDates(fall), ["2026-10-31", "2026-11-01"]); assert.equal(X.spanLabel(fall), "Sat Oct 31, 11:30 PM to Sun Nov 1, 1:30 AM CDT");
  const into = { starts_at: at("2026-11-01", "00:30"), ends_at: at("2026-11-01", "00:30") + 8 * 3600000 }; // 8 real hours across the repeated hour: the wall clock advances 7 hours
  assert.equal(X.toLocal(into.ends_at).time, "07:30"); assert.equal(X.toLocal(into.ends_at).zone, "CST");
  const spring = { starts_at: at("2027-03-13", "23:00"), ends_at: at("2027-03-13", "23:00") + 180 * 60000 }; // Mar 13 11 PM + 3 real hours = Mar 14 3:00 AM CDT (2 to 3 AM does not exist)
  assert.equal(X.toLocal(spring.ends_at).time, "03:00"); assert.deepEqual(X.occupiedDates(spring), ["2027-03-13", "2027-03-14"]);
  assert.equal(X.occursOn(spring, "2027-03-14"), true);
});

test("overlap protection still covers the part of a midnight-crossing appointment that falls on the next day", () => {
  const late = { id: 7, status: "scheduled", starts_at: at("2026-11-03", "23:30"), ends_at: at("2026-11-04", "00:30") };
  assert.deepEqual(X.findConflicts([late], { starts_at: at("2026-11-04", "00:15"), ends_at: at("2026-11-04", "00:45"), status: "scheduled" }).map((a) => a.id), [7]);
  assert.deepEqual(X.findConflicts([late], { starts_at: at("2026-11-04", "00:30"), ends_at: at("2026-11-04", "01:00"), status: "scheduled" }), [], "back to back is still fine");
  assert.match(X.conflictText([late]), /#7 on Tue Nov 3, 11:30 PM to 12:30 AM CST/);
});

test("the calendar queries return appointments that overlap the window, so both days and the whole week see them; privacy and accounting isolation are unchanged", () => {
  const db = rd("src/lib/db.ts"), fn = db.slice(db.indexOf("export async function listAppointments"), db.indexOf("export async function getAppointment"));
  assert.match(fn, /starts_at >= \$1::timestamptz - interval '12 hours' AND starts_at < \$2::timestamptz AND ends_at > \$1::timestamptz/, "overlap with the window, not just the start time");
  assert.match(S.schemaStatements.find((s) => /CREATE TABLE IF NOT EXISTS appointments/.test(s)), /extract\(epoch FROM \(ends_at - starts_at\)\) <= 43200/, "the 12-hour cap the index narrowing relies on");
  for (const f of ["src/app/secretary/page.tsx", "src/app/secretary/week/page.tsx", "src/app/page.tsx"]) assert.match(rd(f), /<AppointmentRow[^>]*day=\{/, `${f} marks continuing appointments`);
  assert.match(rd("src/app/secretary/week/page.tsx"), /groupByDate\(openOnly\(list\)\)/);
  const row = rd("src/components/AppointmentRow.tsx"); assert.match(row, /continues past midnight/); assert.match(row, /continues from the day before/);
  assert.doesNotMatch(row + rd("src/lib/schedule.ts").replace(/\/\*[\s\S]*?\*\//g, ""), /income|expense|inventory|revenue|cents|patient|phone|address/i);
  assert.doesNotMatch(fn, /income|expenses|inventory_|journal_|accounts/);
});
