/** @type {import('next').NextConfig} */

// The old site's URLs, kept alive.
//
// These .php pages have been indexed for years. The moment DNS points at
// Vercel they stop existing, and a 404 throws away whatever ranking each one
// built up. A 308 tells Google "this moved permanently, carry the ranking
// across" — so every old address lands on its nearest equivalent here.
//
// Do not delete these. There is no expiry date on an old link: they live in
// Google's index, in other people's bookmarks, and on any site that ever
// linked to Craig.
const oldSiteRedirects = [
  ["/used-honda-atv-quad-for-sale-tepuke-tauranga-bop.php", "/for-sale"],
  ["/atv-servicing.php", "/"],
  ["/bosch-batteries.php", "/batteries"],
  ["/other-equipment-for-sale.php", "/for-sale"],
  ["/contact-betterservice.php", "/enquiry"],
  ["/FLIP-recessed-bike-mounts.php", "/flip-recessed-bike-mounts"],
  // The old site was mid-rebrand, so this address may also be indexed.
  ["/neuton-batteries.php", "/batteries"],
];

const nextConfig = {
  // The site answers on two addresses — betterservice.co.nz and the
  // betterservice-app.vercel.app one, which is handy to keep for testing. Same
  // server, same build, same database: there is no older copy. But to Google
  // it's the same site at two addresses, which splits the ranking between them
  // and lets it show whichever it prefers.
  //
  // Every page already carries a canonical tag pointing at betterservice.co.nz.
  // This is the belt to that pair of braces: anything served on the vercel.app
  // host is marked noindex, so it stays fully usable for us and invisible to
  // search engines. A redirect would also fix the SEO, but it would take the
  // address away.
  async headers() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "betterservice-app.vercel.app" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  async redirects() {
    return oldSiteRedirects.map(([source, destination]) => ({
      source,
      destination,
      permanent: true, // 308
    }));
  },
};

export default nextConfig;
