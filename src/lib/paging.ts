/** How many rows a list page draws (default 100, up to 2,000). Totals on those pages are always computed from every row, not just the ones drawn. */
export function rowsToShow(raw: string | undefined, fallback = 100): number {
  const n = /^\d{1,5}$/.test(raw ?? "") ? Number(raw) : fallback;
  return Math.min(2000, Math.max(20, n));
}
