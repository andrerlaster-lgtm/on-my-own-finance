/*
 * The ONE place that describes Square's Transactions CSV. When the real export differs, change this file only.
 * Provisional headers (from the owner, to be replaced by the real export): Date, Time, Time Zone, Gross Sales, Discounts,
 * Service Charges, Net Sales, Tax, Tip, Partial Refunds, Total Collected, Fees, Net Total, Transaction ID, Payment ID,
 * Event Type, Transaction Status, Refund Reason.
 *
 * Columns are found by header name (case and spacing ignored), never by position. Each field lists the header names accepted for it.
 * Only the fields listed here are ever read. Every other column (names, descriptions, cards, staff, devices...) is skipped unread.
 */
export const SQUARE_COLUMNS = {
  date: ["Date"],
  totalCollected: ["Total Collected"],
  tip: ["Tip"],
  tax: ["Tax"],
  fees: ["Fees"],
  netTotal: ["Net Total"],
  paymentId: ["Payment ID"],
  transactionId: ["Transaction ID"],
  status: ["Transaction Status"],
  eventType: ["Event Type"],       // optional
  partialRefunds: ["Partial Refunds"], // optional; read only to see whether a refund is involved
  refundReason: ["Refund Reason"], // optional; read only to see whether it is empty, the text is never kept
} as const;
export type SquareField = keyof typeof SQUARE_COLUMNS;

/** Must be present. (Also needed: at least one of paymentId / transactionId.) */
export const REQUIRED_FIELDS: readonly SquareField[] = ["date", "totalCollected", "tip", "tax", "fees", "netTotal", "status"];

/** Status values (lower case) that mean a finished, successful payment. Anything else is not counted as income. */
export const COMPLETED_STATUSES: readonly string[] = ["complete", "completed"];
export const REFUND_WORDS = /refund/i;
export const FAILED_WORDS = /fail|declin|cancel|void|error|denied/i;
export const PAYMENT_EVENT_WORDS = /payment|sale|charge/i;

/*
 * How the money columns become our fields (all in cents):
 *   tip      = Tip
 *   revenue  = Total Collected - Tip - Tax          (Tax must be 0; the business charges no sales tax)
 *   fee      = |Fees|                                 (Square may write fees as negative numbers)
 *   check    = Net Total must equal Total Collected - fee, otherwise the row is "uncertain" and not counted
 * Revenue + tip = Total Collected, so nothing is counted twice.
 */
export const LIMITS = { fileBytes: 2_000_000, records: 20_000, importableRows: 5_000 };
