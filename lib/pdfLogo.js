// Loading the shop logo for a jsPDF document.
//
// This looks like a trivial helper and isn't. Both PDF builders used to fetch
// /logo.png and hand the data URL straight to doc.addImage() with no
// compression argument. jsPDF then stores the decoded bitmap RAW: 900 x 730
// pixels x 4 bytes = 2,628,000 bytes. Invoice #01003 was filed at 2,635,337
// bytes — the whole 2.6 MB document was the logo, and about 7 KB of it was the
// actual invoice.
//
// That mattered because emailing an invoice base64-encodes the PDF into the
// request body: a 2.6 MB PDF becomes a ~3.5 MB string that has to be built in
// memory and posted. On a desktop it was merely wasteful. On Craig's iPad it
// was enough to kill the send before the request left the browser.
//
// Two fixes, and both are needed. The logo prints 34 mm wide — about 1.3 inches
// — so 900 px is roughly 670 dpi, far past what any printer or screen resolves.
// It is scaled to a sensible print resolution first, and THEN handed to jsPDF
// with Flate compression turned on. Either alone leaves the file much larger
// than it needs to be.

const TARGET_DPI = 300;
const MM_PER_INCH = 25.4;

/**
 * Fetch a logo and scale it to the resolution it will actually print at.
 *
 * @param {string} src        path to the image, e.g. "/logo.png"
 * @param {number} printedMm  how wide it will be drawn in the PDF, in mm
 * @returns {Promise<string|null>} a PNG data URL, or null — an invoice must
 *          still print without its logo rather than fail outright.
 */
export async function loadLogo(src = "/logo.png", printedMm = 34) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    return (await downscale(dataUrl, printedMm)) || dataUrl;
  } catch {
    return null;
  }
}

// Canvas work, so browser only. Any failure returns null and the caller falls
// back to the full-size image — a big invoice beats no invoice.
function downscale(dataUrl, printedMm) {
  return new Promise((resolve) => {
    try {
      if (typeof document === "undefined") { resolve(null); return; }
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const targetW = Math.round((printedMm / MM_PER_INCH) * TARGET_DPI);
          // Never scale UP a logo that's already small — that would add bytes
          // and no detail.
          if (!img.width || img.width <= targetW) { resolve(null); return; }
          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = Math.max(1, Math.round((img.height / img.width) * targetW));
          const ctx = canvas.getContext("2d");
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch { resolve(null); }
      };
      img.src = dataUrl;
    } catch { resolve(null); }
  });
}

/**
 * Draw the logo with compression on. The "logo" alias tells jsPDF to store the
 * image once even if it is drawn on several pages.
 */
export function drawLogo(doc, logo, x, y, w, h) {
  if (!logo) return;
  try {
    doc.addImage(logo, "PNG", x, y, w, h, "logo", "FAST");
  } catch {
    /* a bad image must never stop an invoice printing */
  }
}
