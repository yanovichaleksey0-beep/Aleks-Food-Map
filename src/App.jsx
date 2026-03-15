// App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import placesData from "./data/Places.json";

// Leaflet marker icon fix (Vite) — kept as fallback
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// ── Continuous rating → color (red→orange→yellow→green) ──
function lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `rgb(${rr},${rg},${rb})`;
}

// Slightly desaturated premium stops: red → orange → amber → green
// Bright red → orange → yellow → lime → green across 1–5
const COLOR_STOPS = [
  { at: 0,    hex: 0xE59A34 },  // orange       (1)
  { at: 0.61, hex: 0xE1BF4A },  // gold         (6.5)
  { at: 0.72, hex: 0x74C56C },  // soft green   (7.5)
  { at: 1,    hex: 0x3FA85A },  // rich green   (10)
];

function ratingToHex(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return null;
  const t = Math.max(0, Math.min(1, (r - 1) / 9)); // 1–10 → 0–1
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i], b = COLOR_STOPS[i + 1];
    if (t >= a.at && t <= b.at) {
      const local = (t - a.at) / (b.at - a.at);
      return lerpColor(a.hex, b.hex, local);
    }
  }
  return lerpColor(COLOR_STOPS.at(-2).hex, COLOR_STOPS.at(-1).hex, 1);
}

const UNRATED_COLOR = "#94a3b8";

// Keep a categorical bucket name for popup badges / legend
function ratingColor(rating) {
  if (rating == null) return "gray";
  const r = Number(rating);
  if (!Number.isFinite(r) || r === 0) return "gray";
  if (r >= 9.0) return "green";
  if (r >= 7.0) return "softgreen";
  if (r >= 5.0) return "gold";
  return "orange";
}

function ratingLabel(rating) {
  if (rating == null) return "New";
  const r = Number(rating);
  if (!Number.isFinite(r) || r === 0) return "New";
  return r % 1 === 0 ? String(r) : r.toFixed(1);
}

// Price → font-weight
function priceFontWeight(price) {
  const p = Number(price);
  if (p >= 3) return 800;
  if (p === 2) return 650;
  return 500;
}

// Decide text color for contrast: dark text on light fills, white on dark fills
function markerTextColor(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return "#fff";
  const t = Math.max(0, Math.min(1, (r - 1) / 9)); // 1–10 → 0–1
  // Yellow / orange / lime zone needs dark text for readability
  return (t > 0.25 && t < 0.7) ? "#2c1a0e" : "#fff";
}

function makeRatingIcon(rating, isSelected, price, name) {
  const bg = ratingToHex(rating) || UNRATED_COLOR;
  const label = ratingLabel(rating);
  const fw = priceFontWeight(price);
  const txtColor = markerTextColor(rating);
  const cls = isSelected ? "beli-marker selected" : "beli-marker";

  const title = name
    ? `${name}, rating ${label}${price ? `, price ${"$".repeat(Number(price))}` : ""}`
    : `Rating ${label}`;

  const isNew = label === "New";

  return L.divIcon({
    className: "",
    iconSize: [32, 38],
    iconAnchor: [16, 38],
    popupAnchor: [0, -32],
    html: `
      <div
        class="${cls}"
        style="--pin-bg:${bg};--pin-fg:${txtColor};--pin-fw:${fw}"
        aria-label="${title}"
        title="${title}"
      >
        <div class="beli-marker__nub"></div>
        <div class="beli-marker__body ${isNew ? "is-new" : ""}">
          <span class="beli-marker__label">${label}</span>
        </div>
      </div>
    `,
  });
}

// Cluster icon factory — color by average rating (continuous)
function createClusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers();
  const count = markers.length;

  let sum = 0;
  let rated = 0;
  for (const m of markers) {
    const r = m.options._rating;
    if (Number.isFinite(r) && r > 0) { sum += r; rated++; }
  }
  const avg = rated > 0 ? sum / rated : 0;
  const bg = ratingToHex(avg) || UNRATED_COLOR;

  const size = count < 10 ? 36 : count < 30 ? 42 : 48;
  const txtColor = avg > 0 ? markerTextColor(avg) : "#fff";
  return L.divIcon({
    html: `<div class="cluster-badge" style="width:${size}px;height:${size}px;background:${bg};color:${txtColor}">${count}</div>`,
    className: "",
    iconSize: [size, size],
  });
}

// Bounds
const AREA_BOUNDS = L.latLngBounds([47.45, -122.48], [48.02, -122.0]);

const SORTS = [
  { value: "top", label: "Top rated" },
  { value: "recent", label: "Most recent" },
  { value: "name", label: "Name (A→Z)" },
  { value: "nearest", label: "Nearest to me" },
];

