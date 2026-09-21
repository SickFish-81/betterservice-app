"use client";

// A phone number you can ring, and an email you can write to, straight from
// wherever the app happens to be showing them.
//
// Same reasoning as AddressLink: the workshop runs off a phone and an iPad,
// often one-handed, often with a bike in the way. A number printed as plain
// text is a number somebody reads off one screen and types into another, and
// gets wrong the third time.
//
// The number is DISPLAYED exactly as Craig typed it — "027 370 5669", spaces
// and all — but DIALLED from a cleaned version, because tel: chokes on spaces
// and brackets. Display for humans, dial for the phone. Never "tidy up" what
// is shown: how he writes a number is how he recognises it.
//
// There was already a tel: link on the bookings page. This is that idea made
// shared, so the next screen that shows a phone number gets it for free
// instead of being the one place that forgot.

// Keep a leading + (international), drop everything else that isn't a digit.
//
// An extension is cut off first, and that is not fussiness: "07-573 1234 ext 2"
// with the punctuation merely stripped becomes 0757312342, which is a real
// phone number belonging to somebody else. A link that dials a stranger is
// worse than no link — so the extension goes, and whoever is calling can hear
// the greeting and key it in, the way they would from a business card.
export const telHref = (phone) => {
  const s = String(phone ?? "").trim().replace(/\s*(?:ext|extn|x)\.?\s*\d+\s*$/i, "");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${s.startsWith("+") ? "+" : ""}${digits}`;
};

const linkClass =
  "underline decoration-zinc-300 underline-offset-2 hover:text-red-700 hover:decoration-red-400";

export function PhoneLink({ phone, className = "" }) {
  const shown = String(phone ?? "").trim();
  const href = telHref(shown);
  if (!shown) return null;
  if (!href) return <>{shown}</>;   // no digits at all: show it, don't fake a link
  return (
    <a href={href} title={`Call ${shown}`} className={`${linkClass} ${className}`}>
      {shown}
    </a>
  );
}

export function EmailLink({ email, className = "" }) {
  const shown = String(email ?? "").trim();
  if (!shown) return null;
  return (
    <a href={`mailto:${shown}`} title={`Email ${shown}`} className={`${linkClass} ${className}`}>
      {shown}
    </a>
  );
}
