// sitemap.xml, served by Next at /sitemap.xml.
//
// Only the pages a customer should land on. /flip-recessed-bike-mounts is here
// even though it isn't in the nav — it's unlinked, not hidden, and it needs to
// stay indexed to keep the ranking the old .php URL earned.
const BASE = "https://betterservice.co.nz";

export default function sitemap() {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/for-sale`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/book`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/batteries`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/flip-recessed-bike-mounts`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
    { url: `${BASE}/enquiry`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];
}
