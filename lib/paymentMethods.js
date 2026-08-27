// paymentMethods.js — one list of how money moves, used everywhere.
//
// Why this is shared rather than typed into each page: these strings get stored in
// the database, and later they'll be grouped ("how much came in by Eftpos this
// month?"). If one screen saves "Eftpos" and another saves "eftpos", that report
// silently splits in two and undercounts. One list, one spelling, everywhere.
//
// Adding a method: add it here and it appears on every screen at once. Renaming one
// needs an UPDATE across payments / supplier_payments / counter_sales first, or old
// records keep the old label.

export const PAYMENT_METHODS = [
  "Cash",
  "Eftpos",
  "Bank transfer",   // internet banking / direct deposit
  "Card",            // credit card, incl. over the phone
  "Other",
];

export const DEFAULT_PAYMENT_METHOD = "Eftpos";
