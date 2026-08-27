// paymentTerms.js — how long a customer has to pay, in one place.
//
// The KEY is what's stored ('twentieth'); the LABEL is what a customer reads.
// Kept apart deliberately: the wording on an invoice can be reworded any time
// without touching stored data or breaking a report that groups by terms.
//
// The due DATE is never computed here. It comes from the database
// (invoice_due_date / the trg_invoice_due_date trigger) so the date on the PDF and
// the date the overdue reports use are always the same number from the same rule.

export const PAYMENT_TERMS = [
  { key: "on_invoice", label: "Payment due on invoice",            short: "Due on receipt" },
  { key: "days_7",     label: "Payment due within 7 days",         short: "7 days" },
  { key: "twentieth",  label: "Payment due 20th of month following", short: "20th following" },
];

export const DEFAULT_TERMS = "twentieth";

export const termsLabel = (key) =>
  PAYMENT_TERMS.find((t) => t.key === key)?.label ?? PAYMENT_TERMS.find((t) => t.key === DEFAULT_TERMS).label;

export const termsShort = (key) =>
  PAYMENT_TERMS.find((t) => t.key === key)?.short ?? PAYMENT_TERMS.find((t) => t.key === DEFAULT_TERMS).short;
