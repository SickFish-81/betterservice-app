"use client";

// One box for the whole shop. A mechanic with a bike in front of him knows the
// rego, or the customer's name, or the job number — not which section of the
// app it lives in. Everything searchable is searched at once and grouped after.
//
// All of this runs as the signed-in user, so row level security decides what
// comes back: no new way into the data, just a faster way to the same rows.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const nzDate = (d) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-NZ", { timeZone: "UTC" }) : "");
const invNo = (n) => "#" + String(n).padStart(5, "0");

// PostgREST reads an .or() filter as comma-separated syntax, so a comma or a
// bracket typed into the box would be parsed as structure rather than text.
// Strip the few characters that mean something to it before building a filter.
const clean = (s) => s.replace(/[,()"'\\%*]/g, " ").replace(/\s+/g, " ").trim();

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

// Craig types a date the way he says it. Accept 1/9/26, 01-09-2026, 2026-09-14,
// 2026-09 (whole month) and "september 2026". Returns [from, to] or null.
function dateRange(raw) {
  const q = raw.trim().toLowerCase();
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  let m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return [iso(+m[1], +m[2], +m[3]), iso(+m[1], +m[2], +m[3])];

  m = q.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return [iso(+m[1], +m[2], 1), iso(+m[1], +m[2], lastDay(+m[1], +m[2]))];

  // Day first — the way it's written in New Zealand.
  m = q.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return [iso(y, +m[2], +m[1]), iso(y, +m[2], +m[1])];
  }

  m = q.match(/^([a-z]+)\s*(\d{4})?$/);
  if (m) {
    const mi = MONTHS.findIndex((n) => n.startsWith(m[1]) && m[1].length >= 3);
    if (mi >= 0) {
      const y = m[2] ? +m[2] : new Date().getFullYear();
      return [iso(y, mi + 1, 1), iso(y, mi + 1, lastDay(y, mi + 1))];
    }
  }
  return null;
}

function Section({ title, count, children }) {
  if (!count) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}<span className="font-normal normal-case tracking-normal text-zinc-400">({count})</span>
      </h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({ href, lead, main, sub, right }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition hover:border-red-300 hover:bg-red-50/40">
      {lead && <span className="w-16 shrink-0 text-sm font-semibold text-zinc-800">{lead}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900">{main}</span>
        {sub && <span className="block truncate text-xs text-zinc-500">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-sm text-zinc-600">{right}</span>}
    </Link>
  );
}

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get("q") || "");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const runId = useRef(0);

  useEffect(() => { box.current?.focus(); }, []);

  const search = useCallback(async (raw) => {
    const term = clean(raw);
    if (term.length < 2) { setRes(null); setBusy(false); return; }

    // Results come back out of order; only the newest run may paint, or a slow
    // early query overwrites what the user is looking at now.
    const mine = ++runId.current;
    setBusy(true); setError(null);

    const like = `%${term}%`;
    const num = /^\d+$/.test(term) ? Number(term) : null;
    const range = dateRange(raw);

    try {
      const [cRes, mRes, jRes, pRes] = await Promise.all([
        supabase.from("customers")
          .select("id,name,company_name,phone,email")
          .or(`name.ilike.${like},company_name.ilike.${like},phone.ilike.${like},email.ilike.${like},address.ilike.${like}`)
          .order("name").limit(25),
        supabase.from("machines")
          .select("id,customer_id,type,make,model,year,rego,vin,customers(name)")
          .or(`make.ilike.${like},model.ilike.${like},type.ilike.${like},rego.ilike.${like},vin.ilike.${like},key_number.ilike.${like}`)
          .limit(25),
        supabase.from("job_cards")
          .select("id,job_number,status,reported_problem,customers(name),machines(make,model)")
          .or(
            `reported_problem.ilike.${like},notes.ilike.${like},customer_notes.ilike.${like}` +
            (num !== null ? `,job_number.eq.${num}` : "")
          )
          .order("job_number", { ascending: false }).limit(25),
        supabase.from("parts")
          .select("id,sku,name,unit_price,qty_on_hand")
          .or(`sku.ilike.${like},name.ilike.${like},description.ilike.${like}`)
          .limit(25),
      ]);

      const err = cRes.error || mRes.error || jRes.error || pRes.error;
      if (err) throw err;

      const customers = cRes.data || [];
      const machines = mRes.data || [];
      const jobs = jRes.data || [];
      const parts = pRes.data || [];

      // Invoices are reachable three ways: by their number, by the date they
      // were issued, and by whose they are — so a name typed in the box finds
      // the customer AND their invoices.
      const custIds = customers.map((c) => c.id);
      const sel = "id,invoice_number,kind,status,total,issued_date,customer_id,job_card_id,customers(name)";
      const invQueries = [];
      if (num !== null) invQueries.push(supabase.from("invoices").select(sel).eq("invoice_number", num));
      if (range) invQueries.push(supabase.from("invoices").select(sel).gte("issued_date", range[0]).lte("issued_date", range[1]).order("invoice_number", { ascending: false }).limit(50));
      if (custIds.length) {
        invQueries.push(supabase.from("invoices").select(sel).in("customer_id", custIds).limit(50));
        const { data: jc } = await supabase.from("job_cards").select("id").in("customer_id", custIds).limit(200);
        const jcIds = (jc || []).map((r) => r.id);
        if (jcIds.length) invQueries.push(supabase.from("invoices").select(sel).in("job_card_id", jcIds).limit(50));
      }
      const invParts = invQueries.length ? await Promise.all(invQueries) : [];

      const seen = new Map();
      for (const r of invParts) for (const row of r.data || []) seen.set(row.id, row);
      const invoices = [...seen.values()].sort((a, b) => b.invoice_number - a.invoice_number).slice(0, 25);

      if (mine !== runId.current) return;
      setRes({ term, customers, machines, jobs, invoices, parts });
    } catch (e) {
      if (mine === runId.current) setError(e.message || String(e));
    } finally {
      if (mine === runId.current) setBusy(false);
    }
  }, []);

  // Wait for a pause in typing before hitting the database, and keep the URL in
  // step so a search can be bookmarked, shared or reached with the back button.
  useEffect(() => {
    const t = setTimeout(() => {
      search(q);
      const next = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(next, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [q, search, router]);

  const total = res ? res.customers.length + res.machines.length + res.jobs.length + res.invoices.length + res.parts.length : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Search</h1>
      <p className="mt-1 text-zinc-600">Customers, machines, job cards, invoices and parts — all at once.</p>

      <div className="sticky top-14 z-10 -mx-4 mt-4 bg-zinc-50/95 px-4 py-3 backdrop-blur">
        <input
          ref={box}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, rego, phone, job or invoice number, 1/9/26…"
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-lg text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
        />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">Search failed: {error}</p>}

      {clean(q).length < 2 ? (
        <div className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">
          <p className="font-medium text-zinc-700">Type at least two characters.</p>
          <p className="mt-2">You can search by customer or business name, phone, email, rego, VIN, key number, make or model, what the customer reported, a job or invoice number, or a part name or SKU.</p>
          <p className="mt-2">Dates work too — <span className="font-mono text-zinc-700">1/9/26</span>, <span className="font-mono text-zinc-700">2026-09-14</span>, <span className="font-mono text-zinc-700">2026-09</span> or <span className="font-mono text-zinc-700">september</span> — and find the invoices issued then.</p>
        </div>
      ) : busy && !res ? (
        <p className="mt-8 text-zinc-500">Searching…</p>
      ) : total === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">
          Nothing matches “{q.trim()}”.
        </p>
      ) : (
        <>
          <Section title="Customers" count={res.customers.length}>
            {res.customers.map((c) => (
              <Row key={c.id} href={`/customers/${c.id}`}
                main={c.company_name ? `${c.company_name} · ${c.name}` : c.name}
                sub={[c.phone, c.email].filter(Boolean).join("  ·  ")} />
            ))}
          </Section>

          <Section title="Machines" count={res.machines.length}>
            {res.machines.map((m) => (
              <Row key={m.id} href={m.customer_id ? `/customers/${m.customer_id}` : "/machines"}
                main={[m.year, m.make, m.model].filter(Boolean).join(" ") || m.type}
                sub={[m.type, m.rego && `rego ${m.rego}`, m.customers?.name].filter(Boolean).join("  ·  ")} />
            ))}
          </Section>

          <Section title="Job cards" count={res.jobs.length}>
            {res.jobs.map((j) => (
              <Row key={j.id} href={`/jobs/${j.id}`} lead={`#${j.job_number}`}
                main={[j.customers?.name, [j.machines?.make, j.machines?.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                sub={j.reported_problem} right={j.status} />
            ))}
          </Section>

          <Section title="Invoices" count={res.invoices.length}>
            {res.invoices.map((i) => (
              <Row key={i.id} href={`/invoices/${i.id}`} lead={invNo(i.invoice_number)}
                main={i.customers?.name || (i.kind === "rental" ? "Rent" : "Job invoice")}
                sub={`${nzDate(i.issued_date)}  ·  ${i.status}`} right={money(i.total)} />
            ))}
          </Section>

          <Section title="Parts" count={res.parts.length}>
            {res.parts.map((p) => (
              <Row key={p.id} href="/parts" lead={p.sku} main={p.name}
                sub={`${p.qty_on_hand ?? 0} on hand`} right={money(p.unit_price)} />
            ))}
          </Section>
        </>
      )}
    </main>
  );
}

// useSearchParams needs a Suspense boundary above it, or the build fails.
export default function SearchPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>}>
      <SearchInner />
    </Suspense>
  );
}
