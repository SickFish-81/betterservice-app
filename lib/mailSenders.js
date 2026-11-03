// Who the app's outbound mail actually comes FROM.
//
// WHY THIS FILE EXISTS
//
// The invoice screen used to tell Craig "Sends from admin@betterservice.co.nz"
// through a ternary whose two branches were the same string:
//
//   {settings?.invoice_bcc ? "admin@betterservice.co.nz" : "admin@betterservice.co.nz"}
//
// Job invoices have never sent from admin@ — send-invoice uses accounts@. So
// the screen stated the wrong sender for every job invoice ever emailed, and
// would have gone on stating it no matter what anyone changed in the function,
// because nothing connected the two. A confident sentence produced by a layer
// nobody checked. That is the same failure as `emailed = true` not meaning
// delivered, and a printer accepting a job it then binned.
//
// THIS FILE IS A MIRROR, NOT THE SOURCE OF TRUTH.
//
// The real From addresses live in the Supabase edge functions, which the
// browser cannot read. A screen that has to say what WILL happen before it
// happens has no choice but to keep a copy. So each entry below names the file
// it was copied from — change one, change the other.
//
// A mirror can still drift silently, which is the whole problem this is meant
// to fix. The durable version is for each function to return the address it
// actually used and for the confirmation to show THAT, so a mismatch becomes
// visible the first time it happens rather than never. Until then, this file at
// least puts all five copies in one place with their origins written down.

export const SENDERS = {
  // supabase/functions/send-invoice/index.ts — job AND rental invoices sent
  // from the invoice screen both go through this one.
  invoice: "accounts@betterservice.co.nz",

  // supabase/functions/send-rental-invoice/index.ts — the rentals screen.
  rentalInvoice: "admin@betterservice.co.nz",

  // supabase/functions/send-due-reminders/index.ts
  dueReminder: "admin@betterservice.co.nz",

  // supabase/functions/send-purchase-order/index.ts
  purchaseOrder: "admin@betterservice.co.nz",

  // supabase/functions/generate-rental-invoices/index.ts — the nightly "still
  // not sent" summary that goes to the shop itself.
  nightlySummary: "admin@betterservice.co.nz",
};
