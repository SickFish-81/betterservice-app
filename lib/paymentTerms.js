// paymentTerms.js — how long a customer has to pay, in one place.
//
// The KEY is what's stored ('twentieth'); the LABEL is what a customer reads.
// Kept apart deliberately: the wording on an invoice can be reworded any time
// without touching stored data or breaking a report that groups by terms.
//
// The due DATE is never computed here. It comes from the database
// (invoice_due_date / the trg_invoice_due_date trigger) so the date on the PDF and
// the date the overdue reports use are always the same number from the same rule.

// Every term the database can store. The check constraint on invoices.payment_terms
// allows four; this list has to cover all four, because an invoice carrying a term
// missing from here would be LABELLED AS SOMETHING ELSE on its own PDF.
//
// That is not hypothetical: days_3 is what rent invoices are issued on, and it was
// missing here, so re-rendering or re-emailing a rent invoice from the invoice page
// printed "Payment due 20th of month following" — the fallback — on a bill that was
// actually due the day the period started.
export const ALL_TERMS = [
  { key: "on_invoice", label: "Payment due on invoice",              short: "Due on receipt" },
  { key: "days_3",     label: "Payment due within 3 days",           short: "3 days" },
  { key: "days_7",     label: "Payment due within 7 days",           short: "7 days" },
  { key: "twentieth",  label: "Payment due 20th of month following", short: "20th following" },
];

// The terms a person can CHOOSE. Narrower than the list above on purpose: days_3
// belongs to the rent run, which sets it itself, and picking it by hand on a
// workshop invoice would only cause confusion.
export const PAYMENT_TERMS = ALL_TERMS.filter((t) => t.key !== "days_3");

// Workshop (job card) invoices carry this unless Settings says otherwise.
export const DEFAULT_TERMS = "days_7";

const fallback = (field) => ALL_TERMS.find((t) => t.key === DEFAULT_TERMS)[field];

export const termsLabel = (key) => ALL_TERMS.find((t) => t.key === key)?.label ?? fallback("label");

export const termsShort = (key) => ALL_TERMS.find((t) => t.key === key)?.short ?? fallback("short");
