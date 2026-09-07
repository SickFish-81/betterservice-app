"use client";

// The "it has gone" moment.
//
// Sending an invoice is the one irreversible thing in the app: money has been
// asked for, in someone's inbox, under Craig's name. Until now the job card
// said nothing at all on success — it only spoke up when something failed — and
// the other two paths put a small green line at the foot of a long page, below
// the fold on a phone. So the honest read of the screen after a send was
// "nothing happened", which invites a second click and a second invoice.
//
// This stops and says so. It has to be dismissed, deliberately, because the
// point is not decoration: it is the receipt for an action that cannot be
// taken back.
//
// It also carries the failure case. An invoice can be filed and marked sent
// while the EMAIL is rejected — the shop's records say sent, the customer has
// nothing, and nobody finds out until the money is late. That case gets the
// same interruption in amber, because it needs a person more than the happy
// one does.

import { useEffect, useRef } from "react";

const money = (n) => "$" + Number(n || 0).toFixed(2);

export default function SentConfirmation({
  open,
  onClose,
  invoiceNumber,   // 1007
  to,              // customer's email
  copyTo,          // the shop's own bcc, if there is one
  total,
  extra,           // e.g. "The lease agreement went with it."
  problem,         // set when it was filed but the email did NOT go
}) {
  const okRef = useRef(null);

  // Escape closes it, and the button takes focus, so it can be dismissed
  // without reaching for the mouse.
  useEffect(() => {
    if (!open) return;
    okRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const no = "#" + String(invoiceNumber ?? "").padStart(5, "0");
  const bad = !!problem;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={bad ? "Invoice not emailed" : "Invoice sent"}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl"
      >
        <div
          className={
            "mx-auto flex h-14 w-14 items-center justify-center rounded-full " +
            (bad ? "bg-amber-100" : "bg-emerald-100")
          }
        >
          {bad ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 8v5" /><path d="M12 17h.01" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5.5 5.5L20 7" />
            </svg>
          )}
        </div>

        <h2 className="mt-4 text-xl font-bold tracking-tight text-zinc-900">
          {bad ? `Invoice ${no} was NOT emailed` : `Invoice ${no} sent`}
        </h2>

        {bad ? (
          <>
            <p className="mt-2 text-sm text-zinc-700">
              It has been filed and marked as sent, but the email didn&apos;t go. The customer
              hasn&apos;t received anything — send it again, or ring them.
            </p>
            <p className="mt-3 break-words rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">{problem}</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-zinc-700">
              Emailed to <span className="font-medium text-zinc-900">{to}</span>
            </p>
            {total != null && (
              <p className="mt-1 text-sm text-zinc-500">{money(total)} incl GST</p>
            )}
            {copyTo && (
              <p className="mt-2 text-xs text-zinc-500">A copy has gone to {copyTo}</p>
            )}
            {extra && <p className="mt-2 text-xs text-zinc-500">{extra}</p>}
          </>
        )}

        <button
          ref={okRef}
          onClick={onClose}
          className={
            "mt-5 w-full rounded-lg px-4 py-2.5 font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 " +
            (bad
              ? "bg-amber-600 hover:bg-amber-700 focus:ring-amber-300"
              : "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-300")
          }
        >
          {bad ? "I'll deal with it" : "Done"}
        </button>
      </div>
    </div>
  );
}
