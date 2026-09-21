"use client";

// An address box that suggests real addresses, and a perfectly ordinary text
// box whenever it can't.
//
// ---------------------------------------------------------------------------
// COST, first, because this is the second paid service this project has looked
// at and the first one cost $35 and never sent a single message.
//
// Google's free allowance is 5,000 autocomplete events a month. The shop adds
// well under a hundred customers a month, so normal use sits at roughly 1% of
// free. That is the headroom, not the plan — the plan is the four guards below,
// which are what make a runaway bill difficult rather than merely unlikely:
//
//   1. The Google script is fetched only when someone FOCUSES an address box.
//      Opening the customers page, the job card, or anything else costs
//      nothing. A day where nobody types an address is a day with zero calls.
//   2. Nothing is asked until 5 characters are typed, and then only after a
//      350ms pause. A 20-character address costs about 2 requests instead of
//      20 — an order of magnitude, for one line of debounce.
//   3. One session token per address being entered. Google bills a session,
//      not each keystroke; the token is renewed after each pick so sessions
//      can't merge into something unbounded.
//   4. We take the suggestion's own text and NEVER call Place Details. That is
//      a second, separately billed product, and the suggestion already
//      contains the full address we want.
//
// The remaining guards are not in this file and cannot be: restrict the API
// key to betterservice.co.nz, and set a daily quota cap in the Google Cloud
// console. A key without those is a key anyone can lift from the page and
// spend. See OPERATIONS.md.
// ---------------------------------------------------------------------------
//
// AND IF GOOGLE ISN'T THERE: no key, script blocked, quota hit, offline, or
// Google simply down — this renders the plain input it replaced and the shop
// carries on. Address entry never depends on a third party being up. That is
// deliberate and should stay that way.

import { useEffect, useRef, useState } from "react";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

const MIN_CHARS = 5;     // below this, nothing is asked
const DEBOUNCE_MS = 350; // a pause, not a keystroke, triggers a lookup

// Load the Maps script once per page, on demand. Returns the places library,
// or null — callers must cope with null rather than assume.
let loader = null;
function loadPlaces() {
  if (!KEY) return Promise.resolve(null);
  if (loader) return loader;
  loader = new Promise((resolve) => {
    if (window.google?.maps?.importLibrary) {
      window.google.maps.importLibrary("places").then(resolve).catch(() => resolve(null));
      return;
    }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&libraries=places&loading=async&language=en-NZ&region=NZ`;
    s.async = true;
    s.onload = () =>
      window.google?.maps?.importLibrary
        ? window.google.maps.importLibrary("places").then(resolve).catch(() => resolve(null))
        : resolve(null);
    s.onerror = () => resolve(null);   // blocked, offline, bad key — plain box
    document.head.appendChild(s);
  });
  return loader;
}

export default function AddressInput({ value, onChange, onBlur, placeholder, className }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const places = useRef(null);
  const token = useRef(null);
  const timer = useRef(null);
  const box = useRef(null);

  // Nothing is fetched until the box is touched.
  async function warmUp() {
    if (places.current) return;
    places.current = await loadPlaces();
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  // Close the list when the focus leaves the whole control, not just the input,
  // or picking a suggestion with the mouse would dismiss the list first.
  useEffect(() => {
    function away(e) {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  function typed(text) {
    onChange(text);
    clearTimeout(timer.current);
    if (text.trim().length < MIN_CHARS) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        // Wait for the library HERE rather than giving up if it hasn't loaded.
        // It starts loading on focus, but a fast typist - or anyone pasting an
        // address - gets here first, and the old code silently dropped that
        // input with no retry: you typed a whole address and nothing happened.
        // loadPlaces() is memoised, so this is a no-op once it has resolved.
        if (!places.current) places.current = await loadPlaces();
        if (!places.current) return;   // no key, blocked, offline: stay a plain box
        const { AutocompleteSessionToken, AutocompleteSuggestion } = places.current;
        if (!token.current) token.current = new AutocompleteSessionToken();
        const { suggestions: got } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: text,
          sessionToken: token.current,
          includedRegionCodes: ["nz"],   // a Te Puke pick-up is not in Nebraska
          language: "en-NZ",
          region: "nz",
        });
        const list = (got || [])
          .map((s) => s.placePrediction?.text?.toString())
          .filter(Boolean)
          .slice(0, 5);
        setSuggestions(list);
        setOpen(list.length > 0);
      } catch (_e) {
        // Quota, network, key problem — stop suggesting, keep typing.
        setSuggestions([]); setOpen(false);
      }
    }, DEBOUNCE_MS);
  }

  function pick(text) {
    onChange(text);
    setSuggestions([]); setOpen(false);
    token.current = null;              // this session is over; the next is new
    onBlur?.({ target: { value: text } });
  }

  return (
    <div ref={box} className="relative">
      <input
        value={value}
        onFocus={warmUp}
        onChange={(e) => typed(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s}>
              {/* onMouseDown, not onClick: mousedown fires before the input's
                  blur, so the pick lands instead of the list vanishing. */}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
