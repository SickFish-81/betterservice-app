// Shared pieces for FLIP trade orders: the dashboard half of a sale Craig
// enters himself, at trade prices, instead of a customer paying on the shop.
//
// The money rules live in the database (create_flip_trade_order) and the
// freight cost lives on flipbikes.co.nz (/api/trade). This file only talks to
// them; nothing here decides a price a customer is charged.

import { supabase } from "./supabaseClient";

// Where the Flipbikes API is. The live shop unless a preview deployment is
// being tested, in which case NEXT_PUBLIC_FLIP_API_BASE points at it (and that
// deployment's FLIP_TRADE_ORIGINS has to let this app in).
export const FLIP_API_BASE = (process.env.NEXT_PUBLIC_FLIP_API_BASE || "https://www.flipbikes.co.nz").replace(/\/+$/, "");

export const money = (cents) =>
  (cents < 0 ? "-$" : "$") + (Math.abs(Number(cents || 0)) / 100).toFixed(2);

// "$90", "90", "90.5", "1,250.00" -> cents. Anything else -> null, so a typo
// is refused rather than read as something else.
export function parseCents(text) {
  const s = String(text ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export const centsToInput = (cents) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);

// Same as the database: GST once, on the whole ex-GST total, rounded.
export const gstOn = (exCents) => Math.round(exCents * 0.15);

// Today's date in New Zealand as YYYY-MM-DD. en-CA formats that way.
export const nzToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });

// The 20th of next month, NZ trade's usual terms. Built from the NZ calendar
// date as plain numbers — never through a Date in the browser's timezone,
// which is how a due date ends up a day out.
export function twentiethOfNextMonth(todayIso = nzToday()) {
  const [y, m] = todayIso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-20`;
}

// "2026-12-20" -> "20 Dec 2026", without a timezone getting a say.
export function plainDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

// POST to /api/trade as the signed-in owner. Flipbikes checks the token with
// the database's own is_owner(), so this only works for an owner.
export async function tradeApi(body) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { ok: false, status: 401, error: "You're signed out. Sign in again and retry." };

  let res;
  try {
    res = await fetch(`${FLIP_API_BASE}/api/trade`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach flipbikes.co.nz. Check the connection and try again." };
  }
  let json = {};
  try { json = await res.json(); } catch { /* an error page, not JSON */ }
  if (!res.ok) return { ok: false, status: res.status, error: json.error || `flipbikes.co.nz answered ${res.status}.`, ...json };
  return { ok: true, status: res.status, ...json };
}
