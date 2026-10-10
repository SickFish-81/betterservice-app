// pdfFont.js — making te reo print correctly in a jsPDF document.
//
// jsPDF's built-in fonts are the fourteen PDF base fonts, and those are encoded
// in WinAnsi. WinAnsi has no slot for a macron vowel, so "Māori" came out as
// "Mori": the character is dropped, no error is raised anywhere, and the line
// still looks like a sentence. That is the dangerous kind of bug — a customer's
// name is wrong on their own invoice and nothing reports it. Invoice #01065 was
// the loud version of the same fault on the server, where pdf-lib refuses to
// guess and throws instead, leaving the invoice with no PDF at all.
//
// The fix is to hand jsPDF a real Unicode font. Two things make that less
// simple than it sounds, and both are the reason this file exists:
//
//  1. jsPDF does not subset fonts. Whatever TTF you give it is embedded WHOLE,
//     in every document it draws. DejaVuSans is 757 KB, and with its bold
//     1.4 MB — on every invoice. That walks straight back into the bug
//     pdfLogo.js was written to fix, where a 2.6 MB invoice was too big for
//     Craig's iPad to email. So the two files in /public/fonts are pre-subset
//     to the characters a Betterservice document can actually contain: ASCII,
//     Latin-1, the macron vowels, and the curly quotes and dashes that arrive
//     pasted out of Word and email. 17 KB and 16 KB; jsPDF Flate-compresses
//     them to about 13 KB in the finished PDF.
//
//     If you ever need another character — a te reo name is fine, but say a
//     Greek or Cyrillic one — it must be added to the subset or it will vanish
//     exactly the way the macrons used to. See FONTS.md next to this file.
//
//  2. They are fetched rather than bundled, the same way the logo is. The
//     browser then caches both files once and reuses them for invoices, job
//     cards, purchase orders, receipts and credit notes alike, instead of each
//     page carrying its own base64 copy.
//
// Every failure here is non-fatal. A document that prints with the wrong font
// beats a document that does not print, so if the fetch fails we fall back to
// Helvetica AND strip the accents first — "Maori", which is wrong but readable
// and obviously so, rather than the silent mangling we started with.

const FAMILY = "BSSans";
const FILES = { regular: "/fonts/bs-sans.ttf", bold: "/fonts/bs-sans-bold.ttf" };

// Fetched once per page load and shared by every builder. Holding the promise
// rather than the result means two documents built at the same time wait on one
// fetch instead of racing and doing it twice.
let pending = null;

/**
 * Fetch the subset fonts and return them base64-encoded, the form jsPDF's
 * virtual file system wants.
 *
 * @returns {Promise<{regular: string, bold: string}|null>} null if unavailable
 */
export function loadPdfFont() {
  if (!pending) pending = fetchBoth();
  return pending;
}

async function fetchBoth() {
  try {
    const [regular, bold] = await Promise.all([asBase64(FILES.regular), asBase64(FILES.bold)]);
    if (!regular || !bold) return null;
    return { regular, bold };
  } catch {
    return null;
  }
}

async function asBase64(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  // In chunks: String.fromCharCode.apply with tens of thousands of arguments
  // blows the call stack on some browsers.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Register the font on a document, or install the fallback if it is missing.
 *
 * Both styles are registered under one family name, so the existing
 * `doc.setFont(undefined, "bold")` idiom used throughout the builders keeps
 * working untouched — jsPDF reads that as "same family, bold style".
 *
 * @param {import("jspdf").jsPDF} doc
 * @param {{regular: string, bold: string}|null} font  from loadPdfFont()
 * @returns {boolean} true if real Unicode text will print
 */
export function applyPdfFont(doc, font) {
  if (font) {
    try {
      doc.addFileToVFS(FAMILY + ".ttf", font.regular);
      doc.addFont(FAMILY + ".ttf", FAMILY, "normal");
      doc.addFileToVFS(FAMILY + "-Bold.ttf", font.bold);
      doc.addFont(FAMILY + "-Bold.ttf", FAMILY, "bold");
      doc.setFont(FAMILY, "normal");
      return true;
    } catch {
      /* fall through to the fallback below */
    }
  }
  installAsciiFallback(doc);
  return false;
}

/** Load and apply in one step. The normal way to call this file. */
export async function usePdfFont(doc) {
  return applyPdfFont(doc, await loadPdfFont());
}

// ---------------------------------------------------------------------------
// The fallback.
//
// Wrapping doc.text once is deliberate. The alternative is wrapping ~60 call
// sites across five builders in a sanitiser, which works right up until someone
// adds the sixty-first and forgets. Here there is one place to be correct, and
// a new doc.text call anywhere in the app is covered the day it is written.
// ---------------------------------------------------------------------------
function installAsciiFallback(doc) {
  const text = doc.text.bind(doc);
  doc.text = function (str, ...rest) {
    return text(Array.isArray(str) ? str.map(toWinAnsi) : toWinAnsi(str), ...rest);
  };
  // splitTextToSize measures before it wraps, so it has to see the same string
  // the page will, or the wrap points come out in the wrong places.
  const split = doc.splitTextToSize.bind(doc);
  doc.splitTextToSize = function (str, ...rest) {
    return split(toWinAnsi(str), ...rest);
  };
}

/**
 * Reduce a string to what WinAnsi can actually print.
 *
 * Latin-1 accents (é, ö, ñ) survive as themselves — WinAnsi has those. Anything
 * beyond it keeps its base letter and loses the mark: ā becomes a. Whatever is
 * left over after that is dropped rather than printed as a wrong glyph.
 */
export function toWinAnsi(t) {
  return String(t ?? "")
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, (ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, ""))
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}
