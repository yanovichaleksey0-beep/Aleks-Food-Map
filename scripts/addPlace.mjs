import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const API_KEY = process.env.GEOAPIFY_KEY;
if (!API_KEY) throw new Error("Missing GEOAPIFY_KEY in .env.local");

function todayISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function safeReadJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`Could not parse JSON in ${filePath}. Fix it or clear the file.`);
  }
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function pickCity(p) {
  return (
    p.city ||
    p.town ||
    p.village ||
    p.hamlet ||
    p.municipality ||
    p.locality ||
    null
  );
}

function pickNeighborhood(p) {
  return (
    p.neighbourhood || // Geoapify often uses this spelling
    p.neighborhood ||
    p.suburb ||
    p.district ||
    p.quarter ||
    p.borough ||
    p.city_district ||
    null
  );
}

const CATEGORY_TAG_MAP = [
  ["catering.restaurant", "restaurant"],
  ["catering.cafe", "cafe"],
  ["catering.fast_food", "fast-food"],
  ["catering.bar", "bar"],
  ["catering.pub", "pub"],
  ["catering.ice_cream", "ice-cream"],
  ["catering.bakery", "bakery"],
  ["catering.food_court", "food-court"],
];

const CUISINE_KEYWORDS = {
  italian: "Italian",
  mexican: "Mexican",
  thai: "Thai",
  korean: "Korean",
  chinese: "Chinese",
  japanese: "Japanese",
  vietnamese: "Vietnamese",
  indian: "Indian",
  greek: "Greek",
  mediterranean: "Mediterranean",
  turkish: "Turkish",
  lebanese: "Lebanese",
  ethiopian: "Ethiopian",
  french: "French",
  spanish: "Spanish",
  ramen: "Ramen",
  sushi: "Sushi",
  pizza: "Pizza",
  taco: "Tacos",
  tacos: "Tacos",
  burger: "Burgers",
  bbq: "BBQ",
  seafood: "Seafood",
  steak: "Steakhouse",
};

function deriveTagsAndCuisine(pick) {
  const categories = Array.isArray(pick.categories) ? pick.categories : [];
  const tags = new Set();
  const cuisines = new Set();

  // Broad tags from categories
  for (const [prefix, tag] of CATEGORY_TAG_MAP) {
    if (categories.some((c) => String(c).startsWith(prefix))) tags.add(tag);
  }

  // Try to infer cuisine from categories + name
  const hay = `${categories.join(" ")} ${(pick.name || pick.formatted || "")}`.toLowerCase();
  for (const [k, label] of Object.entries(CUISINE_KEYWORDS)) {
    if (hay.includes(k)) {
      cuisines.add(label);
      tags.add(k === "tacos" ? "tacos" : k);
    }
  }

  return {
    tags: Array.from(tags).sort(),
    cuisine: Array.from(cuisines).sort(),
  };
}

// NEW: richer POI lookup for categories/website/phone
async function enrichWithPlaces(lat, lon) {
  // Geoapify Places uses lon,lat order in filters/bias
  const url =
    "https://api.geoapify.com/v2/places?" +
    new URLSearchParams({
      categories: "catering",
      filter: `circle:${lon},${lat},80`, // radius meters
      bias: `proximity:${lon},${lat}`,
      limit: "10",
      apiKey: API_KEY,
    });

  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const features = json.features || [];
  if (!features.length) return null;

  // Prefer closest by 'distance' if present
  features.sort(
    (a, b) => (a.properties?.distance ?? Number.POSITIVE_INFINITY) -
              (b.properties?.distance ?? Number.POSITIVE_INFINITY)
  );

  return features[0]?.properties ?? null;
}

