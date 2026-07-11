"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const money = (n) => "$" + Number(n || 0).toFixed(2);

export default function SecondhandPage() {
  const [listings, setListings] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [uploadingId, setUploadingId] = useState(null);
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
      .order("created_at", { ascending: false });
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

  async function addListing(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase.from("secondhand_listings").insert({
      title, description: description || null, price: Number(price || 0), status: "Available",
    });
    if (error) { setError(error.message); return; }
    setTitle(""); setDescription(""); setPrice(""); load();
  }

  async function toggleStatus(listing) {
    const next = listing.status === "Sold" ? "Available" : "Sold";
    const { error } = await supabase.from("secondhand_listings").update({ status: next }).eq("id", listing.id);
    if (error) { setError(error.message); return; }
    load();
  }

  async function removeListing(listing) {
    if (!window.confirm("Remove this listing?")) return;
    const paths = (listing.photos || []).map((p) => p.path).filter(Boolean);
    if (paths.length) await supabase.storage.from("listing-photos").remove(paths);
    const { error } = await supabase.from("secondhand_listings").delete().eq("id", listing.id);
    if (error) { setError(error.message); return; }
    load();
  }

  async function uploadPhoto(listing, e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadingId(listing.id); setError(null);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = listing.id + "/" + Date.now() + "-" + safe;
    const { error: upErr } = await supabase.storage.from("listing-photos").upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) { setError("Photo upload failed: " + upErr.message); setUploadingId(null); return; }
    const { data: pub } = supabase.storage.from("listing-photos").getPublicUrl(path);
    await supabase.from("secondhand_photos").insert({ listing_id: listing.id, url: pub.publicUrl, path });
    setUploadingId(null); e.target.value = ""; load();
  }

  async function removePhoto(photo) {
    if (photo.path) await supabase.storage.from("listing-photos").remove([photo.path]);
    await supabase.from("secondhand_photos").delete().eq("id", photo.id);
    load();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">For sale</h1>
      <p className="mt-1 text-zinc-600">Second-hand machines for sale — photos and details for the website showcase.</p>

      <form onSubmit={addListing} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. 2018 Honda CRF250L)" className={input} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Description" className={input} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" placeholder="Price" className={input} />
        <button type="submit" className={btn}>Add listing</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6 flex flex-col gap-4">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : listings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No listings yet. Add your first one above.</p>
        ) : (
          listings.map((listing) => (
            <div key={listing.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">{listing.title}</p>
                  <p className="text-sm text-zinc-500">{money(listing.price)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${listing.status === "Sold" ? "bg-zinc-100 text-zinc-600" : "bg-emerald-50 text-emerald-700"}`}>
                  {listing.status}
                </span>
              </div>

              {listing.description && <p className="mt-2 text-sm text-zinc-600">{listing.description}</p>}

              {listing.photos.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {listing.photos.map((p) => (
                    <div key={p.id} className="group relative">
                      <img src={p.url} alt={listing.title} className="h-24 w-full rounded-lg object-cover" />
                      <button onClick={() => removePhoto(p)} className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100">×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                  {uploadingId === listing.id ? "Uploading…" : "Add photo"}
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => uploadPhoto(listing, e)} className="hidden" disabled={uploadingId === listing.id} />
                </label>
                <button onClick={() => toggleStatus(listing)} className="text-xs font-medium text-zinc-600 hover:underline">
                  Mark as {listing.status === "Sold" ? "Available" : "Sold"}
                </button>
                <button onClick={() => removeListing(listing)} className="text-xs text-red-500 hover:underline">remove</button>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
