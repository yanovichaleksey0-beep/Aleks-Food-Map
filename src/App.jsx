import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import placesData from "./data/places.json";

// Bounds
const AREA_BOUNDS = L.latLngBounds([47.45, -122.48], [48.02, -122.0]);

// Leaflet marker icon fix (Vite)
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const SORTS = [
  { value: "top", label: "Top rated" },
  { value: "recent", label: "Most recent" },
  { value: "name", label: "Name (A→Z)" },
  { value: "nearest", label: "Nearest to me" },
];

function priceLabel(p) {
  if (!p) return "—";
  return "$".repeat(Math.max(1, Math.min(4, p)));
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function mapsLink(place) {
  const q = encodeURIComponent(`${place.name} ${place.address}`);
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

export default function App() {
  const STADIA_KEY = import.meta.env.VITE_STADIA_KEY;
  const TILE_URL = STADIA_KEY
    ? `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key=${STADIA_KEY}`
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

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

  // Toast (no deps)
  const [toast, setToast] = useState(null); // { message, variant }
  function showToast(message, variant = "info") {
    setToast({ message, variant });
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // Local edits
  const [edits, setEdits] = useState(() => loadEdits());
  useEffect(() => saveEdits(edits), [edits]);


  // Merge base data + local edits
  const places = useMemo(() => {
    return placesData.map((p) => {
      const patch = edits[p.id];
      return patch ? { ...p, ...patch } : p;
    });
  }, [edits]);

  // Stats memo
  const stats = useMemo(() => {
    const total = places.length;
    const rated = places.filter((p) => typeof p.rating === "number");
    const avgRating = rated.length ? rated.reduce((sum, p) => sum + p.rating, 0) / rated.length : null;
    const wouldReturnCount = places.filter((p) => p.wouldReturn === true).length;
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
    const cities = uniq(places.map((p) => p.city));
    const hoods = uniq(places.map((p) => p.neighborhood));
    const cuisines = uniq(places.flatMap((p) => p.cuisine || []));
    const tags = uniq(places.flatMap((p) => p.tags || []));
    // top cuisines
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
  // Featured list actions
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

  // Editing UI (one at a time)
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
      draft.rating === "" ? null : Number.isFinite(Number(draft.rating)) ? Number(draft.rating) : null;

    const priceNum =
      draft.price === "" ? null : Number.isFinite(Number(draft.price)) ? Number(draft.price) : null;

    const patch = {
      rating: ratingNum,
      price: priceNum,
      wouldReturn: !!draft.wouldReturn,
      notes: draft.notes || "",
      photo: draft.photo || null,
    };

    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...patch },
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
    const merged = placesData.map((p) => (edits[p.id] ? { ...p, ...edits[p.id] } : p));
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

  // Clear + Copy link helpers
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
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("Link copied!", "success");
        return;
      }
    } catch {
      // fall through
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("Link copied!", "success");
    } catch {
      showToast("Could not copy link in this browser.", "error");
    }
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

      if (price > 0 && (p.price || 0) !== price) return false;
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
        const da = haversineMiles(myLoc.lat, myLoc.lon, a.lat, a.lon);
        const db = haversineMiles(myLoc.lat, myLoc.lon, b.lat, b.lon);
        return da - db;
      });
      return arr;
    }

    // default: top rated
    arr.sort((a, b) => (b.rating || -1) - (a.rating || -1));
    return arr;
  }, [filtered, sort, myLoc]);

  function flyToPlace(p) {
    setSelectedId(p.id);
    const map = mapRef.current;
    if (!map) return;

    // Slightly higher zoom helps clusters “open up”
    const targetZoom = Math.max(map.getZoom(), 16);
    map.flyTo([p.lat, p.lon], targetZoom, { duration: 0.6 });

    setTimeout(() => markerRefs.current[p.id]?.openPopup?.(), 450);
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

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Alek’s Food Map</h1>
            <p className="mt-2 text-neutral-400">
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
              className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
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
              className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              aria-label="Open account"
              title="Account"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-neutral-800 text-xs font-semibold">
                A
              </span>
              <span className="hidden sm:block">Alek</span>
            </button>

            {/* Version */}
            <div className="rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300">
              v0.3
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {/* Sidebar */}
          <div className="md:col-span-1 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
            <div className="text-sm text-neutral-400">Search & Filters</div>

            {/* Toast */}
            {toast ? (
              <div
                className={[
                  "mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm",
                  toast.variant === "success"
                    ? "border-emerald-900 bg-emerald-950/40 text-emerald-200"
                    : toast.variant === "error"
                    ? "border-red-900 bg-red-950/40 text-red-200"
                    : "border-neutral-800 bg-neutral-950/60 text-neutral-200",
                ].join(" ")}
                role="status"
                aria-live="polite"
              >
                <span className="truncate">{toast.message}</span>
                <button
                  onClick={() => setToast(null)}
                  className="rounded-lg border border-transparent px-2 py-1 text-xs text-neutral-300 hover:border-neutral-700 hover:bg-neutral-900"
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
              className="mt-3 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 outline-none focus:border-neutral-600"
            />

            {/* Buttons */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={clearFilters}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Clear
              </button>
              <button
                onClick={copyLink}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Copy link
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={exportPlaces}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Export JSON
              </button>
              <button
                onClick={clearLocalEdits}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Reset edits
              </button>
            </div>

            <div className="mt-2 text-[11px] text-neutral-500">
              Quick-edits save in this browser. Export JSON to make them permanent in your repo.
            </div>

            {/* Filter row */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
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
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={wouldReturn}
                  onChange={(e) => setWouldReturn(e.target.checked)}
                />
                Would return
              </label>

              <div className="flex items-center gap-2 text-sm text-neutral-400">
                Min rating
                <select
                  value={minRating}
                  onChange={(e) => setMinRating(Number(e.target.value))}
                  className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm"
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
                  onClick={requestLocation}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                >
                  {myLoc ? "Update my location" : "Use my location"}
                </button>
                {locErr ? <div className="mt-2 text-xs text-red-300">{locErr}</div> : null}
              </div>
            ) : null}

            {/* Results count */}
            <div className="mt-4 text-xs text-neutral-500">
              {sorted.length} / {places.length} spots
            </div>

            {/* Cards */}
            <div className="mt-3 space-y-2">
              {sorted.map((p) => {
                const dist =
                  sort === "nearest" && myLoc
                    ? haversineMiles(myLoc.lat, myLoc.lon, p.lat, p.lon)
                    : null;

                const isEditing = editingId === p.id;

                return (
                  <div
                    key={p.id}
                    className={[
                      "rounded-2xl border p-3 transition",
                      selectedId === p.id
                        ? "border-neutral-500 bg-neutral-800/40"
                        : "border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900/50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button onClick={() => flyToPlace(p)} className="flex-1 text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{p.name}</div>
                            <div className="mt-1 text-xs text-neutral-400">
                              {p.neighborhood ? `${p.neighborhood} • ` : ""}
                              {p.city || ""}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-sm text-neutral-200">
                              {p.rating != null ? `${Number(p.rating).toFixed(1)}★` : "No rating"}
                            </div>
                            <div className="text-xs text-neutral-500">
                              {p.price ? priceLabel(p.price) : ""}
                              {dist != null ? ` • ${dist.toFixed(1)} mi` : ""}
                            </div>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => (isEditing ? cancelEdit() : startEdit(p))}
                        className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
                      >
                        {isEditing ? "Close" : "Edit"}
                      </button>
                    </div>

                    {/* Photo preview */}
                    {p.photo ? (
                      <img
                        src={p.photo}
                        alt={p.name}
                        className="mt-3 h-28 w-full rounded-xl object-cover"
                      />
                    ) : null}

                    {/* Tags */}
                    {p.tags?.length ? (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.tags.slice(0, 6).map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Notes */}
                    {p.notes ? <div className="mt-2 text-sm text-neutral-300">{p.notes}</div> : null}

                    {/* Edit panel */}
                    {isEditing ? (
                      <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-xs text-neutral-400">
                            Rating
                            <input
                              value={draft?.rating ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...d, rating: e.target.value }))}
                              type="number"
                              step="0.1"
                              min="0"
                              max="5"
                              placeholder="4.5"
                              className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                            />
                          </label>

                          <label className="text-xs text-neutral-400">
                            Price
                            <select
                              value={draft?.price ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                              className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                            >
                              <option value="">—</option>
                              <option value="1">$</option>
                              <option value="2">$$</option>
                              <option value="3">$$$</option>
                              <option value="4">$$$$</option>
                            </select>
                          </label>
                        </div>

                        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
                          <input
                            type="checkbox"
                            checked={!!draft?.wouldReturn}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, wouldReturn: e.target.checked }))
                            }
                          />
                          Would return
                        </label>

                        <label className="mt-3 block text-xs text-neutral-400">
                          Photo URL
                          <input
                            value={draft?.photo ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, photo: e.target.value }))}
                            placeholder="https://..."
                            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                          />
                        </label>

                        <label className="mt-3 block text-xs text-neutral-400">
                          Notes
                          <textarea
                            value={draft?.notes ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                            rows={3}
                            placeholder="What did you get? Was it worth it?"
                            className="mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
                          />
                        </label>

                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(p.id)}
                            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
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
                        className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-center text-sm text-neutral-200 hover:bg-neutral-900"
                      >
                        Open in Maps
                      </a>
                      {p.website ? (
                        <a
                          href={p.website}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-center text-sm text-neutral-200 hover:bg-neutral-900"
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
          <div className="md:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
            <div className="text-sm text-neutral-400">Map</div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-800">
              <MapContainer
                center={[47.6062, -122.3321]}
                zoom={11}
                style={{ height: 520, width: "100%" }}
                maxBounds={AREA_BOUNDS}
                maxBoundsViscosity={1.0}
                whenReady={(e) => {
                  const map = e.target;
                  mapRef.current = map;

                  const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lon]));
                  map.fitBounds(bounds.isValid() ? bounds.pad(0.25) : AREA_BOUNDS, {
                    padding: [24, 24],
                  });

                  const z = map.getBoundsZoom(AREA_BOUNDS);
                  map.setMinZoom(Math.min(z, 18));
                }}
                maxZoom={18}
                scrollWheelZoom
              >
                <TileLayer
                  url={TILE_URL}
                  maxZoom={20}
                  attribution="&copy; OpenStreetMap contributors"
                />

                {/* ✅ CLUSTERING */}
                <MarkerClusterGroup
                  chunkedLoading
                  showCoverageOnHover={false}
                  spiderfyOnMaxZoom
                  disableClusteringAtZoom={17}
                >
                  {sorted.map((p) => (
                    <Marker
                      key={p.id}
                      position={[p.lat, p.lon]}
                      ref={(ref) => {
                        if (ref) markerRefs.current[p.id] = ref;
                      }}
                      eventHandlers={{
                        click: () => {
                          setSelectedId(p.id);
                          setTimeout(() => markerRefs.current[p.id]?.openPopup?.(), 0);
                        },
                      }}
                    >
                      <Popup>
                        <div style={{ minWidth: 240 }}>
                          <div style={{ fontWeight: 700 }}>{p.name}</div>
                          <div style={{ opacity: 0.85, marginTop: 4 }}>{p.address}</div>
                          <div style={{ marginTop: 8 }}>
                            <strong>Rating:</strong>{" "}
                            {p.rating == null ? "—" : `${Number(p.rating).toFixed(1)}★`}
                            {p.price ? ` • ${priceLabel(p.price)}` : ""}
                          </div>
                          {p.notes ? (
                            <div style={{ marginTop: 8, opacity: 0.9 }}>{p.notes}</div>
                          ) : null}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MarkerClusterGroup>
              </MapContainer>
            </div>
          </div>
        </div>

      {/* Account Modal */}
      {accountOpen ? (
        <div className="fixed inset-0 z-[1000]">
          {/* Backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setAccountOpen(false)}
            aria-label="Close account modal"
          />

          {/* Panel */}
          <div className="absolute left-1/2 top-16 w-[92vw] max-w-xl -translate-x-1/2 rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Alek</div>
                <div className="mt-1 text-sm text-neutral-400">
                  CS • frontend/UX • building fun products
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAccountOpen(false)}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Close
              </button>
            </div>

            {/* Tabs */}
            <div className="mt-4 flex gap-2">
              {[
                ["about", "About me"],
                ["resume", "Resume"],
                ["contact", "Contact"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAccountTab(key)}
                  className={[
                    "rounded-full border px-3 py-2 text-sm",
                    accountTab === key
                      ? "border-neutral-500 bg-neutral-900 text-neutral-100"
                      : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="mt-4">
              {accountTab === "about" ? (
                <div className="space-y-3 text-sm text-neutral-200">
                  <p className="text-neutral-300">
                    I built this as a personal food guide + portfolio project. I care a lot about
                    clean UI, fast interactions, and making small products feel “real”.
                  </p>
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                    <div className="text-xs text-neutral-400">Tech</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {["React", "Leaflet", "Vite", "Tailwind", "Geoapify"].map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-200"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {accountTab === "resume" ? (
                <div className="space-y-3 text-sm text-neutral-200">
                  <div className="text-neutral-300">
                    Open or download my resume:
                  </div>
                  <div className="flex gap-2">
                    <a
                      href="/resume.pdf"
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-center text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      Open Resume
                    </a>
                    <a
                      href="/resume.pdf"
                      download
                      className="flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-center text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      Download PDF
                    </a>
                  </div>
                  <div className="text-xs text-neutral-500">
                    Put your file at <code>public/resume.pdf</code>
                  </div>
                </div>
              ) : null}

              {accountTab === "contact" ? (
                <div className="space-y-3 text-sm text-neutral-200">
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                    <div className="text-xs text-neutral-400">Contact</div>
                    <div className="mt-2 space-y-2">
                      <a className="block text-neutral-200 hover:underline" href="mailto:you@email.com">
                        you@email.com
                      </a>
                      <a className="block text-neutral-200 hover:underline" href="https://github.com/YOUR_GITHUB" target="_blank" rel="noreferrer">
                        GitHub
                      </a>
                      <a className="block text-neutral-200 hover:underline" href="https://www.linkedin.com/in/YOUR_LINKEDIN" target="_blank" rel="noreferrer">
                        LinkedIn
                      </a>
                    </div>
                  </div>
                  <div className="text-xs text-neutral-500">
                    Replace the links with your real ones.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Hamburger Drawer */}
      {menuOpen ? (
        <div className="fixed inset-0 z-[999]">
          {/* Backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          />

          {/* Drawer */}
          <div className="absolute right-0 top-0 h-full w-[92vw] max-w-md border-l border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Menu</div>
                <div className="mt-1 text-sm text-neutral-400">Map sections</div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Close
              </button>
            </div>

            {/* Tabs */}
            <div className="mt-4 flex gap-2">
              {[
                ["aboutMap", "About this map"],
                ["featured", "Featured lists"],
                ["stats", "Stats"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMenuTab(key)}
                  className={[
                    "rounded-full border px-3 py-2 text-sm",
                    menuTab === key
                      ? "border-neutral-500 bg-neutral-900 text-neutral-100"
                      : "border-neutral-800 bg-neutral-950 text-neutral-300 hover:bg-neutral-900",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="mt-4">
              {menuTab === "aboutMap" ? (
                <div className="space-y-3 text-sm text-neutral-300">
                  <p>
                    This is my personal food guide. I’m the only one adding spots, but the site is built
                    to feel like a real product: search, filters, clustering, and quick edits.
                  </p>
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                    <div className="text-xs text-neutral-400">How I add places</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>CLI add script (Geoapify) → saves JSON</li>
                      <li>Quick edits saved locally → export JSON to commit</li>
                    </ul>
                  </div>
                </div>
              ) : null}

              {menuTab === "featured" ? (
                <div className="space-y-3">
                  <div className="text-sm text-neutral-300">
                    One-click “curated” views (applies filters):
                  </div>

                  <div className="grid gap-2">
                    <button
                      onClick={() => applyFeatured("top")}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      <div className="font-semibold">Top rated</div>
                      <div className="mt-1 text-xs text-neutral-500">Shows 4.5★+ (sort: top)</div>
                    </button>

                    <button
                      onClick={() => applyFeatured("date-night")}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      <div className="font-semibold">Date-night</div>
                      <div className="mt-1 text-xs text-neutral-500">Tag: date-night</div>
                    </button>

                    <button
                      onClick={() => applyFeatured("late-night")}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      <div className="font-semibold">Late-night</div>
                      <div className="mt-1 text-xs text-neutral-500">Tag: late-night</div>
                    </button>

                    <button
                      onClick={() => applyFeatured("cheap")}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      <div className="font-semibold">Cheap eats</div>
                      <div className="mt-1 text-xs text-neutral-500">Price: $</div>
                    </button>

                    <button
                      onClick={() => applyFeatured("recent")}
                      className="rounded-2xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-left text-sm text-neutral-200 hover:bg-neutral-900"
                    >
                      <div className="font-semibold">Most recent</div>
                      <div className="mt-1 text-xs text-neutral-500">Sort: recent</div>
                    </button>
                  </div>

                  <div className="text-xs text-neutral-500">
                    Tip: add tags like <code>date-night</code> and <code>late-night</code> in Edit.
                  </div>
                </div>
              ) : null}

              {menuTab === "stats" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Spots", stats.total],
                      ["Cities", stats.cities],
                      ["Neighborhoods", stats.hoods],
                      ["Cuisines", stats.cuisines],
                      ["Tags", stats.tags],
                      ["Rated", stats.ratedCount],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3"
                      >
                        <div className="text-xs text-neutral-400">{label}</div>
                        <div className="mt-1 text-lg font-semibold text-neutral-100">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                    <div className="text-xs text-neutral-400">Ratings</div>
                    <div className="mt-2 text-sm text-neutral-200">
                      Avg rating:{" "}
                      <span className="font-semibold">
                        {stats.avgRating == null ? "—" : `${stats.avgRating.toFixed(2)}★`}
                      </span>
                      <span className="text-neutral-500"> (from {stats.ratedCount} rated)</span>
                    </div>
                    <div className="mt-1 text-sm text-neutral-200">
                      Would return:{" "}
                      <span className="font-semibold">
                        {stats.wouldReturnCount} ({stats.wouldReturnPct}%)
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
                    <div className="text-xs text-neutral-400">Top cuisines</div>
                    <div className="mt-2 space-y-1 text-sm text-neutral-200">
                      {stats.topCuisines.length ? (
                        stats.topCuisines.map(([c, n]) => (
                          <div key={c} className="flex items-center justify-between">
                            <span>{c}</span>
                            <span className="text-neutral-400">{n}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-neutral-500">No cuisine data yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      </div>
    </div>
  );
}