function priceLabel(p) {
  if (!p) return "—";
  const n = Number(p);
  return "$".repeat(Math.max(1, Math.min(4, Number.isFinite(n) ? n : 1)));
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function mapsLink(place) {
  const q = encodeURIComponent(`${place.name} ${place.address || ""}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function parseUrlState() {
  const sp = new URLSearchParams(window.location.search);
  const q = sp.get("q") ?? "";
  const city = sp.get("city") ?? "";
  const cuisine = sp.get("cuisine") ?? "";
  const neighborhood = sp.get("hood") ?? "";
  const tag = sp.get("tag") ?? "";
  const minRating = Number(sp.get("minRating") ?? "0");
  const price = Number(sp.get("price") ?? "0");
  const wouldReturn = sp.get("return") === "1";
  const sort = sp.get("sort") ?? "top";
  return { q, city, cuisine, neighborhood, tag, minRating, price, wouldReturn, sort };
}

function writeUrlState(state) {
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  if (state.city) sp.set("city", state.city);
  if (state.cuisine) sp.set("cuisine", state.cuisine);
  if (state.neighborhood) sp.set("hood", state.neighborhood);
  if (state.tag) sp.set("tag", state.tag);
  if (state.minRating > 0) sp.set("minRating", String(state.minRating));
  if (state.price > 0) sp.set("price", String(state.price));
  if (state.wouldReturn) sp.set("return", "1");
  if (state.sort && state.sort !== "top") sp.set("sort", state.sort);

  const next = `${window.location.pathname}${sp.toString() ? `?${sp.toString()}` : ""}`;
  window.history.replaceState(null, "", next);
}

// -------------------- Local quick-edit storage --------------------
const EDITS_KEY = "aleks-food-map:edits:v1";

function loadEdits() {
  try {
    const raw = localStorage.getItem(EDITS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveEdits(edits) {
  try {
    localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
  } catch {
    // ignore
  }
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function markerInstance(ref) {
  // works across react-leaflet versions
  if (!ref) return null;
  if (typeof ref.openPopup === "function") return ref;
  if (ref.leafletElement && typeof ref.leafletElement.openPopup === "function") return ref.leafletElement;
  return null;
}

export default function App() {
  const STADIA_KEY = import.meta.env.VITE_STADIA_KEY;
  const TILE_URL = STADIA_KEY
    ? `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${STADIA_KEY}`
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const RESUME_URL = "/Aleksey_Yanovich_Resume.pdf";

  const mapRef = useRef(null);
  const markerRefs = useRef({});

  // URL-synced state
  const initial = useMemo(() => parseUrlState(), []);
  const [q, setQ] = useState(initial.q);
  const [city, setCity] = useState(initial.city);
  const [cuisine, setCuisine] = useState(initial.cuisine);
  const [neighborhood, setNeighborhood] = useState(initial.neighborhood);
  const [tag, setTag] = useState(initial.tag);
  const [minRating, setMinRating] = useState(initial.minRating);
  const [price, setPrice] = useState(initial.price);
  const [wouldReturn, setWouldReturn] = useState(initial.wouldReturn);
  const [sort, setSort] = useState(initial.sort);

  // Selection
  const [selectedId, setSelectedId] = useState(null);

  // Overlay/drawer state
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState("about"); // "about" | "resume" | "contact"
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTab, setMenuTab] = useState("aboutMap"); // "aboutMap" | "featured" | "stats"

  // Close overlays on ESC
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setAccountOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Location (optional, for nearest)
  const [myLoc, setMyLoc] = useState(null); // {lat, lon}
  const [locErr, setLocErr] = useState("");

  // Toast
  const [toast, setToast] = useState(null); // { message, variant }
  function showToast(message, variant = "info") {
    setToast({ message, variant });
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  async function copyText(text, successMsg = "Copied!") {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(successMsg, "success");
        return true;
      }
    } catch {
      // fall through
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(successMsg, "success");
      return true;
    } catch {
      showToast("Could not copy in this browser.", "error");
      return false;
    }
  }

  // Local edits
  const [edits, setEdits] = useState(() => loadEdits());
  useEffect(() => saveEdits(edits), [edits]);

  // Base places safety
  const basePlaces = Array.isArray(placesData) ? placesData : [];

  // Merge base data + local edits
  const places = useMemo(() => {
    return basePlaces.map((p) => {
      const patch = edits?.[p.id];
      return patch ? { ...p, ...patch } : p;
    });
  }, [basePlaces, edits]);

  // Only places with valid coords should hit Leaflet
  const placesWithCoords = useMemo(() => {
    return places.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
  }, [places]);

  // Stats memo
  const stats = useMemo(() => {
    const total = places.length;
    const rated = places.filter((p) => typeof p.rating === "number");
    const avgRating = rated.length
      ? rated.reduce((sum, p) => sum + p.rating, 0) / rated.length
      : null;
    const wouldReturnCount = places.filter((p) => p.wouldReturn === true).length;
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    const cities = uniq(places.map((p) => p.city));
    const hoods = uniq(places.map((p) => p.neighborhood));
    const cuisines = uniq(places.flatMap((p) => p.cuisine || []));
    const tags = uniq(places.flatMap((p) => p.tags || []));

    const cuisineCounts = new Map();
    for (const p of places) {
      for (const c of p.cuisine || []) cuisineCounts.set(c, (cuisineCounts.get(c) || 0) + 1);
    }
    const topCuisines = Array.from(cuisineCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return {
      total,
      cities: cities.length,
      hoods: hoods.length,
      cuisines: cuisines.length,
      tags: tags.length,
      ratedCount: rated.length,
      avgRating,
      wouldReturnCount,
      wouldReturnPct: total ? Math.round((wouldReturnCount / total) * 100) : 0,
      topCuisines,
    };
  }, [places]);

  function applyFeatured(which) {
    setMenuOpen(false);
    setCity("");
    setNeighborhood("");
    setCuisine("");
    setTag("");
    setPrice(0);
    setMinRating(0);
    setWouldReturn(false);
    setQ("");

    if (which === "top") {
      setSort("top");
      setMinRating(4.5);
      showToast("Showing top rated (4.5+)", "success");
      return;
    }
    if (which === "date-night") {
      setSort("top");
      setTag("date-night");
      showToast("Featured: date-night", "success");
      return;
    }
    if (which === "late-night") {
      setSort("top");
      setTag("late-night");
      showToast("Featured: late-night", "success");
      return;
    }
    if (which === "cheap") {
      setSort("top");
      setPrice(1);
      showToast("Featured: cheap eats ($)", "success");
      return;
    }
    if (which === "recent") {
      setSort("recent");
      showToast("Featured: most recent", "success");
      return;
    }
  }

  // Editing UI
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  function startEdit(p) {
    setEditingId(p.id);
    setDraft({
      rating: p.rating ?? "",
      price: p.price ?? "",
      wouldReturn: p.wouldReturn ?? false,
      notes: p.notes ?? "",
      photo: p.photo ?? "",
    });
    setSelectedId(p.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function saveEdit(id) {
    if (!draft) return;

    const ratingNum =
      draft.rating === ""
        ? null
        : Number.isFinite(Number(draft.rating))
        ? Number(draft.rating)
        : null;

    const priceNum =
      draft.price === ""
        ? null
        : Number.isFinite(Number(draft.price))
        ? Number(draft.price)
        : null;

    const patch = {
      rating: ratingNum,
      price: priceNum,
      wouldReturn: !!draft.wouldReturn,
      notes: draft.notes || "",
      photo: draft.photo || null,
    };

    setEdits((prev) => ({
      ...(prev || {}),
      [id]: { ...((prev || {})[id] || {}), ...patch },
    }));

    showToast("Saved locally (export JSON to keep permanently)", "success");
    setEditingId(null);
    setDraft(null);
  }

  function clearLocalEdits() {
    setEdits({});
    showToast("Local edits cleared", "info");
  }

  function exportPlaces() {
    const merged = basePlaces.map((p) => (edits?.[p.id] ? { ...p, ...edits[p.id] } : p));
    downloadJSON("places.json", merged);
    showToast("Downloaded places.json", "success");
  }

  // Whenever filters change, write URL
  useEffect(() => {
    writeUrlState({ q, city, cuisine, neighborhood, tag, minRating, price, wouldReturn, sort });
  }, [q, city, cuisine, neighborhood, tag, minRating, price, wouldReturn, sort]);

  // Back/Forward restores state
  useEffect(() => {
    const onPop = () => {
      const s = parseUrlState();
      setQ(s.q);
      setCity(s.city);
      setCuisine(s.cuisine);
      setNeighborhood(s.neighborhood);
      setTag(s.tag);
      setMinRating(s.minRating);
      setPrice(s.price);
      setWouldReturn(s.wouldReturn);
      setSort(s.sort);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function clearFilters() {
    setQ("");
    setCity("");
    setCuisine("");
    setNeighborhood("");
    setTag("");
    setMinRating(0);
    setPrice(0);
    setWouldReturn(false);
    setSort("top");
    setSelectedId(null);
    showToast("Filters cleared", "info");
  }

  async function copyLink() {
    const url = window.location.href;
    await copyText(url, "Link copied!");
  }

  // Facets for dropdowns
  const facets = useMemo(() => {
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort();
    const cities = uniq(places.map((p) => p.city));
    const hoods = uniq(places.map((p) => p.neighborhood));
    const cuisines = uniq(places.flatMap((p) => p.cuisine || []));
    const tags = uniq(places.flatMap((p) => p.tags || []));
    return { cities, hoods, cuisines, tags };
  }, [places]);

  // Filtering
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return places.filter((p) => {
      if (city && (p.city || "") !== city) return false;
      if (neighborhood && (p.neighborhood || "") !== neighborhood) return false;
      if (cuisine && !(p.cuisine || []).includes(cuisine)) return false;
      if (tag && !(p.tags || []).includes(tag)) return false;
      if (price > 0 && Number(p.price || 0) !== Number(price)) return false;
      if (wouldReturn && p.wouldReturn !== true) return false;

      const r = typeof p.rating === "number" ? p.rating : 0;
      if (minRating > 0 && r < minRating) return false;

      if (!qq) return true;

      const hay = [
        p.name,
        p.address,
        p.city,
        p.neighborhood,
        ...(p.cuisine || []),
        ...(p.tags || []),
        p.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(qq);
    });
  }, [places, q, city, neighborhood, cuisine, tag, minRating, price, wouldReturn]);

  // Sorting
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "name") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      return arr;
    }
    if (sort === "recent") {
      arr.sort((a, b) => (b.visitedAt || "").localeCompare(a.visitedAt || ""));
      return arr;
    }
    if (sort === "nearest") {
      if (!myLoc) return arr;
      arr.sort((a, b) => {
        if (!Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lon))) return 1;
        if (!Number.isFinite(Number(b.lat)) || !Number.isFinite(Number(b.lon))) return -1;
        const da = haversineMiles(myLoc.lat, myLoc.lon, Number(a.lat), Number(a.lon));
        const db = haversineMiles(myLoc.lat, myLoc.lon, Number(b.lat), Number(b.lon));
        return da - db;
      });
      return arr;
    }
    arr.sort((a, b) => (Number(b.rating) || -1) - (Number(a.rating) || -1));
    return arr;
  }, [filtered, sort, myLoc]);

  // Active filter pills for map overlay
  const activeFilters = useMemo(() => {
    const pills = [];
    if (q) pills.push({ key: "q", label: `"${q}"`, clear: () => setQ("") });
    if (city) pills.push({ key: "city", label: city, clear: () => setCity("") });
    if (cuisine) pills.push({ key: "cuisine", label: cuisine, clear: () => setCuisine("") });
    if (neighborhood) pills.push({ key: "hood", label: neighborhood, clear: () => setNeighborhood("") });
    if (tag) pills.push({ key: "tag", label: `#${tag}`, clear: () => setTag("") });
    if (price > 0) pills.push({ key: "price", label: priceLabel(price), clear: () => setPrice(0) });
    if (minRating > 0) pills.push({ key: "rating", label: `${minRating}+★`, clear: () => setMinRating(0) });
    if (wouldReturn) pills.push({ key: "return", label: "Would return", clear: () => setWouldReturn(false) });
    return pills;
  }, [q, city, cuisine, neighborhood, tag, price, minRating, wouldReturn]);

  // Selected place for bottom card
  const selectedPlace = selectedId != null ? places.find(p => p.id === selectedId) : null;

  function flyToPlace(p) {
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) return;

    setSelectedId(p.id);
    const map = mapRef.current;
    if (!map) return;

    const targetZoom = Math.max(map.getZoom(), 16);
    map.flyTo([Number(p.lat), Number(p.lon)], targetZoom, { duration: 0.6 });

    setTimeout(() => {
      const m = markerInstance(markerRefs.current[p.id]);
      m?.openPopup?.();
    }, 450);
  }

  function requestLocation() {
    setLocErr("");
    if (!navigator.geolocation) {
      setLocErr("Geolocation not supported in this browser.");
      showToast("Geolocation not supported.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        showToast("Using your location for nearest sort", "success");
      },
      (err) => {
        setLocErr(err.message || "Could not get location.");
        showToast(err.message || "Could not get location.", "error");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ✅ Prevent background scroll + stop layout shift from scrollbar disappearing
  useEffect(() => {
    const open = accountOpen || menuOpen;
    const body = document.body;

    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    if (open) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [accountOpen, menuOpen]);

  // ✅ Tabs: bolder active border (without layout shift), slightly softer inactive
  function tabBtn(active, size = "md") {
    const base =
      size === "lg"
        ? "min-h-[44px] rounded-full border-2 px-5 py-3 text-base font-medium md:text-lg"
        : "min-h-[44px] rounded-full border-2 px-4 py-2.5 text-sm font-medium";

    return [
      base,
      "box-border select-none no-underline",
      "transition-colors duration-150",
      "focus:outline-none focus:ring-2 focus:ring-[rgba(22,93,110,0.35)] focus:ring-offset-0",

      active
        ? [
            "bg-[rgba(22,93,110,0.14)]",
            // ✅ bolder + higher-contrast border
            "border-[rgba(22,93,110,0.92)]",
            "text-[#1F2A2E]",
          ].join(" ")
        : [
            "bg-[rgba(31,42,46,0.06)]",
            "border-[rgba(31,42,46,0.16)]",
            "text-[rgba(31,42,46,0.82)]",
            "hover:bg-[rgba(31,42,46,0.10)]",
            "hover:border-[rgba(31,42,46,0.26)]",
          ].join(" "),
    ].join(" ");
  }

  // Contact row helper
  function ContactRow({ label, value, href, copyValue, icon }) {
    const isExternal = href?.startsWith("http");
    const Row = href ? "a" : "div";
    const rowProps = href
      ? { href, target: isExternal ? "_blank" : undefined, rel: isExternal ? "noreferrer" : undefined }
      : {};

    return (
      <Row
        {...rowProps}
        className={[
          "flex items-center justify-between gap-4 rounded-xl border border-[#E0DCD4] bg-[#F7F5EF]/50 px-4 py-3",
          href ? "hover:bg-[#F1EEE6]" : "",
        ].join(" ")}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#E0DCD4] bg-[#F7F5EF] text-sm text-[#2A3A3E]">
            {icon}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="font-medium text-[#1F2A2E]">{label}</div>
            <div className="truncate text-sm text-[#5A6B6E] md:text-base">{value}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {copyValue ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                copyText(copyValue, `${label} copied`);
              }}
              className="grid h-11 w-11 place-items-center rounded-lg border border-[#E0DCD4] bg-[#F7F5EF] text-xs text-[#2A3A3E] hover:bg-[#F1EEE6] focus:outline-none focus:ring-2 focus:ring-white/25"
              aria-label={`Copy ${label}`}
              title={`Copy ${label}`}
            >
              ⧉
            </button>
          ) : null}
          {href ? <span className="text-[#B0BAB8]">↗</span> : null}
        </div>
      </Row>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-[#F7F5EF] text-[#1F2A2E]">
        <div className="w-full px-5 py-8 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Aleks Food Map</h1>
              <p className="mt-3 text-base text-[#8A9A9E] sm:text-lg">
                Seattle • Bellevue • and anywhere I eat something worth sharing.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Hamburger */}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(true);
                  setMenuTab("aboutMap");
                }}
                className="min-h-[48px] rounded-full border border-[#165D6E]/30 bg-[#F1EEE6]/80 px-4 py-2 text-sm text-[#2A3A3E] backdrop-blur-sm hover:bg-[#E0DCD4] hover:border-[#165D6E]/50"
                aria-label="Open map menu"
                title="Menu"
              >
                ☰
              </button>

              {/* Account */}
              <button
                type="button"
                onClick={() => {
                  setAccountOpen(true);
                  setAccountTab("about");
                }}
                className="min-h-[48px] flex items-center gap-3 rounded-full border border-[#165D6E]/30 bg-[#F1EEE6]/80 px-3.5 py-2 text-sm text-[#2A3A3E] backdrop-blur-sm hover:bg-[#E0DCD4] hover:border-[#165D6E]/50"
                aria-label="Open account"
                title="Account"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full border-2 border-[#165D6E]/60 bg-[#F1EEE6] text-sm font-bold text-[#165D6E] shadow-[0_0_8px_rgba(22,93,110,0.15)]">
                  A
                </span>
                <span className="hidden sm:block">Aleks</span>
              </button>

              {/* Version */}
              <div className="rounded-full border border-[#165D6E]/25 bg-[#F1EEE6]/80 px-4 py-2 text-sm text-[#165D6E]/80 backdrop-blur-sm">
                v0.3
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* Sidebar */}
            <div className="rounded-2xl border border-[#E0DCD4] bg-[#F1EEE6]/35 p-5">
              <div className="text-sm text-[#8A9A9E]">Search & Filters</div>

              {/* Toast */}
              {toast ? (
                <div
                  className={[
                    "mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm",
                    toast.variant === "success"
                      ? "border-emerald-900 bg-emerald-950/40 text-emerald-200"
                      : toast.variant === "error"
                      ? "border-red-900 bg-red-950/40 text-red-200"
                      : "border-[#E0DCD4] bg-[#F7F5EF]/60 text-[#2A3A3E]",
                  ].join(" ")}
                  role="status"
                  aria-live="polite"
                >
                  <span className="truncate">{toast.message}</span>
                  <button
                    onClick={() => setToast(null)}
                    className="min-h-[44px] rounded-lg border border-transparent px-2 py-1 text-xs text-[#5A6B6E] hover:border-[#D0CCC4] hover:bg-[#F1EEE6]"
                    aria-label="Dismiss"
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              ) : null}

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ramen, Belltown, $$$, date-night..."
                className="mt-3 w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#1F2A2E] placeholder:text-[#B0BAB8] outline-none focus:border-[#2E7682]"
              />

              {/* Buttons */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                >
                  Copy link
                </button>
              </div>

              {/* Filter row */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm"
                >
                  <option value="">City</option>
                  {facets.cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm"
                >
                  <option value="">Neighborhood</option>
                  {facets.hoods.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>

                <select
                  value={cuisine}
                  onChange={(e) => setCuisine(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm"
                >
                  <option value="">Cuisine</option>
                  {facets.cuisines.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm"
                >
                  <option value="">Tag</option>
                  {facets.tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                <select
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm"
                >
                  <option value={0}>Price</option>
                  <option value={1}>$</option>
                  <option value={2}>$$</option>
                  <option value={3}>$$$</option>
                  <option value={4}>$$$$</option>
                </select>

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Toggles */}
              <div className="mt-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-[#5A6B6E]">
                  <input
                    type="checkbox"
                    checked={wouldReturn}
                    onChange={(e) => setWouldReturn(e.target.checked)}
                  />
                  Would return
                </label>

                <div className="flex items-center gap-2 text-sm text-[#8A9A9E]">
                  Min rating{" "}
                  <select
                    value={minRating}
                    onChange={(e) => setMinRating(Number(e.target.value))}
                    className="min-h-[36px] rounded-lg border border-[#E0DCD4] bg-[#F7F5EF] px-2 py-1 text-sm"
                  >
                    <option value={0}>Any</option>
                    <option value={3}>3.0+</option>
                    <option value={3.5}>3.5+</option>
                    <option value={4}>4.0+</option>
                    <option value={4.5}>4.5+</option>
                  </select>
                </div>
              </div>

              {/* Location button for nearest */}
              {sort === "nearest" ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="min-h-[44px] w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                  >
                    {myLoc ? "Update my location" : "Use my location"}
                  </button>
                  {locErr ? <div className="mt-2 text-xs text-red-300">{locErr}</div> : null}
                </div>
              ) : null}

              {/* Results count */}
              <div className="mt-4 text-xs text-[#B0BAB8]">
                {sorted.length} / {places.length} spots
              </div>

              {/* Cards */}
              <div className="mt-3 space-y-2">
                {sorted.map((p) => {
                  const dist =
                    sort === "nearest" &&
                    myLoc &&
                    Number.isFinite(Number(p.lat)) &&
                    Number.isFinite(Number(p.lon))
                      ? haversineMiles(myLoc.lat, myLoc.lon, Number(p.lat), Number(p.lon))
                      : null;

                  const isEditing = editingId === p.id;

                  return (
                    <div
                      key={p.id}
                      className={[
                        "rounded-2xl border p-3 transition",
                        selectedId === p.id
                          ? "border-[#2E7682] bg-[#E0DCD4]/40"
                          : "border-[#E0DCD4] bg-[#F7F5EF]/40 hover:bg-[#F1EEE6]/50",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" onClick={() => flyToPlace(p)} className="flex-1 text-left">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold">{p.name}</div>
                              <div className="mt-1 text-xs text-[#8A9A9E]">
                                {p.neighborhood ? `${p.neighborhood} • ` : ""}
                                {p.city || ""}
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="text-sm text-[#2A3A3E]">
                                {ratingLabel(p.rating) === "New" ? "New" : `${ratingLabel(p.rating)}★`}
                              </div>
                              <div className="text-xs text-[#B0BAB8]">
                                {p.price ? priceLabel(p.price) : ""}
                                {dist != null ? ` • ${dist.toFixed(1)} mi` : ""}
                              </div>
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => (isEditing ? cancelEdit() : startEdit(p))}
                          className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-xs text-[#2A3A3E] hover:bg-[#F1EEE6]"
                        >
                          {isEditing ? "Close" : "Edit"}
                        </button>
                      </div>

                      {/* Photo preview */}
                      {p.photo ? (
                        <img src={p.photo} alt={p.name} className="mt-3 h-28 w-full rounded-xl object-cover" />
                      ) : null}

                      {/* Tags */}
                      {p.tags?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {p.tags.slice(0, 6).map((t) => (
                            <span
                              key={t}
                              className="rounded-full border border-[#E0DCD4] bg-[#F1EEE6] px-2 py-0.5 text-[11px] text-[#5A6B6E]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {/* Notes */}
                      {p.notes ? <div className="mt-2 text-sm text-[#5A6B6E]">{p.notes}</div> : null}

                      {/* Edit panel */}
                      {isEditing ? (
                        <div className="mt-3 rounded-2xl border border-[#E0DCD4] bg-[#F7F5EF]/60 p-3">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs text-[#8A9A9E]">
                              Rating
                              <input
                                value={draft?.rating ?? ""}
                                onChange={(e) => setDraft((d) => ({ ...(d || {}), rating: e.target.value }))}
                                type="number"
                                step="0.1"
                                min="0"
                                max="5"
                                placeholder="4.5"
                                className="mt-1 min-h-[44px] w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#1F2A2E] outline-none focus:border-[#2E7682]"
                              />
                            </label>

                            <label className="text-xs text-[#8A9A9E]">
                              Price
                              <select
                                value={draft?.price ?? ""}
                                onChange={(e) => setDraft((d) => ({ ...(d || {}), price: e.target.value }))}
                                className="mt-1 min-h-[44px] w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#1F2A2E] outline-none focus:border-[#2E7682]"
                              >
                                <option value="">—</option>
                                <option value="1">$</option>
                                <option value="2">$$</option>
                                <option value="3">$$$</option>
                                <option value="4">$$$$</option>
                              </select>
                            </label>
                          </div>

                          <label className="mt-3 flex items-center gap-2 text-sm text-[#5A6B6E]">
                            <input
                              type="checkbox"
                              checked={!!draft?.wouldReturn}
                              onChange={(e) => setDraft((d) => ({ ...(d || {}), wouldReturn: e.target.checked }))}
                            />
                            Would return
                          </label>

                          <label className="mt-3 block text-xs text-[#8A9A9E]">
                            Photo URL
                            <input
                              value={draft?.photo ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...(d || {}), photo: e.target.value }))}
                              placeholder="https://..."
                              className="mt-1 min-h-[44px] w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#1F2A2E] outline-none focus:border-[#2E7682]"
                            />
                          </label>

                          <label className="mt-3 block text-xs text-[#8A9A9E]">
                            Notes
                            <textarea
                              value={draft?.notes ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...(d || {}), notes: e.target.value }))}
                              rows={3}
                              placeholder="What did you get? Was it worth it?"
                              className="mt-1 w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#1F2A2E] outline-none focus:border-[#2E7682]"
                            />
                          </label>

                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveEdit(p.id)}
                              className="min-h-[44px] flex-1 rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="min-h-[44px] flex-1 rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-3 flex gap-2">
                        <a
                          href={mapsLink(p)}
                          target="_blank"
                          rel="noreferrer"
                          className="min-h-[44px] flex-1 rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-center text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                        >
                          Open in Maps
                        </a>
                        {p.website ? (
                          <a
                            href={p.website}
                            target="_blank"
                            rel="noreferrer"
                            className="min-h-[44px] flex-1 rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-center text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                          >
                            Website
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Map */}
            <div className="rounded-2xl border border-[#E0DCD4] bg-[#F1EEE6]/35 p-5">
              <div className="text-sm text-[#8A9A9E]">Map</div>

              <div className="relative mt-3 overflow-hidden rounded-2xl border border-[#E0DCD4]">
                <MapContainer
                  center={[47.6062, -122.3321]}
                  zoom={11}
                  style={{ height: "72vh", minHeight: 620, width: "100%" }}
                  maxBounds={AREA_BOUNDS}
                  maxBoundsViscosity={1.0}
                  whenReady={(e) => {
                    const map = e.target;
                    mapRef.current = map;

                    const bounds = L.latLngBounds(placesWithCoords.map((p) => [Number(p.lat), Number(p.lon)]));
                    map.fitBounds(bounds.isValid() ? bounds.pad(0.25) : AREA_BOUNDS, { padding: [24, 24] });

                    const z = map.getBoundsZoom(AREA_BOUNDS);
                    map.setMinZoom(Math.min(z, 18));
                  }}
                  maxZoom={18}
                  scrollWheelZoom
                >
                  <TileLayer url={TILE_URL} maxZoom={20} attribution="&copy; OpenStreetMap contributors" />

                  {placesWithCoords
                    .filter((p) => sorted.some((s) => s.id === p.id))
                    .map((p) => (
                        <Marker
                          key={p.id}
                          position={[Number(p.lat), Number(p.lon)]}
                          icon={makeRatingIcon(p.rating, selectedId === p.id, p.price, p.name)}
                          zIndexOffset={selectedId === p.id ? 1000 : 0}
                          _rating={p.rating != null ? Number(p.rating) : undefined}
                          ref={(ref) => {
                            if (ref) markerRefs.current[p.id] = ref;
                          }}
                          eventHandlers={{
                            click: () => {
                              setSelectedId(p.id);
                              setTimeout(() => {
                                const m = markerInstance(markerRefs.current[p.id]);
                                m?.openPopup?.();
                              }, 0);
                            },
                          }}
                        >
                          <Popup maxWidth={320} minWidth={260}>
                            <div>
                              {p.photo ? (
                                <img src={p.photo} alt={p.name} className="popup-photo" />
                              ) : null}
                              <div className="popup-body">
                                <div className="popup-name">{p.name}</div>
                                <div className="popup-meta">
                                  <span className={`popup-rating ${ratingColor(p.rating)}`}>
                                  {ratingLabel(p.rating) === "New" ? "New spot" : `${ratingLabel(p.rating)}★`}
                                </span>
                                  {p.price ? <span>{priceLabel(p.price)}</span> : null}
                                  {p.neighborhood ? <span>{p.neighborhood}</span> : null}
                                </div>
                                {(p.cuisine || []).length > 0 ? (
                                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {p.cuisine.slice(0, 3).map((c) => (
                                      <span key={c} className="popup-cuisine">{c}</span>
                                    ))}
                                  </div>
                                ) : null}
                                {p.notes ? <div className="popup-notes">{p.notes}</div> : null}
                                <div className="popup-actions">
                                  <a
                                    href={mapsLink(p)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="popup-btn popup-btn-primary"
                                  >
                                    Open in Maps
                                  </a>
                                  {p.website ? (
                                    <a
                                      href={p.website}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="popup-btn popup-btn-secondary"
                                    >
                                      Website
                                    </a>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                    ))}
                </MapContainer>

                {/* Floating filter pills */}
                {activeFilters.length > 0 ? (
                  <div className="pointer-events-none absolute top-3 left-14 z-[500]">
                    <div className="pointer-events-auto flex flex-wrap gap-1.5">
                      {activeFilters.map((f) => (
                        <button key={f.key} type="button" onClick={f.clear} className="filter-pill">
                          {f.label}
                          <span className="pill-x">✕</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}




              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Modal */}
      {accountOpen ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4 text-[#1F2A2E]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAccountOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Account modal"
        >
          {/* ✅ backdrop no longer steals clicks (fixes click-outside-to-close) */}
          <div className="pointer-events-none absolute inset-0 bg-[#0D0906]/80 backdrop-blur-sm" />

          <div className="relative w-[92vw] max-w-4xl rounded-3xl border border-[#165D6E]/20 bg-[#F7F5EF]/95 shadow-2xl">
            <div className="flex max-h-[80vh] min-h-[420px] flex-col overflow-hidden md:min-h-[560px]">
              {/* ✅ Subtle header surface (replaces “Windows 95” divider) */}
              <div className="bg-white/3 p-8">
                <div className="flex items-start justify-between gap-6">
                  {/* ✅ Hero name + stepped subtitle */}
                  <div className="min-w-0">
                    <div className="text-4xl font-bold tracking-tight leading-none text-[#1F2A2E] md:text-5xl">
                      Aleks
                    </div>
                    <div className="mt-2 text-sm font-normal tracking-wide text-[rgba(31,42,46,0.75)] md:text-base">
                      CS • frontend/UX • building fun products
                    </div>
                  </div>

                  {/* ✅ Close button aligned to the same top padding/grid (icon-only feel) */}
                  <button
                    type="button"
                    onClick={() => setAccountOpen(false)}
                    className={[
                      "grid h-11 w-11 shrink-0 place-items-center rounded-full",
                      "border border-transparent bg-transparent",
                      "text-lg text-[rgba(31,42,46,0.72)]",
                      "transition-colors duration-150",
                      "hover:bg-[rgba(31,42,46,0.06)] hover:border-[rgba(31,42,46,0.14)] hover:text-[#1F2A2E]",
                      "focus:outline-none focus:ring-2 focus:ring-[rgba(22,93,110,0.35)]",
                    ].join(" ")}
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>

                {/* ✅ Tabs as a separate block (reads like navigation) */}
                <div className="mt-6 flex flex-wrap gap-2">
                  {[
                    ["about", "About me"],
                    ["resume", "Resume"],
                    ["contact", "Contact"],
                  ].map(([key, label]) => {
                    const active = accountTab === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAccountTab(key)}
                        className={tabBtn(active, "lg")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ✅ Soft gradient divider between tabs + content */}
              <div className="h-px w-full bg-gradient-to-r from-transparent via-[rgba(22,93,110,0.55)] to-transparent opacity-100" />

              <div className="flex-1 overflow-y-auto px-8 pb-12 pt-6">
                {accountTab === "about" ? (
                  <div className="text-lg md:text-xl">
                    <div className="max-w-[70ch] leading-[1.75] text-[rgba(31,42,46,0.88)]">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[rgba(31,42,46,0.55)]">About</div>

                      {/* ✅ Short intro (2–3 lines) */}
                      <p className="mt-4">
                        Hello, I’m Aleksey (Aleks). I’m Belarusian-born and raised in Seattle software developer and UW Computer Science student who loves building simple, user focused apps and web projects. A lot of my ideas come from wanting something specific and not finding a version that feels quite right, so I build my own. I’m also a huge food person, so check out my ratings and send me your favorite spots to try next.
                      </p>

                    </div>
                  </div>
                ) : null}

                {accountTab === "resume" ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[rgba(31,42,46,0.55)]">
                        Resume
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <a
                          href={RESUME_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="min-h-[44px] rounded-full border-2 border-[rgba(22,93,110,0.92)] bg-[rgba(22,93,110,0.14)] px-4 py-2 text-sm font-medium text-[#1F2A2E] transition-colors hover:bg-[rgba(22,93,110,0.20)]"
                        >
                          Open Full Resume
                        </a>

                        <a
                          href={RESUME_URL}
                          download
                          className="min-h-[44px] rounded-full border-2 border-[rgba(31,42,46,0.16)] bg-[rgba(31,42,46,0.06)] px-4 py-2 text-sm font-medium text-[rgba(31,42,46,0.82)] transition-colors hover:bg-[rgba(31,42,46,0.10)] hover:border-[rgba(31,42,46,0.26)]"
                        >
                          Download
                        </a>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] p-3 md:p-4">
                      <div className="relative overflow-hidden rounded-xl bg-white shadow-[0_10px_40px_rgba(0,0,0,0.35)]">
                        <iframe
                          title="Resume Preview"
                          src={`${RESUME_URL}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`}
                          className="h-[420px] w-full bg-white md:h-[520px]"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent" />
                      </div>
                    </div>
                  </div>
                ) : null}

                {accountTab === "contact" ? (
                  <div className="space-y-4 text-base md:text-lg">
                    <div className="rounded-2xl border border-[#E0DCD4] bg-[#F7F5EF]/40 p-5">
                      <div className="text-sm text-[#8A9A9E] md:text-base">Contact</div>

                      <div className="mt-4 space-y-2">
                        <ContactRow
                          label="Email"
                          value="yanovichaleksey0@gmail.com"
                          icon="✉️"
                          copyValue="yanovichaleksey0@gmail.com"
                        />
                        <ContactRow
                          label="LinkedIn"
                          value="linkedin.com/in/aleksey-andreyvich-yanovich"
                          href="https://www.linkedin.com/in/aleksey-andreyvich-yanovich/"
                          icon="in"
                        />
                        <ContactRow
                          label="GitHub"
                          value="github.com/yanovichaleksey0-beep"
                          href="https://github.com/yanovichaleksey0-beep"
                          icon="⌂"
                        />
                        <ContactRow
                          label="Instagram"
                          value="instagram.com/aleks._.yanovich"
                          href="https://www.instagram.com/aleks._.yanovich/"
                          icon="◎"
                        />
                        <ContactRow
                          label="Letterboxd"
                          value="boxd.it/6Cm0N"
                          href="https://boxd.it/6Cm0N"
                          icon="★"
                        />
                      </div>

                      <div className="mt-3 text-xs text-[#B0BAB8]">
                        Tip: click the copy icon next to email to paste it anywhere.
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Menu Modal (Hamburger) */}
      {menuOpen ? (
        <div
          className="fixed inset-0 z-[999] flex items-start justify-end p-4 md:p-6 text-[#1F2A2E]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMenuOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Menu modal"
        >
          {/* ✅ backdrop no longer steals clicks */}
          <div className="pointer-events-none absolute inset-0 bg-[#0D0906]/80 backdrop-blur-sm" />

          <div className="relative w-[92vw] max-w-xl rounded-3xl border border-[#165D6E]/20 bg-[#F7F5EF]/95 shadow-2xl">
            <div className="flex max-h-[80vh] min-h-[360px] flex-col overflow-hidden md:min-h-[420px]">
              {/* ✅ Header surface + consistent alignment */}
              <div className="bg-white/3 p-5 md:p-6">
                <div className="flex items-center justify-between gap-6">
                  <div className="text-xl font-semibold md:text-2xl">Menu</div>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="grid h-12 w-12 place-items-center rounded-xl border border-[#165D6E]/20 bg-[#F1EEE6] text-lg text-[#5A6B6E] hover:bg-[#E0DCD4] hover:text-[#1F2A2E] focus:outline-none focus:ring-2 focus:ring-[#165D6E]/25"
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-2 text-sm font-medium text-[#2A3A3E] md:text-base">
                  About • Featured • Stats
                </div>

                {/* ✅ Tabs: pill-only (no underline, no divider) */}
                <div className="mt-5 flex flex-wrap gap-2">
                  {[
                    ["aboutMap", "About this map"],
                    ["featured", "Featured lists"],
                    ["stats", "Stats"],
                  ].map(([key, label]) => {
                    const active = menuTab === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setMenuTab(key)}
                        className={tabBtn(active, "md")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ✅ No “Windows 95” divider — whitespace + readable line length */}
              <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2 md:px-6 md:pb-10 md:pt-2">
                {menuTab === "aboutMap" ? (
                  <div className="space-y-3 text-sm text-[#5A6B6E]">
                    <p className="max-w-[640px] leading-relaxed">
                      This is my personal food map. Use the left filters to explore by city, neighborhood, cuisine,
                      tags, and rating.
                    </p>
                    <p className="max-w-[640px] leading-relaxed text-[#8A9A9E]">
                      Tip: click a card to fly to the pin. Use “Copy link” to share the current view.
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={exportPlaces}
                        className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-4 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                      >
                        Export JSON
                      </button>
                      <button
                        type="button"
                        onClick={clearLocalEdits}
                        className="min-h-[44px] rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-4 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                      >
                        Reset edits
                      </button>
                    </div>
                    <p className="text-[11px] text-[#B0BAB8]">
                      Quick-edits save in this browser. Export JSON to make them permanent in your repo.
                    </p>
                  </div>
                ) : null}

                {menuTab === "featured" ? (
                  <div className="space-y-2">
                    {[
                      ["top", "Top rated (4.5+)"],
                      ["recent", "Most recent"],
                      ["date-night", "Date-night"],
                      ["late-night", "Late-night"],
                      ["cheap", "Cheap eats ($)"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => applyFeatured(key)}
                        className="min-h-[44px] w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-4 py-2 text-left text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {menuTab === "stats" ? (
                  <div className="space-y-3 text-sm text-[#5A6B6E]">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF]/50 p-3">
                        <div className="text-[#8A9A9E]">Total spots</div>
                        <div className="mt-1 text-lg font-semibold">{stats.total}</div>
                      </div>
                      <div className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF]/50 p-3">
                        <div className="text-[#8A9A9E]">Avg rating</div>
                        <div className="mt-1 text-lg font-semibold">
                          {stats.avgRating == null ? "—" : stats.avgRating.toFixed(2)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF]/50 p-3">
                        <div className="text-[#8A9A9E]">Would return</div>
                        <div className="mt-1 text-lg font-semibold">{stats.wouldReturnPct}%</div>
                      </div>
                      <div className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF]/50 p-3">
                        <div className="text-[#8A9A9E]">Rated</div>
                        <div className="mt-1 text-lg font-semibold">{stats.ratedCount}</div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF]/50 p-3">
                      <div className="text-[#8A9A9E]">Top cuisines</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {stats.topCuisines.length ? (
                          stats.topCuisines.map(([c, n]) => (
                            <span
                              key={c}
                              className="rounded-full border border-[#E0DCD4] bg-[#F1EEE6] px-2 py-1 text-[12px] text-[#5A6B6E]"
                            >
                              {c} • {n}
                            </span>
                          ))
                        ) : (
                          <span className="text-[#B0BAB8]">No cuisine data yet.</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}