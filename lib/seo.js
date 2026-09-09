// Shared metadata for the public pages.
//
// Why this exists: Next inherits `openGraph` from the layout as a whole block.
// If a page doesn't declare its own openGraph, it silently keeps the layout's —
// so setting it once in layout.js would give every page the SAME share title.
// Share the FLIP page and Facebook would call it "Betterservice ATV". The Next
// docs show exactly this trap, and the fix they recommend is what's below: a
// shared object each page spreads in, overriding the title and description.
//
// Every public page should build its metadata with pageMeta() so the canonical,
// the Open Graph tags and the Twitter card can never drift apart.

export const SITE = "https://betterservice.co.nz";
export const SITE_NAME = "Betterservice ATV";
export const PHONE = "021 08327787";
export const PHONE_E164 = "+642108327787";
export const ADDRESS = "556 Te Puke Highway, Te Puke";

// 1200x630 is the size Facebook, LinkedIn and iMessage all crop to.
//
// Keep share images as JPEG or PNG, never WebP - even where the page itself
// uses WebP. Facebook and X read WebP, but LinkedIn, Slack and Signal do not,
// and a link that previews with no picture at all is worse than a larger file.
const DEFAULT_IMAGE = {
  url: "/og-default.jpg",
  width: 1200,
  height: 630,
  alt: "Betterservice ATV — motorcycle & ATV servicing, Te Puke",
};

/**
 * Build a page's metadata.
 *
 * @param {object}  o
 * @param {string} [o.title]        Page title, without the site suffix. Omit on the home page
 *                                  so the layout's default title is used.
 * @param {string}  o.description   Under ~155 characters or Google truncates it.
 * @param {string}  o.path          Absolute path, e.g. "/for-sale". Used for the canonical.
 * @param {object} [o.image]        { url, width, height, alt } to override the default card.
 */
export function pageMeta({ title, description, path, image }) {
  const img = image ?? DEFAULT_IMAGE;
  // og:title should read as a standalone headline — the "· Betterservice ATV"
  // suffix belongs in the browser tab, not on a shared link where the site name
  // is already shown underneath.
  const shareTitle = title ?? "Betterservice ATV — motorcycle & ATV servicing, Te Puke";

  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_NZ",
      url: path,
      title: shareTitle,
      description,
      images: [img],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [img.url],
    },
  };
}
