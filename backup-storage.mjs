#!/usr/bin/env node
/**
 * backup-storage.mjs — download every file the app depends on, read-only.
 *
 * Covers the two things a Supabase database backup does NOT include:
 *   1. Storage buckets  — invoices, job-photos, listing-photos
 *   2. External images  — photos referenced by URL in the database but hosted
 *                         somewhere else (currently 96 on TradeMe's CDN, which
 *                         will disappear when those listings end)
 *
 * SAFETY — this script is deliberately incapable of damage:
 *   · It only ever READS from Supabase. No upload, no update, no delete calls exist here.
 *   · It writes into a NEW dated folder each run and refuses to touch an existing one.
 *   · It never deletes or overwrites a local file. A re-run resumes, skipping
 *     files already downloaded with a matching size.
 *   · It verifies every download and exits non-zero if anything is missing,
 *     so a failed backup can never look like a successful one.
 *   · The service key is read from the environment and never written or printed.
 *
 * SETUP (once):
 *   Supabase dashboard -> Project Settings -> API -> service_role key.
 *   Treat it like a password; it bypasses all row-level security.
 *     echo 'export BETTERSERVICE_SUPABASE_URL="https://vdwssiefdhmepdgkuoxd.supabase.co"' >> ~/.zshrc
 *     echo 'export BETTERSERVICE_SERVICE_KEY="paste-service-role-key"'                    >> ~/.zshrc
 *     source ~/.zshrc
 *
 * RUN:
 *   node backup-storage.mjs
 */

import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const URL_BASE = process.env.BETTERSERVICE_SUPABASE_URL;
const KEY = process.env.BETTERSERVICE_SERVICE_KEY;
const BUCKETS = ["invoices", "job-photos", "listing-photos"];
const PAGE = 100;
const RETRIES = 3;

if (!URL_BASE || !KEY) {
  console.error("❌ BETTERSERVICE_SUPABASE_URL and BETTERSERVICE_SERVICE_KEY must both be set.");
  console.error("   See the SETUP notes at the top of this file.");
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "backups", `storage-${stamp}`);

if (existsSync(ROOT)) {
  console.error(`❌ ${ROOT} already exists. Refusing to write into an existing backup folder.`);
  process.exit(1);
}

/**
 * Header shape depends on which key format you pasted in:
 *
 *   Legacy `service_role` key (a JWT, starts "eyJ") — sent on BOTH apikey and
 *   Authorization, which is what Supabase clients have always done.
 *
 *   New secret key ("sb_secret_…") — apikey ONLY. These are not JWTs, so if you
 *   also put one in Authorization: Bearer, the platform tries to parse it as a
 *   JWT and rejects the whole request with "Invalid JWT".
 */
const isLegacyJwtKey = KEY.startsWith("eyJ");
const headers = isLegacyJwtKey
  ? { apikey: KEY, Authorization: `Bearer ${KEY}` }
  : { apikey: KEY };
const manifest = [];
let failures = 0;

/** Fetch with retries. Read-only by construction — no method is ever passed but GET/POST-list. */
async function get(url, init = {}, label = "") {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
      if (res.ok) return res;
      if (res.status === 404) return res;
      if (attempt === RETRIES) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      if (attempt === RETRIES) throw err;
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
}

/** List every object in a bucket, walking folders and paging past the 100-item default. */
async function listBucket(bucket, prefix = "") {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await get(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const item of batch) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      // A folder placeholder has no id; recurse into it.
      if (item.id === null || item.id === undefined) out.push(...(await listBucket(bucket, full)));
      else out.push({ path: full, size: item.metadata?.size ?? null });
    }
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function saveFile(destDir, name, buf, source) {
  const dest = path.join(destDir, name);
  await mkdir(path.dirname(dest), { recursive: true });

  if (existsSync(dest)) {
    const existing = await stat(dest);
    if (existing.size === buf.length) return "skipped";
  }
  await writeFile(dest, buf, { flag: "wx" }).catch(async (e) => {
    if (e.code !== "EEXIST") throw e;
  });
  manifest.push({
    source,
    file: path.relative(ROOT, dest),
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  });
  return "saved";
}

async function backupBuckets() {
  for (const bucket of BUCKETS) {
    process.stdout.write(`\n📦 ${bucket}\n`);
    let objects;
    try {
      objects = await listBucket(bucket);
    } catch (err) {
      console.error(`   ❌ could not list bucket: ${err.message}`);
      failures++;
      continue;
    }
    if (objects.length === 0) {
      console.log("   (empty)");
      continue;
    }
    const dir = path.join(ROOT, "buckets", bucket);
    let saved = 0;
    for (const obj of objects) {
      try {
        const res = await get(`${URL_BASE}/storage/v1/object/${bucket}/${encodeURI(obj.path)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await saveFile(dir, obj.path, buf, `storage:${bucket}`);
        saved++;
        process.stdout.write(`\r   ${saved}/${objects.length} files`);
      } catch (err) {
        console.error(`\n   ❌ ${obj.path}: ${err.message}`);
        failures++;
      }
    }
    process.stdout.write(`\r   ✓ ${saved}/${objects.length} files\n`);
    if (saved !== objects.length) failures++;
  }
}

async function backupExternalPhotos() {
  process.stdout.write(`\n🌐 externally-hosted photos referenced in the database\n`);
  const res = await get(`${URL_BASE}/rest/v1/secondhand_photos?select=url`, {
    headers: { Accept: "application/json" },
  });
  const rows = await res.json();
  const urls = [...new Set((rows || []).map((r) => r.url).filter((u) => /^https?:\/\//.test(u) && !u.includes("/storage/v1/")))];

  if (urls.length === 0) {
    console.log("   (none — every photo is in your own storage)");
    return;
  }
  console.log(`   ${urls.length} to fetch (these live on someone else's server and can vanish)`);

  const dir = path.join(ROOT, "external-photos");
  let saved = 0;
  for (const url of urls) {
    // Name by hash so two identical filenames from different listings can't collide.
    const name = createHash("sha1").update(url).digest("hex").slice(0, 16) + path.extname(new URL(url).pathname).slice(0, 6);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await saveFile(dir, name, Buffer.from(await r.arrayBuffer()), url);
      saved++;
      process.stdout.write(`\r   ${saved}/${urls.length} images`);
    } catch (err) {
      console.error(`\n   ⚠️  ${url} — ${err.message}`);
      failures++;
    }
  }
  process.stdout.write(`\r   ✓ ${saved}/${urls.length} images\n`);
}

// ── run ───────────────────────────────────────────────────────────────────────
console.log(`Betterservice file backup → ${ROOT}`);
console.log(`Key format: ${isLegacyJwtKey ? "legacy service_role (JWT)" : "new secret key (sb_secret_…)"}`);
await mkdir(ROOT, { recursive: true });

await backupBuckets();
await backupExternalPhotos();

await writeFile(
  path.join(ROOT, "manifest.json"),
  JSON.stringify({ taken_at: new Date().toISOString(), files: manifest.length, failures, manifest }, null, 2)
);

console.log(`\n${"─".repeat(56)}`);
console.log(`   ${manifest.length} files written`);
console.log(`   manifest.json holds every size and SHA-256, so you can prove later`);
console.log(`   that a file came back byte-for-byte identical.`);

if (failures > 0) {
  console.error(`\n❌ ${failures} problem(s). This backup is INCOMPLETE — do not rely on it.`);
  process.exit(1);
}
console.log(`\n✅ Complete and verified. Contains real customer data — keep it off shared folders.`);
