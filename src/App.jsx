// App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

import placesData from "./data/Places.json";
import Steak from "./assets/Steak.PNG";
import CaseStudyImage from "./assets/Case.png";

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

const yorkieUserIcon = L.icon({
  iconUrl: Steak,
  iconSize: [32, 32],
  iconAnchor: [14, 24],
  popupAnchor: [0, -20],
  className: "yorkie-user-icon",
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

// ── Region filter chips (two-tier) ──
const REGIONS = [
  { key: "all", label: "All Spots" },
  { key: "seattle", label: "Seattle" },
  { key: "bellevue", label: "Bellevue" },
  { key: "lynnwood", label: "Lynnwood" },
  { key: "redmond", label: "Redmond" },
  { key: "kirkland", label: "Kirkland" },
  { key: "south-end", label: "South End" },
  { key: "edmonds", label: "Edmonds" },
  { key: "shoreline", label: "Shoreline" },
  { key: "ballard", label: "Ballard" },
  { key: "everett", label: "Everett" },
];

const SEATTLE_HOODS = [
  { key: "all-seattle", label: "All Seattle" },
  { key: "u-district", label: "U District" },
  { key: "fremont", label: "Fremont" },
  { key: "capitol-hill", label: "Capitol Hill" },
  { key: "downtown", label: "Downtown" },
  { key: "slu", label: "South Lake Union" },
  { key: "queen-anne", label: "Queen Anne" },
  { key: "west-seattle", label: "West Seattle" },
  { key: "green-lake", label: "Green Lake" },
  { key: "roosevelt", label: "Roosevelt" },
  { key: "eastlake", label: "Eastlake" },
];

function regionMatchesPlace(place, regionKey, subRegionKey) {
  const city = (place.city || "").toLowerCase();
  const hood = (place.neighborhood || "").toLowerCase();
  const addr = (place.address || "").toLowerCase();

  // Top-level region filter
  if (regionKey === "all") return true;

  if (regionKey === "seattle") {
    const isSeattle = city === "seattle" || (!city && addr.includes("seattle"));
    if (!isSeattle) return false;
    // Sub-region filter
    if (!subRegionKey || subRegionKey === "all-seattle") return true;
    switch (subRegionKey) {
      case "u-district":      return hood === "university district" || hood === "u district";
      case "fremont":         return hood === "fremont";
      case "capitol-hill":    return hood === "capitol hill";
      case "downtown":        return hood === "downtown";
      case "slu":             return hood === "south lake union";
      case "queen-anne":      return hood === "queen anne";
      case "west-seattle":    return hood === "west seattle";
      case "green-lake":      return hood === "green lake";
      case "roosevelt":       return hood === "roosevelt";
      case "eastlake":        return hood === "eastlake";
      default: return true;
    }
  }

  switch (regionKey) {
    case "bellevue":    return city === "bellevue";
    case "lynnwood":    return city === "lynnwood";
    case "redmond":     return city === "redmond";
    case "kirkland":    return city === "kirkland";
    case "south-end":   return ["tacoma", "renton", "tukwila", "kent", "federal way", "auburn"].includes(city);
    case "edmonds":     return city === "edmonds";
    case "shoreline":   return city === "shoreline";
    case "ballard":     return hood === "ballard" && (city === "seattle" || (!city && addr.includes("seattle")));
    case "everett":     return city === "everett";
    default: return false;
  }
}

const SORTS = [
  { value: "top", label: "Top rated" },
  { value: "lowest", label: "Lowest rated" },
  { value: "recent", label: "Newest added" },
  { value: "name", label: "A–Z" },
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
  const locationQ = sp.get("loc") ?? "";
  const pricesRaw = sp.get("prices") ?? "";
  const prices = pricesRaw ? pricesRaw.split(",").map(Number).filter((n) => n >= 1 && n <= 4) : [];
  const minRating = Number(sp.get("minRating") ?? "0");
  const sort = sp.get("sort") ?? "top";
  return { q, locationQ, prices, minRating, sort };
}

function writeUrlState(state) {
  const sp = new URLSearchParams();
  if (state.q) sp.set("q", state.q);
  if (state.locationQ) sp.set("loc", state.locationQ);
  if (state.prices?.length) sp.set("prices", state.prices.join(","));
  if (state.minRating > 0) sp.set("minRating", String(state.minRating));
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

// ── Preset region views (fixed bounds, not data-dependent) ──
const REGION_VIEWS = {
  // Top-level regions
  all:            { bounds: [[47.45, -122.48], [48.02, -122.0]], zoom: 11 },
  seattle:        { bounds: [[47.56205, -122.42736], [47.65174, -122.19253]], zoom: 13 },
  "all-seattle":  { bounds: [[47.56205, -122.42736], [47.65174, -122.19253]], zoom: 13 },
  bellevue:       { bounds: [[47.59985, -122.22211], [47.64469, -122.1047]], zoom: 14 },
  lynnwood:       { bounds: [[47.77752, -122.37534], [47.86685, -122.14051]], zoom: 13 },
  redmond:        { bounds: [[47.65608, -122.16491], [47.70087, -122.0475]], zoom: 14 },
  kirkland:       { bounds: [[47.65481, -122.23774], [47.69959, -122.12032]], zoom: 14 },
  "south-end":    { bounds: [[47.45003, -122.33362], [47.53992, -122.09878]], zoom: 13 },
  edmonds:        { bounds: [[47.78917, -122.42255], [47.83385, -122.30513]], zoom: 14 },
  shoreline:      { bounds: [[47.69498, -122.43096], [47.78444, -122.19613]], zoom: 13 },
  ballard:        { bounds: [[47.65573, -122.4271], [47.70052, -122.30968]], zoom: 14 },
  everett:        { bounds: [[47.90334, -122.31351], [47.99245, -122.07868]], zoom: 13 },
  // Seattle neighborhoods
  "u-district":   { bounds: [[47.652, -122.325], [47.672, -122.295]], zoom: 15 },
  "fremont":      { bounds: [[47.647, -122.365], [47.667, -122.340]], zoom: 15 },
  "capitol-hill": { bounds: [[47.608, -122.330], [47.636, -122.300]], zoom: 15 },
  "downtown":     { bounds: [[47.596, -122.350], [47.618, -122.322]], zoom: 15 },
  "slu":          { bounds: [[47.618, -122.348], [47.636, -122.328]], zoom: 15 },
  "queen-anne":   { bounds: [[47.620, -122.375], [47.650, -122.340]], zoom: 14 },
  "west-seattle": { bounds: [[47.520, -122.410], [47.580, -122.350]], zoom: 13 },
  "green-lake":   { bounds: [[47.668, -122.360], [47.688, -122.325]], zoom: 15 },
  "roosevelt":    { bounds: [[47.672, -122.325], [47.688, -122.306]], zoom: 15 },
  "eastlake":     { bounds: [[47.628, -122.338], [47.648, -122.318]], zoom: 15 },
};

// ── Region map controller (uses preset bounds, falls back for Near Me) ──
function RegionController({ regionKey, subRegionKey, nearMeActive, userLoc, places }) {
  const map = useMap();
  const prevKey = useRef("");

  useEffect(() => {
    // Near Me: dynamic fit to user + nearby places
    if (nearMeActive && userLoc) {
      const nk = `nearme:${userLoc.lat}:${userLoc.lon}`;
      if (prevKey.current === nk) return;
      prevKey.current = nk;

      const coords = places
        .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
        .map((p) => [Number(p.lat), Number(p.lon)]);
      coords.push([userLoc.lat, userLoc.lon]);

      if (coords.length === 1) {
        map.flyTo(coords[0], 14, { duration: 0.55 });
      } else {
        const bounds = L.latLngBounds(coords);
        if (bounds.isValid()) {
          map.flyToBounds(bounds.pad(0.1), {
            duration: 0.55,
            maxZoom: 15,
            paddingTopLeft: [20, 120],
            paddingBottomRight: [20, 20],
          });
        }
      }
      return;
    }

    const key =
      regionKey === "seattle" ? subRegionKey || "all-seattle" : regionKey;

    if (prevKey.current === key) return;
    prevKey.current = key;

    const preset =
      REGION_VIEWS[key] ||
      REGION_VIEWS[regionKey] ||
      REGION_VIEWS.all;

    if (!preset?.bounds) return;

    map.flyToBounds(preset.bounds, {
      duration: 0.55,
      paddingTopLeft: [20, 120],
      paddingBottomRight: [20, 20],
      maxZoom: preset.zoom ?? 18,
    });
  }, [map, regionKey, subRegionKey, nearMeActive, userLoc, places]);

  return null;
}

function MapNearMeButton({ active, onClick }) {
  return (
    <div
      className="pointer-events-none absolute left-3 z-[725]"
      style={{ top: "calc(var(--map-controls-top, 72px) + 100px)" }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={active ? "Turn off Near Me" : "Use my location"}
        title={active ? "Turn off Near Me" : "Use my location"}
        className={[
          "pointer-events-auto relative grid h-11 w-11 place-items-center rounded-full border transition-all duration-150",
          "backdrop-blur-md shadow-[0_8px_20px_rgba(0,0,0,0.10)]",
          "focus:outline-none focus:ring-2 focus:ring-[rgba(22,93,110,0.28)]",
          active
            ? "border-[#165D6E]/80 bg-[#165D6E] text-white shadow-[0_10px_24px_rgba(22,93,110,0.25)]"
            : "border-[rgba(22,93,110,0.18)] bg-[rgba(247,245,239,0.92)] text-[#165D6E] hover:bg-[rgba(241,238,230,0.96)] hover:border-[rgba(22,93,110,0.30)]",
        ].join(" ")}
      >
        {active ? (
          <span className="absolute inset-0 rounded-full ring-4 ring-[#165D6E]/15" />
        ) : null}

        <svg
          viewBox="0 0 24 24"
          className="relative h-[18px] w-[18px] -rotate-[8deg]"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 3L19 20L12 16.9L5 20L12 3Z" />
        </svg>
      </button>
    </div>
  );
}

function MapToolbar({
  activeRegion,
  activeSubRegion,
  handleSelectRegion,
  handleSelectSeattleSubregion,
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-[700] w-[calc(100%-28px)] max-w-[980px] -translate-x-1/2">
      <div className="pointer-events-auto flex flex-col rounded-[20px] border border-[rgba(255,255,255,0.42)] bg-[rgba(255,255,255,0.50)] px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.10)] backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(255,255,255,0.42)]">
        <div
          className="hide-scrollbar overflow-x-auto overflow-y-hidden whitespace-nowrap scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex min-w-max items-center gap-1.5 pr-1">
            {REGIONS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => handleSelectRegion(r.key)}
                className={[
                  "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium leading-none transition-all duration-150",
                  activeRegion === r.key
                    ? "border border-[#165D6E]/10 bg-[#165D6E] text-white shadow-[0_2px_8px_rgba(22,93,110,0.18)]"
                    : "border border-[rgba(0,0,0,0.06)] bg-[rgba(255,255,255,0.38)] text-[#5A6B6E] hover:bg-[rgba(255,255,255,0.56)] hover:text-[#1F2A2E]",
                ].join(" ")}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {activeRegion === "seattle" ? (
          <div
            className="hide-scrollbar mt-1.5 overflow-x-auto overflow-y-hidden whitespace-nowrap scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="flex min-w-max items-center gap-1.5 pr-1">
              {SEATTLE_HOODS.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  onClick={() => handleSelectSeattleSubregion(h.key)}
                  className={[
                    "shrink-0 rounded-full px-3 py-1 text-[11px] font-medium leading-none transition-all duration-150",
                    activeSubRegion === h.key
                      ? "border border-[#2E7682]/10 bg-[#2E7682] text-white shadow-[0_2px_8px_rgba(46,118,130,0.18)]"
                      : "border border-[rgba(0,0,0,0.05)] bg-[rgba(255,255,255,0.32)] text-[#7A888C] hover:bg-[rgba(255,255,255,0.48)] hover:text-[#5A6B6E]",
                  ].join(" ")}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapControlPill({ active, onLocateClick, topOffset = 72 }) {
  const map = useMap();

  return (
    <div
      className="pointer-events-none absolute left-3 z-[725]"
      style={{ top: `${topOffset}px` }}
    >
      <div
        className="
          pointer-events-auto
          flex flex-col overflow-hidden
          rounded-[24px]
          border border-[rgba(255,255,255,0.42)]
          bg-[rgba(255,255,255,0.52)]
          backdrop-blur-xl
          shadow-[0_8px_24px_rgba(0,0,0,0.10)]
          supports-[backdrop-filter]:bg-[rgba(255,255,255,0.42)]
        "
      >
        <button
          type="button"
          onClick={() => map.zoomIn()}
          aria-label="Zoom in"
          title="Zoom in"
          className="
            grid h-12 w-12 place-items-center
            text-[28px] leading-none text-[#165D6E]
            transition-colors hover:bg-[rgba(255,255,255,0.22)]
          "
        >
          +
        </button>

        <div className="mx-2 h-px bg-[rgba(0,0,0,0.06)]" />

        <button
          type="button"
          onClick={() => map.zoomOut()}
          aria-label="Zoom out"
          title="Zoom out"
          className="
            grid h-12 w-12 place-items-center
            text-[30px] leading-none text-[#165D6E]
            transition-colors hover:bg-[rgba(255,255,255,0.22)]
          "
        >
          −
        </button>

        <div className="mx-2 h-px bg-[rgba(0,0,0,0.06)]" />

        <button
          type="button"
          onClick={onLocateClick}
          aria-label={active ? "Turn off Near Me" : "Use my location"}
          title={active ? "Turn off Near Me" : "Use my location"}
          className={[
            "relative grid h-12 w-12 place-items-center transition-colors",
            active
              ? "bg-[rgba(255,255,255,0.18)] text-[#1E88E5]"
              : "text-[#1E88E5] hover:bg-[rgba(255,255,255,0.22)]",
          ].join(" ")}
        >
          <svg
            viewBox="0 0 24 24"
            className="relative z-[1] h-[23px] w-[23px] -rotate-[8deg]"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 3L19 20L12 16.9L5 20L12 3Z" />
          </svg>
        </button>
      </div>
    </div>
  );
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
  const [locationQ, setLocationQ] = useState(initial.locationQ);
  const [prices, setPrices] = useState(initial.prices);
  const [minRating, setMinRating] = useState(initial.minRating);
  const [sort, setSort] = useState(initial.sort);

  function togglePrice(level) {
    setPrices((prev) =>
      prev.includes(level) ? prev.filter((p) => p !== level) : [...prev, level].sort()
    );
  }

  // Selection
  const [selectedId, setSelectedId] = useState(null);

  // Region chips (two-tier)
  const [activeRegion, setActiveRegion] = useState("all");
  const [activeSubRegion, setActiveSubRegion] = useState("all-seattle");

  // Near Me mode
  const [nearMeActive, setNearMeActive] = useState(false);
  const [nearMeRadius, setNearMeRadius] = useState(5); // miles

  // Overlay/drawer state
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTab, setAccountTab] = useState("about"); // "about" | "resume" | "caseStudy" | "contact"
  const [caseStudyFull, setCaseStudyFull] = useState(false);
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
    setLocationQ("");
    setPrices([]);
    setMinRating(0);
    setQ("");

    if (which === "top") {
      setSort("top");
      setMinRating(4.5);
      showToast("Showing top rated (4.5+)", "success");
      return;
    }
    if (which === "date-night") {
      setSort("top");
      setQ("date-night");
      showToast("Featured: date-night", "success");
      return;
    }
    if (which === "late-night") {
      setSort("top");
      setQ("late-night");
      showToast("Featured: late-night", "success");
      return;
    }
    if (which === "cheap") {
      setSort("top");
      setPrices([1]);
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
    writeUrlState({ q, locationQ, prices, minRating, sort });
  }, [q, locationQ, prices, minRating, sort]);

  // Back/Forward restores state
  useEffect(() => {
    const onPop = () => {
      const s = parseUrlState();
      setQ(s.q);
      setLocationQ(s.locationQ);
      setPrices(s.prices);
      setMinRating(s.minRating);
      setSort(s.sort);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function clearFilters() {
    setQ("");
    setLocationQ("");
    setPrices([]);
    setMinRating(0);
    setSort("top");
    setSelectedId(null);
    showToast("Filters cleared", "info");
  }

  async function copyLink() {
    const url = window.location.href;
    await copyText(url, "Link copied!");
  }

  // Filtering
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const lq = locationQ.trim().toLowerCase();
    return places.filter((p) => {
      // Location fuzzy filter
      if (lq) {
        const locHay = [p.city, p.neighborhood, p.address].filter(Boolean).join(" ").toLowerCase();
        if (!locHay.includes(lq)) return false;
      }

      // Price multi-select
      if (prices.length > 0 && !prices.includes(Number(p.price || 0))) return false;

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
  }, [places, q, locationQ, prices, minRating]);

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
    if (sort === "lowest") {
      arr.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
      return arr;
    }
    arr.sort((a, b) => (Number(b.rating) || -1) - (Number(a.rating) || -1));
    return arr;
  }, [filtered, sort, myLoc]);

  // Region-filtered places
  const regionFiltered = useMemo(() => {
    let list = sorted;
    if (activeRegion !== "all") {
      list = list.filter((p) => regionMatchesPlace(p, activeRegion, activeRegion === "seattle" ? activeSubRegion : null));
    }
    if (nearMeActive && myLoc) {
      list = list.filter((p) => {
        if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) return false;
        return haversineMiles(myLoc.lat, myLoc.lon, Number(p.lat), Number(p.lon)) <= nearMeRadius;
      });
    }
    return list;
  }, [sorted, activeRegion, activeSubRegion, nearMeActive, myLoc, nearMeRadius]);

  // Active filter pills for map overlay
  const activeFilters = useMemo(() => {
    const pills = [];
    if (q) pills.push({ key: "q", label: `"${q}"`, clear: () => setQ("") });
    if (locationQ) pills.push({ key: "loc", label: locationQ, clear: () => setLocationQ("") });
    if (prices.length > 0) pills.push({ key: "prices", label: prices.map((p) => "$".repeat(p)).join(" "), clear: () => setPrices([]) });
    if (minRating > 0) pills.push({ key: "rating", label: `${minRating}+★`, clear: () => setMinRating(0) });
    return pills;
  }, [q, locationQ, prices, minRating]);

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

  function handleSelectRegion(regionKey) {
    setNearMeActive(false);
    setActiveRegion(regionKey);
    if (regionKey !== "seattle") setActiveSubRegion("all-seattle");
  }

  function handleSelectSeattleSubregion(subKey) {
    setNearMeActive(false);
    setActiveRegion("seattle");
    setActiveSubRegion(subKey);
  }

  function resetMapView() {
    setNearMeActive(false);
    setActiveRegion("all");
    setActiveSubRegion("all-seattle");
  }

  function toggleNearMe() {
    if (nearMeActive) {
      setNearMeActive(false);
      return;
    }

    setLocErr("");
    if (!navigator.geolocation) {
      showToast("Geolocation not supported.", "error");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setMyLoc(loc);

        // Near Me should behave like a standalone mode
        setActiveRegion("all");
        setActiveSubRegion("all-seattle");
        setNearMeActive(true);

        showToast(`Showing spots within ${nearMeRadius} mi`, "success");
      },
      (err) => {
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
        <div className="w-full px-5 py-7 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <div className="flex items-start justify-between gap-6 md:gap-8">
            <div className="brand-lockup">
              <h1 className="brand-title" aria-label="Aleks Food Map">
                <span className="brand-title-aleks">Aleks</span>
                <span className="brand-title-map">Food Map</span>
              </h1>

              <div className="brand-accent" aria-hidden="true" />

              <p className="brand-subtitle">
                Seattle • Bellevue • and anywhere I eat something worth sharing.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Hamburger — slightly quieter */}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(true);
                  setMenuTab("aboutMap");
                }}
                className="min-h-[48px] rounded-full border border-[#165D6E]/16 bg-[#F7F5EF]/72 px-4 py-2 text-sm text-[#5A6B6E] backdrop-blur-sm transition-all duration-150 hover:border-[#165D6E]/28 hover:bg-[#F1EEE6] hover:text-[#1F2A2E]"
                aria-label="Open map menu"
                title="Menu"
              >
                ☰
              </button>

              {/* About / Account — PRIMARY */}
              <button
                type="button"
                onClick={() => {
                  setAccountOpen(true);
                  setAccountTab("about");
                }}
                className={[
                  "group relative min-h-[54px] flex items-center gap-3 rounded-full pl-2 pr-4 py-2",
                  "border border-[#165D6E]/40 bg-[#F7F5EF]/96 text-[#1F2A2E] backdrop-blur-sm",
                  "ring-1 ring-[#165D6E]/8 shadow-[0_10px_24px_rgba(22,93,110,0.14)]",
                  "transition-all duration-200",
                  "hover:-translate-y-[1px] hover:border-[#165D6E]/58 hover:shadow-[0_14px_32px_rgba(22,93,110,0.20)]",
                ].join(" ")}
                aria-label="Open About Aleks"
                title="About Aleks"
              >
                {/* avatar */}
                <span
                  className={[
                    "grid h-11 w-11 place-items-center rounded-full",
                    "bg-[#165D6E] text-sm font-bold text-white",
                    "shadow-[0_0_0_4px_rgba(22,93,110,0.10),0_8px_18px_rgba(22,93,110,0.24)]",
                    "transition-transform duration-200 group-hover:scale-[1.04]",
                  ].join(" ")}
                >
                  A
                </span>

                {/* text */}
                <span className="hidden sm:flex flex-col items-start leading-none">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A9A9E]">
                    Profile
                  </span>
                  <span className="mt-1 text-[15px] font-semibold text-[#1F2A2E]">
                    About Aleks
                  </span>
                </span>
              </button>

              {/* Version — quieter */}
              <div className="rounded-full border border-[#165D6E]/14 bg-[#F7F5EF]/72 px-4 py-2 text-sm text-[#8A9A9E] backdrop-blur-sm">
                v0.3
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            {/* Sidebar */}
            <div className="xl:max-h-[calc(100vh-160px)] xl:overflow-y-auto xl:scrollbar-thin rounded-2xl border border-[#E0DCD4] bg-[#F1EEE6]/35 p-4">
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold text-[#1F2A2E]">Find a spot</div>
                <div className="text-xs text-[#B0BAB8]">{places.length} total</div>
              </div>

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

              {/* Search */}
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-[#8A9A9E]">
                Search
              </label>
              <div className="relative mt-1">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B0BAB8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                </svg>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Restaurants, dishes, tags…"
                  className="w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] py-2 pl-9 pr-3 text-sm text-[#1F2A2E] placeholder:text-[#B0BAB8] outline-none focus:border-[#2E7682]"
                />
              </div>

              {/* Location */}
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-[#8A9A9E]">
                Location
              </label>
              <div className="relative mt-1">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B0BAB8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                <input
                  value={locationQ}
                  onChange={(e) => setLocationQ(e.target.value)}
                  placeholder="Seattle, Bellevue, Ballard…"
                  className="w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] py-2 pl-9 pr-3 text-sm text-[#1F2A2E] placeholder:text-[#B0BAB8] outline-none focus:border-[#2E7682]"
                />
              </div>

              {/* Price */}
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-[#8A9A9E]">
                Price
              </label>
              <div className="mt-1 flex gap-1.5">
                {[1, 2, 3, 4].map((level) => {
                  const active = prices.includes(level);
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => togglePrice(level)}
                      className={[
                        "flex-1 rounded-xl border py-1.5 text-center text-sm font-semibold transition-all duration-150",
                        active
                          ? "border-[#165D6E]/40 bg-[#165D6E]/15 text-[#165D6E]"
                          : "border-[#E0DCD4] bg-[#F7F5EF] text-[#8A9A9E] hover:bg-[#F1EEE6] hover:text-[#5A6B6E]",
                      ].join(" ")}
                    >
                      {"$".repeat(level)}
                    </button>
                  );
                })}
              </div>

              {/* Min score */}
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-[#8A9A9E]">
                Min score
              </label>
              <div className="mt-1 flex gap-1.5">
                {[
                  { value: 0, label: "Any" },
                  { value: 6, label: "6+" },
                  { value: 7, label: "7+" },
                  { value: 8, label: "8+" },
                  { value: 9, label: "9+" },
                ].map((opt) => {
                  const active = minRating === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMinRating(opt.value)}
                      className={[
                        "flex-1 rounded-xl border py-1.5 text-center text-sm font-semibold transition-all duration-150",
                        active
                          ? "border-[#165D6E]/40 bg-[#165D6E]/15 text-[#165D6E]"
                          : "border-[#E0DCD4] bg-[#F7F5EF] text-[#8A9A9E] hover:bg-[#F1EEE6] hover:text-[#5A6B6E]",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Sort by */}
              <label className="mt-3 block text-[11px] font-semibold uppercase tracking-widest text-[#8A9A9E]">
                Sort by
              </label>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  if (e.target.value === "nearest" && !myLoc) requestLocation();
                }}
                className="mt-1 w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#1F2A2E] outline-none focus:border-[#2E7682]"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>

              {/* Location button for nearest */}
              {sort === "nearest" ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={requestLocation}
                    className="min-h-[36px] w-full rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2 text-sm text-[#2A3A3E] hover:bg-[#F1EEE6]"
                  >
                    {myLoc ? "Update my location" : "Use my location"}
                  </button>
                  {locErr ? <div className="mt-1 text-xs text-red-400">{locErr}</div> : null}
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={toggleNearMe}
                  className={[
                    "min-h-[36px] flex-[2] rounded-xl border px-3 py-2 text-sm font-semibold transition-all duration-150",
                    nearMeActive
                      ? "border-[#165D6E] bg-[#165D6E] text-white shadow-[0_2px_8px_rgba(22,93,110,0.25)]"
                      : "border-[#165D6E]/30 bg-[#165D6E]/10 text-[#165D6E] hover:bg-[#165D6E]/18",
                  ].join(" ")}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 3L19 20L12 16.9L5 20L12 3Z" /></svg>
                    {nearMeActive ? "Near Me ✓" : "Near Me"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="min-h-[36px] flex-1 rounded-xl border border-[#E0DCD4] bg-transparent px-3 py-2 text-xs font-medium text-[#8A9A9E] hover:bg-[#F1EEE6] hover:text-[#5A6B6E]"
                >
                  Clear all
                </button>
              </div>

              {/* Active filter chips */}
              {activeFilters.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activeFilters.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={f.clear}
                      className="inline-flex items-center gap-1 rounded-full border border-[#165D6E]/20 bg-[#165D6E]/8 px-2.5 py-1 text-[11px] font-semibold text-[#165D6E] transition-colors hover:bg-[#165D6E]/15"
                    >
                      {f.label}
                      <span className="text-[9px] opacity-60">✕</span>
                    </button>
                  ))}
                  {nearMeActive ? (
                    <button
                      type="button"
                      onClick={toggleNearMe}
                      className="inline-flex items-center gap-1 rounded-full border border-[#165D6E]/20 bg-[#165D6E]/8 px-2.5 py-1 text-[11px] font-semibold text-[#165D6E] transition-colors hover:bg-[#165D6E]/15"
                    >
                      Near Me
                      <span className="text-[9px] opacity-60">✕</span>
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* Divider + results count */}
              <div className="mt-3 flex items-center gap-2.5">
                <div className="h-px flex-1 bg-[#E0DCD4]" />
                <span className="text-xs font-semibold text-[#8A9A9E]">
                  {regionFiltered.length} {regionFiltered.length === 1 ? "spot" : "spots"}
                </span>
                <div className="h-px flex-1 bg-[#E0DCD4]" />
              </div>

              {/* Cards */}
              <div className="mt-2.5 space-y-2.5">
                {regionFiltered.map((p) => {
                  const isSelected = selectedId === p.id;
                  const ratingText = ratingLabel(p.rating);
                  const wideRating = ratingText.length >= 3;

                  return (
                    <div
                      key={p.id}
                      onClick={() => flyToPlace(p)}
                      className={[
                        "cursor-pointer rounded-2xl border p-3.5 transition-all duration-150",
                        isSelected
                          ? "border-[#165D6E]/30 bg-[#165D6E]/[0.05] shadow-[0_2px_10px_rgba(22,93,110,0.06)]"
                          : "border-[#E0DCD4] bg-[#F7F5EF]/55 hover:border-[#D6D1C8] hover:bg-[#F7F5EF]",
                      ].join(" ")}
                    >
                      {/* Top row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 pr-2">
                          <div className="text-[22px] font-semibold tracking-[-0.03em] leading-[1.05] text-[#1F2A2E]">
                            {p.name}
                          </div>

                          <div className="mt-1 text-[12px] font-medium tracking-[0.01em] text-[#9AA6A8]">
                            {[p.neighborhood, p.city].filter(Boolean).join(" • ")}
                            {p.price ? ` • ${priceLabel(p.price)}` : ""}
                          </div>
                        </div>

                        {p.rating != null ? (
                          <div
                            className={[
                              "shrink-0 inline-flex items-center justify-center rounded-full border-2 border-white/85 font-semibold leading-none tabular-nums shadow-[0_4px_12px_rgba(0,0,0,0.10)]",
                              wideRating
                                ? "h-[42px] w-[42px] text-[15px] tracking-[-0.04em]"
                                : "h-[42px] w-[42px] text-[20px] tracking-[-0.03em]",
                            ].join(" ")}
                            style={{
                              background: ratingToHex(p.rating) || UNRATED_COLOR,
                              color: markerTextColor(p.rating),
                            }}
                          >
                            {ratingText}
                          </div>
                        ) : null}
                      </div>

                      {/* Note */}
                      {p.notes ? (
                        <p className="mt-3 min-h-[2.8rem] line-clamp-2 text-[14px] leading-[1.5] text-[#627376]">
                          {p.notes}
                        </p>
                      ) : (
                        <div className="mt-3 min-h-[2.8rem]" />
                      )}

                      {/* Actions */}
                      <div
                        className="mt-3.5 grid grid-cols-2 gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a
                          href={mapsLink(p)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-[#165D6E]/25 bg-[#165D6E]/10 px-3 py-2.5 text-center text-[13px] font-semibold text-[#165D6E] transition-colors hover:bg-[#165D6E]/16"
                        >
                          Open in Maps
                        </a>

                        {p.website ? (
                          <a
                            href={p.website}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2.5 text-center text-[13px] font-medium text-[#5A6B6E] transition-colors hover:bg-[#F1EEE6] hover:text-[#2A3A3E]"
                          >
                            Website
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="rounded-xl border border-[#E0DCD4] bg-[#F7F5EF] px-3 py-2.5 text-center text-[13px] font-medium text-[#5A6B6E] opacity-40 cursor-not-allowed"
                          >
                            Website
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Map */}
            <div className="flex h-full min-h-[620px] flex-col rounded-2xl border border-[#E0DCD4] bg-[#F1EEE6]/35 p-5">
              <div
                className="relative flex-1 overflow-hidden rounded-2xl border border-[#E0DCD4]"
                style={{
                  "--map-controls-top": activeRegion === "seattle" ? "108px" : "72px",
                }}
              >
                <MapToolbar
                  activeRegion={activeRegion}
                  activeSubRegion={activeSubRegion}
                  handleSelectRegion={handleSelectRegion}
                  handleSelectSeattleSubregion={handleSelectSeattleSubregion}
                />

                <MapContainer
                  center={[47.6062, -122.3321]}
                  zoom={11}
                  zoomControl={false}
                  style={{ height: "100%", width: "100%" }}
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

                  <MapControlPill
                    active={nearMeActive}
                    onLocateClick={toggleNearMe}
                    topOffset={activeRegion === "seattle" ? 108 : 72}
                  />

                  <RegionController
                    regionKey={activeRegion}
                    subRegionKey={activeSubRegion}
                    nearMeActive={nearMeActive}
                    userLoc={nearMeActive ? myLoc : null}
                    places={regionFiltered}
                  />

                  {/* User location marker */}
                  {nearMeActive && myLoc ? (
                    <Marker
                      position={[myLoc.lat, myLoc.lon]}
                      icon={yorkieUserIcon}
                      zIndexOffset={1000}
                    >
                      <Popup>You are here 🐶</Popup>
                    </Marker>
                  ) : null}

                  {placesWithCoords
                    .filter((p) => regionFiltered.some((s) => s.id === p.id))
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
                  <div className="pointer-events-none absolute bottom-4 left-4 z-[500]">
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

          <div
            className={[
              "relative w-[92vw] rounded-3xl border border-[#165D6E]/20 bg-[#F7F5EF]/95 shadow-2xl",
              accountTab === "caseStudy" ? "max-w-[1500px]" : "max-w-4xl",
            ].join(" ")}
          >
            <div className="flex max-h-[80vh] min-h-[420px] flex-col overflow-hidden md:min-h-[560px]">
              {/* ✅ Subtle header surface (replaces "Windows 95" divider) */}
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
                    ["caseStudy", "Case study"],
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
                        Hello, I'm Aleksey (Aleks). I'm Belarusian-born and raised in Seattle software developer and UW Computer Science student who loves building simple, user focused apps and web projects. A lot of my ideas come from wanting something specific and not finding a version that feels quite right, so I build my own. I'm also a huge food person, so check out my ratings and send me your favorite spots to try next.
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

                {accountTab === "caseStudy" ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[rgba(31,42,46,0.55)]">
                        Case Study
                      </div>
                      <button
                        type="button"
                        onClick={() => setCaseStudyFull(true)}
                        className="min-h-[44px] rounded-full border border-[#165D6E]/30 bg-[#165D6E]/10 px-4 py-2 text-sm font-medium text-[#165D6E] transition-colors hover:bg-[#165D6E]/20"
                      >
                        ⛶ Full Screen
                      </button>
                    </div>

                    <div className="rounded-2xl border border-[#E0DCD4] bg-[#F7F5EF]/40 p-4">
                      <div className="mb-3">
                        <div className="text-lg font-semibold text-[#1F2A2E]">
                          Reel Journal + Smart AI Reels Summary App
                        </div>
                        <div className="mt-1 text-sm text-[#8A9A9E]">
                          Walkthrough and case study board
                        </div>
                      </div>

                      <div className="max-h-[62vh] overflow-auto rounded-2xl border border-[#E0DCD4] bg-white">
                        <img
                          src={CaseStudyImage}
                          alt="Case study board for Reel Journal and Smart AI Reels Summary App"
                          className="block h-auto max-w-none cursor-pointer"
                          onClick={() => setCaseStudyFull(true)}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Case study fullscreen overlay */}
                {caseStudyFull && (
                  <div
                    className="fixed inset-0 z-[2000] flex items-start justify-center overflow-auto bg-black/80 backdrop-blur-sm"
                    onMouseDown={(e) => {
                      if (e.target === e.currentTarget) setCaseStudyFull(false);
                    }}
                  >
                    <div className="relative min-h-full w-full p-4">
                      <button
                        type="button"
                        onClick={() => setCaseStudyFull(false)}
                        className="fixed right-5 top-5 z-[2001] grid h-11 w-11 place-items-center rounded-full bg-white/90 text-lg font-bold text-[#1F2A2E] shadow-lg backdrop-blur-sm transition-colors hover:bg-white"
                        aria-label="Close full screen"
                      >
                        ✕
                      </button>
                      <img
                        src={CaseStudyImage}
                        alt="Case study board for Reel Journal and Smart AI Reels Summary App"
                        className="mx-auto block h-auto w-full max-w-[2000px]"
                      />
                    </div>
                  </div>
                )}

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

              {/* ✅ No "Windows 95" divider — whitespace + readable line length */}
              <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2 md:px-6 md:pb-10 md:pt-2">
                {menuTab === "aboutMap" ? (
                  <div className="space-y-3 text-sm text-[#5A6B6E]">
                    <p className="max-w-[640px] leading-relaxed">
                      This is my personal food map. Use the left filters to explore by city, neighborhood, cuisine,
                      tags, and rating.
                    </p>
                    <p className="max-w-[640px] leading-relaxed text-[#8A9A9E]">
                      Tip: click a card to fly to the pin. Use "Copy link" to share the current view.
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
