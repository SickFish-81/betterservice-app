// The make/model/type suggestions behind every "add a machine" box.
//
// These lived inside app/machines/page.js, so the Machines screen offered the
// full list while the two places a machine is ACTUALLY added in a hurry — the
// new job card, and the customer page — offered only the makes already in the
// database. On a fresh shop that means the first Honda has to be typed by hand,
// and every screen suggests something different.
//
// Nothing here is a rule. Every box is still free text, so an unlisted make or
// a model that came out last week goes in by typing it. This is a shortcut, not
// a gate — which is why models are only a guide and no year or variant is
// listed. To add a make Craig sells, add it here and it appears everywhere.

export const MAKES = [
  "Honda", "Yamaha", "Suzuki", "Kawasaki", "Polaris", "Can-Am",
  "CFMoto", "TGB", "KTM", "Husqvarna", "Kymco", "SYM",
];

export const TYPES = ["ATV", "Motorcycle", "Side by side", "Mower", "Generator", "Other"];

// Grouped by make so the model box can narrow to the make that's been picked.
// A flat list meant typing "Honda" then being offered Polaris models.
export const MODELS_BY_MAKE = {
  Honda: [
    "TRX250", "TRX250TM", "TRX250TE", "TRX420FM", "TRX420FM1", "TRX420FE", "TRX420FA",
    "TRX500FM", "TRX500FM1", "TRX500FM2", "TRX500FA", "TRX500FE",
    "TRX520FM", "TRX520FM1", "TRX520FA", "TRX680FA",
    "Pioneer 500", "Pioneer 520", "Pioneer 700", "Pioneer 1000", "Big Red MUV700",
    "CT110", "CTX200 Ag", "CRF150F", "CRF230F", "CRF250F", "XR150L", "XR190", "CG125",
  ],
  Yamaha: [
    "Grizzly 350", "Grizzly 450", "Grizzly 700", "Kodiak 450", "Kodiak 700", "Big Bear 350",
    "Viking", "Wolverine", "Rhino", "AG100", "AG125", "AG200", "TT-R125", "TT-R230", "TW200",
  ],
  Suzuki: [
    "KingQuad 400", "KingQuad 500", "KingQuad 750", "Ozark 250", "Eiger 400",
    "DR200 Trojan", "TF125 Mudbug", "DR-Z125",
  ],
  Kawasaki: ["Brute Force 300", "Brute Force 750", "KVF300", "KVF750", "Bayou 250", "Mule", "Teryx"],
  Polaris: ["Sportsman 450", "Sportsman 570", "Sportsman 850", "Ranger 570", "Ranger 1000", "RZR"],
  "Can-Am": ["Outlander 450", "Outlander 570", "Outlander 650", "Outlander 1000", "Defender", "Maverick"],
  CFMoto: ["CForce 400", "CForce 520", "CForce 625", "CForce 850", "UForce 600", "UForce 1000"],
};

export const ALL_MODELS = Object.values(MODELS_BY_MAKE).flat();

// Case-insensitive dedupe, keeping the FIRST spelling seen. The reference list
// is always passed first, so "honda" typed at the counter folds into "Honda"
// rather than sitting under it as a second entry. Without this the list quietly
// fills with near-duplicates and stops being worth reading.
function uniqSorted(xs) {
  const seen = new Map();
  for (const raw of xs) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

// Everything below merges the reference list with whatever is already on the
// shop's own machines, so a make Craig typed once is offered the next time
// without anyone having to come back and edit this file.
export function makeOptions(machines = []) {
  return uniqSorted([...MAKES, ...machines.map((m) => m.make)]);
}

export function typeOptions(machines = []) {
  return uniqSorted([...TYPES, ...machines.map((m) => m.type)]);
}

// Pass the make that's been typed and the suggestions narrow to it. Case and
// stray spaces are ignored, because "honda " is what actually gets typed.
// An unrecognised make falls back to everything rather than to nothing — a
// short list of wrong guesses is worse than a long list containing the answer.
export function modelOptions(machines = [], make = "") {
  const key = Object.keys(MODELS_BY_MAKE).find(
    (k) => k.toLowerCase() === String(make ?? "").trim().toLowerCase()
  );
  if (key) {
    const sameMake = machines
      .filter((m) => String(m.make ?? "").trim().toLowerCase() === key.toLowerCase())
      .map((m) => m.model);
    return uniqSorted([...MODELS_BY_MAKE[key], ...sameMake]);
  }
  return uniqSorted([...ALL_MODELS, ...machines.map((m) => m.model)]);
}
