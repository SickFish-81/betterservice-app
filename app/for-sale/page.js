"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const CATEGORY_ORDER = ["ATV / 4 Wheeler", "Side by Side", "2 Wheeler", "Other"];

export default function ForSalePage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Listings and photos are fetched separately and grouped in JS by
  // listing_id, rather than relying on a nested `*, secondhand_photos(*)`
  // select — that depends on PostgREST auto-detecting the foreign key,
  // which isn't something that can be verified from outside a live project.
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900">Used Machines For Sale</h1>
          <p className="mt-2 text-zinc-600">Quality-checked and work-ready. MTF finance and trades welcome.</p>
        </div>
        <a
          href="tel:02108327787"
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-red-600 px-4 py-2.5 text-center font-medium text-white transition hover:bg-red-700"
        >
          Call or text Craig · 021 08327787
        </a>
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
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {groups[cat].map((listing) => {
                  const cover = listing.photos[0];
                  return (
                    <div key={listing.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                      {cover ? (
                        <img src={cover.url} alt={listing.title} className="h-48 w-full object-cover" />
                      ) : (
                        <div className="flex h-48 w-full items-center justify-center bg-zinc-100">
                          <span className="text-sm text-zinc-500">No photo</span>
                        </div>
                      )}
                      <div className="p-4">
                        <p className="font-semibold text-zinc-900">{listing.title}</p>
                        <p className="mt-1 font-bold text-red-700">{money(listing.price)}</p>
                        {listing.description && (
                          <p className="mt-2 line-clamp-3 text-sm text-zinc-600">{listing.description}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