async function chooseResult(results) {
  if (results.length === 1) return results[0];

  console.log("\nTop matches:");
  results.forEach((r, i) => {
    const city = pickCity(r);
    const hood = pickNeighborhood(r);
    const line2 = [hood, city].filter(Boolean).join(" • ");
    console.log(
      `${i + 1}) ${r.name || r.formatted}\n   ${r.formatted}${line2 ? `\n   ${line2}` : ""}\n`
    );
  });

  const rl = readline.createInterface({ input, output });
  const ans = await rl.question(`Pick 1-${results.length} (Enter = 1): `);
  rl.close();

  const n = ans.trim() === "" ? 1 : Number(ans);
  if (!Number.isFinite(n) || n < 1 || n > results.length) {
    console.log("Invalid choice — using 1.");
    return results[0];
  }
  return results[n - 1];
}

function isNearDuplicate(existing, candidate) {
  const nameA = (candidate.name || "").toLowerCase().trim();
  return existing.some((p) => {
    const nameB = (p.name || "").toLowerCase().trim();
    if (!nameA || !nameB) return false;
    const sameName = nameA === nameB;
    const close =
      typeof p.lat === "number" &&
      typeof p.lon === "number" &&
      Math.abs(p.lat - candidate.lat) < 0.0006 &&
      Math.abs(p.lon - candidate.lon) < 0.0006;
    return sameName && close;
  });
}

// -------------------- main --------------------

const rawArgs = process.argv.slice(2);
const query = rawArgs.join(" ").trim();
if (!query) throw new Error('Usage: npm run add:place -- "place name city"');

const dataPath = path.resolve("src/data/places.json");
fs.mkdirSync(path.dirname(dataPath), { recursive: true });

const url =
  "https://api.geoapify.com/v1/geocode/autocomplete?" +
  new URLSearchParams({
    text: query,
    limit: "5",
    filter: "countrycode:us",
    format: "json",
    apiKey: API_KEY,
  });

const res = await fetch(url);
if (!res.ok) throw new Error(`Geoapify error: ${res.status} ${await res.text()}`);

const json = await res.json();
if (!json.results?.length) throw new Error("No results found.");

const pick = await chooseResult(json.results);

// NEW: enrich with Places POI properties (better categories + contact)
const poi = await enrichWithPlaces(pick.lat, pick.lon);

// NEW: infer tags/cuisine from POI categories (fallback to autocomplete categories)
const categoriesFromPoi = poi?.categories || pick.categories || [];
const nameForInference = poi?.name || pick.name || pick.formatted;

const { tags, cuisine } = deriveTagsAndCuisine({
  ...pick,
  name: nameForInference,
  categories: categoriesFromPoi,
});

const newPlace = {
  id: `${slugify(pick.name || pick.formatted)}-${Date.now()}`,
  name: pick.name || pick.formatted,
  address: pick.formatted,
  lat: pick.lat,
  lon: pick.lon,

  // Auto-filled extras
  city: pickCity(pick),
  neighborhood: pickNeighborhood(pick),
  cuisine,
  tags,
  visitedAt: todayISO(),

  // Your fields
  price: null,
  rating: null,
  wouldReturn: null,
  notes: "",

  // optional if present (POI preferred)
  website: poi?.website ?? pick.website ?? null,
  phone: poi?.contact?.phone ?? pick.phone ?? null,
};

const existing = safeReadJSON(dataPath);

if (isNearDuplicate(existing, newPlace)) {
  console.log("Looks like this spot already exists (same name + very close location).");
  console.log("Skipping add:", newPlace.name);
  process.exit(0);
}

existing.push(newPlace);
fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));

console.log("Added:", newPlace.name);
console.log("→", newPlace.address);
console.log("→ city:", newPlace.city || "—", "| neighborhood:", newPlace.neighborhood || "—");
console.log("→ cuisine:", newPlace.cuisine.length ? newPlace.cuisine.join(", ") : "—");
console.log("→ tags:", newPlace.tags.length ? newPlace.tags.join(", ") : "—");
console.log("→ visitedAt:", newPlace.visitedAt);