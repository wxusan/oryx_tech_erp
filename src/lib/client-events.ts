export const FINANCIAL_DATA_CHANGED_EVENT = 'oryx:financial-data-changed'

/** Notify persistent shop-shell widgets after a successful local mutation. */
export function markFinancialDataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FINANCIAL_DATA_CHANGED_EVENT))
}
