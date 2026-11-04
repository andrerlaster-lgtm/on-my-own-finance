import { SubmitButton } from "@/components/SubmitButton";
import { monthName } from "@/lib/statements";

const Q = [1, 2, 3, 4];

/** Plain GET form (no scripts needed): the chosen period lives in the address, so a view can be bookmarked, printed or exported as it is. */
export function PeriodForm({ action, p, today, compare = true, extra }: { action: string; p: Record<string, string | undefined>; today: string; compare?: boolean; extra?: React.ReactNode }) {
  const ty = Number(today.slice(0, 4));
  const kind = p.period === "quarter" || p.period === "year" || p.period === "custom" ? p.period : "month";
  const years = Array.from({ length: 8 }, (_, i) => ty - 5 + i);
  return (
    <form method="get" action={action} className="card period-form">
      <div className="row">
        <label>Period<select name="period" defaultValue={kind}><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option><option value="custom">Custom range</option></select></label>
        <label>Year<select name="y" defaultValue={p.y ?? String(ty)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label>Month<select name="m" defaultValue={p.m ?? String(Number(today.slice(5, 7)))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(2000, i + 1).split(" ")[0]}</option>)}</select></label>
        <label>Quarter<select name="q" defaultValue={p.q ?? String(Math.ceil(Number(today.slice(5, 7)) / 3))}>{Q.map((q) => <option key={q} value={q}>Q{q}</option>)}</select></label>
        <label>From<input type="date" name="from" defaultValue={p.from} /></label>
        <label>To<input type="date" name="to" defaultValue={p.to} /></label>
      </div>
      {compare && <div className="row">
        <label className="check"><input type="checkbox" name="compare" value="1" defaultChecked={p.compare === "1"} /> Compare with previous period</label>
        <label className="check"><input type="checkbox" name="ytd" value="1" defaultChecked={p.ytd === "1"} /> Year to date</label>
        <label className="check"><input type="checkbox" name="zero" value="1" defaultChecked={p.zero === "1"} /> Show accounts with no activity</label>
      </div>}
      {extra}
      <p><SubmitButton>Show</SubmitButton></p>
    </form>
  );
}
