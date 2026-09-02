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
  async redirects() {
    return oldSiteRedirects.map(([source, destination]) => ({
      source,
      destination,
      permanent: true, // 308
    }));
  },
};

export default nextConfig;
