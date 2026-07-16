"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const CATEGORY_ORDER = ["ATV / 4 Wheeler", "Side by Side", "2 Wheeler", "Other"];

export default function ForSalePage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [idx, setIdx] = useState(0);

  // Listings and photos are fetched separately and grouped in JS by
  // listing_id, rather than relying on a nested `*, secondhand_photos(*)`
  // select — that depends on PostgREST auto-detecting the foreign key.
  async function load() {
    setLoading(true);
    setError(null);

    const { data: ls, error: lErr } = await supabase
      .from("secondhand_listings")
      .select("*")
      .eq("status", "Available")
      .order("price", { ascending: false });
    if (lErr) { setError(lErr.message); setLoading(false); return; }

    const { data: ph, error: pErr } = await supabase
      .from("secondhand_photos")
      .select("*")
      .order("created_at");
    if (pErr) { setError(pErr.message); setLoading(false); return; }

    const withPhotos = (ls || []).map((l) => ({
      ...l,
      photos: (ph || []).filter((p) => p.listing_id === l.id),
    }));
    setListings(withPhotos);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Group listings into categories; anything without a known category falls under "Other".
  const groups = {};
  listings.forEach((l) => {
    const cat = CATEGORY_ORDER.includes(l.category) ? l.category : "Other";
    (groups[cat] = groups[cat] || []).push(l);
  });
  const sections = CATEGORY_ORDER.filter((c) => groups[c] && groups[c].length);

  const photos = selected ? selected.photos : [];
  const openListing = (l) => { setSelected(l); setIdx(0); };
  const closeListing = () => setSelected(null);
  const prev = () => setIdx((i) => (i - 1 + photos.length) % photos.length);
  const next = () => setIdx((i) => (i + 1) % photos.length);

  // Keyboard: Esc to close, arrows to move through photos.
  useEffect(() => {
    if (!selected) return;
    function onKey(e) {
      if (e.key === "Escape") closeListing();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, photos.length]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">Used Machines For Sale</h1>
          <p className="mt-2 text-zinc-600">Quality-checked and work-ready. MTF finance and trades welcome. Tap a machine for more photos and details.</p>
        </div>
        <a
          href="tel:02108327787"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-center font-medium text-white transition hover:bg-red-700"
        >
          Call or text Craig · 021 08327787
        </a>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-center">
        <span className="text-sm font-medium text-zinc-600">Finance available with</span>
        <img src="/mtf-finance.png" alt="MTF Finance" className="h-7 w-auto sm:h-8" />
      </div>

      {error && <p className="mt-6 text-sm text-red-600">Error: {error}</p>}

      {loading ? (
        <p className="mt-8 text-zinc-500">Loading…</p>
      ) : listings.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          No machines listed right now — check back soon, or call Craig on 021 08327787.
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-12">
          {sections.map((cat) => (
            <section key={cat}>
              <h2 className="mb-4 text-xl font-bold tracking-tight text-zinc-900">
                {cat}
                <span className="ml-2 text-sm font-normal text-zinc-400">({groups[cat].length})</span>
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
                {groups[cat].map((listing) => {
                  const cover = listing.photos[0];
                  return (
                    <button
                      key={listing.id}
                      onClick={() => openListing(listing)}
                      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <div className="relative">
                        {cover ? (
                          <img src={cover.url} alt={listing.title} className="h-40 w-full object-cover sm:h-48" />
                        ) : (
                          <div className="flex h-40 w-full items-center justify-center bg-zinc-100 sm:h-48">
                            <span className="text-sm text-zinc-500">No photo</span>
                          </div>
                        )}
                        {listing.photos.length > 1 && (
                          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                            {listing.photos.length} photos
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="font-semibold text-zinc-900">{listing.title}</p>
                        <p className="mt-1 font-bold text-red-700">{money(listing.price)}</p>
                        {listing.description && (
                          <p className="mt-2 line-clamp-2 text-sm text-zinc-600">{listing.description}</p>
                        )}
                        <span className="mt-2 inline-block text-xs font-medium text-red-600 group-hover:underline">View photos &amp; details →</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6" onClick={closeListing}>
          <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={closeListing}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-lg text-white hover:bg-black/80"
            >
              ×
            </button>

            <div className="relative flex items-center justify-center bg-zinc-900">
              {photos.length > 0 ? (
                <img src={photos[idx].url} alt={selected.title} className="max-h-[55vh] w-full object-contain" />
              ) : (
                <div className="flex h-64 w-full items-center justify-center text-zinc-400">No photos</div>
              )}
              {photos.length > 1 && (
                <>
                  <button onClick={prev} aria-label="Previous" className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white hover:bg-black/70">‹</button>
                  <button onClick={next} aria-label="Next" className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-2xl text-white hover:bg-black/70">›</button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{idx + 1} / {photos.length}</div>
                </>
              )}
            </div>

            {photos.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-b border-zinc-100 p-2">
                {photos.map((p, i) => (
                  <img
                    key={p.id}
                    src={p.url}
                    alt=""
                    onClick={() => setIdx(i)}
                    className={`h-14 w-14 shrink-0 cursor-pointer rounded object-cover ${i === idx ? "ring-2 ring-red-600" : "opacity-70 hover:opacity-100"}`}
                  />
                ))}
              </div>
            )}

            <div className="overflow-y-auto p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-xl font-bold tracking-tight text-zinc-900">{selected.title}</h3>
                <p className="shrink-0 text-xl font-bold text-red-700">{money(selected.price)}</p>
              </div>
              {selected.description && (
                <p className="mt-3 whitespace-pre-line text-sm text-zinc-700">{selected.description}</p>
              )}
              <a href="tel:02108327787" className="mt-4 inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700">
                Call or text Craig · 021 08327787
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
