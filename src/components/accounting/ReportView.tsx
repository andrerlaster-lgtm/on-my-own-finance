import Link from "next/link";
import { fmtAmount, fmtPercent, type Cell, type ReportDoc } from "@/lib/statements";

const show = (c: Cell): string => (c.miles !== undefined ? (c.miles / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : c.amount !== undefined ? fmtAmount(c.amount) : c.percent !== undefined ? fmtPercent(c.percent) : c.text);

/** A statement laid out the way it is read: indented accounts, ruled subtotals, figures in columns. Amounts with a link open the transactions behind them. */
export function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <section className="statement" aria-label={doc.title}>
      <header className="stmt-head"><h2>{doc.title}</h2>{doc.subtitle && <div>{doc.subtitle}</div>}{doc.basis && <div className="muted">{doc.basis}</div>}</header>
      {doc.blocked ? <div className="note"><b>Not available yet.</b> {doc.blocked}</div> : (
        <div className="tablewrap">
          <table className="stmt">
            <thead><tr>{doc.columns.map((c, i) => <th key={i} className={c.align === "right" ? "num" : undefined}>{c.label}</th>)}</tr></thead>
            <tbody>
              {doc.rows.map((r, i) => r.kind === "blank" ? <tr key={i} className="blank"><td colSpan={doc.columns.length} /></tr> : (
                <tr key={i} className={`k-${r.kind}`}>
                  {r.cells.map((c, j) => {
                    const num = doc.columns[j]?.align === "right";
                    const span = r.kind === "section" && j === 0 ? doc.columns.length : undefined;
                    const body = show(c);
                    return <td key={j} colSpan={span} className={num ? "num" : undefined} style={j === 0 && r.indent ? { paddingLeft: `${8 + r.indent * 18}px` } : undefined}>{c.href ? <Link href={c.href}>{body}</Link> : body}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {doc.notes.length > 0 && <ul className="stmt-notes muted">{doc.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </section>
  );
}
