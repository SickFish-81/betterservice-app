"use client";

// An address you can tap to get directions.
//
// Shown on the job card and on customer records. A printed address is
// something a person has to retype into their phone one-handed, usually while
// holding something else — so every address the app displays is a link.
//
// NOT the same thing as the address SUGGESTIONS in AddressInput.js: this is a
// plain hyperlink. It calls no API, needs no key, costs nothing, and keeps
// working if the Places key is ever removed or runs out of quota.
//
// The URL shape is deliberately identical to the one send-dispatch puts in a
// pick-up notification, so the link Craig taps in the app and the button he
// taps on his phone go to exactly the same place. That function has its own
// copy because an edge function cannot import from here — if you change the
// shape, change it in BOTH. See supabase/functions/send-dispatch/index.ts.
//
// `dir` rather than `search`: the useful action for a workshop is "how do I
// get there", not "where is it". On a phone this opens the Maps app itself
// rather than a web page you then have to tap through.

export const mapsUrl = (address) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

export default function AddressLink({ address, className = "" }) {
  const a = String(address ?? "").trim();
  if (!a) return null;
  return (
    <a
      href={mapsUrl(a)}
      target="_blank"
      rel="noreferrer"
      title="Open directions in Google Maps"
      className={`underline decoration-zinc-300 underline-offset-2 hover:text-red-700 hover:decoration-red-400 ${className}`}
    >
      {a}
    </a>
  );
}
