import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { databaseReady, countUndecidedSquare, bulkSetSquareForm } from "@/lib/db";
import { todayInChicago } from "@/lib/dates";
import { parseYear } from "@/lib/taxRules";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";
const CHOICES = [{ id: "1099k", label: "1099-K" }, { id: "1099nec", label: "1099-NEC" }, { id: "none", label: "No form expected" }] as const;

async function apply(fd: FormData) {
  "use server";
  await requireOwner();
  const year = parseYear(String(fd.get("year") ?? "")), form = String(fd.get("form") ?? "");
  if (year === null || !CHOICES.some((c) => c.id === form)) redirect("/taxes/bulk?error=1");
  const n = await bulkSetSquareForm(year, form as "1099k" | "1099nec" | "none");
  redirect(`/taxes/bulk?year=${year}&done=${n}`);
}

export default async function Bulk({ searchParams }: { searchParams: Promise<{ year?: string; form?: string; done?: string; error?: string }> }) {
  await requireOwner();
  if (!(await databaseReady())) redirect("/");
  const sp = await searchParams;
  const year = parseYear(sp.year) ?? Number(todayInChicago().slice(0, 4));
  const choice = CHOICES.find((c) => c.id === sp.form);
  const count = await countUndecidedSquare(year);
  return (
    <main>
      <Nav />
      <p><Link href={`/taxes?year=${year}`}>← Taxes {year}</Link></p>
      <h1>Set the tax form on Square entries</h1>
      <div className="note">Which form applies is your tax preparer&rsquo;s decision. This only fills in Square entries of one year that still say &ldquo;not decided&rdquo;; it never changes an entry where you already chose.</div>
      {sp.done !== undefined && /^\d{1,7}$/.test(sp.done) && <div className="note">Updated {sp.done} entr{sp.done === "1" ? "y" : "ies"}.</div>}
      <form method="get" className="card row">
        <label htmlFor="y" style={{ margin: 0 }}>Year</label><input id="y" name="year" type="number" min={2000} max={2100} defaultValue={year} style={{ maxWidth: 120 }} />
        <label htmlFor="f" style={{ margin: 0 }}>Set to</label>
        <select id="f" name="form" defaultValue={choice?.id ?? "1099k"}>{CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <button className="btn secondary" type="submit">Preview</button>
      </form>
      {choice && (
        <form action={apply} className="card">
          <input type="hidden" name="year" value={year} /><input type="hidden" name="form" value={choice.id} />
          <p><b>{count}</b> Square entr{count === 1 ? "y" : "ies"} dated {year} with no tax form chosen would be set to <b>{choice.label}</b>.</p>
          <button className="btn" type="submit" disabled={count === 0}>Confirm and update {count}</button>
        </form>
      )}
    </main>
  );
}
