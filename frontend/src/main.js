import { Map, NavigationControl, Popup, ScaleControl, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import {
  getBasemapAttribution,
  getBasemapStyle,
  isAnalyticsBasemap,
  isImageryBasemap,
  basemapStyleKey,
  loadBasemapId,
  MAP_MAX_ZOOM,
  saveBasemapId,
} from "./mapBasemaps.js";
import { applyMap3DEnvironment, easeToDefault3DCamera, syncTerrainForZoom } from "./map3d.js";
import {
  CHOROPLETH_FILL_COLOR,
  CHOROPLETH_FILL_OPACITY,
  CHOROPLETH_LINE_COLOR,
  CHOROPLETH_LINE_OPACITY,
  CHOROPLETH_LINE_WIDTH,
  NOWCAST_SEVERITY_FILL_COLOR,
  NOWCAST_SEVERITY_LINE_COLOR,
  enhanceOpenFreeMapDarkBasemap,
  resetBasemapEnhanceState,
} from "./mapBasemapEnhance.js";
import {
  createOperationalLayerScheduler,
  ensureCopMapLighting,
  stackCopLayersOnTop,
} from "./mapOperationalLayers.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

setWorkerUrl(workerUrl);

const API = "";
const INDONESIA_BOUNDS = [
  [94.0, -11.5],
  [141.5, 6.5],
];

function readMapPadding() {
  const root = getComputedStyle(document.documentElement);
  const num = (key, fallback) => {
    const v = parseInt(root.getPropertyValue(key), 10);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    top: num("--map-pad-top", 128),
    bottom: num("--map-pad-bottom", 52),
    left: num("--map-pad-left", 292),
    right: num("--map-pad-right", 316),
  };
}

const MAP_VIEW_KEY = "indonesia-cop-map-view";

function syncHudTop() {
  const header = document.querySelector(".hud-top");
  if (!header) {
    return;
  }
  const height = Math.ceil(header.getBoundingClientRect().height);
  const root = document.documentElement;
  root.style.setProperty("--hud-top", `${height}px`);
  root.style.setProperty("--map-pad-top", `${height}px`);
}

function resizeMapCanvas() {
  if (!map.isStyleLoaded()) {
    return;
  }
  map.resize();
}

/** Kembali ke bbox nasional (Locate gagal / reset eksplisit) */
function resetMapToIndonesia() {
  if (!map.isStyleLoaded()) {
    return;
  }
  map.resize();
  map.fitBounds(INDONESIA_BOUNDS, { padding: readMapPadding(), duration: 480 });
  map.easeTo({ pitch: 52, bearing: 14, duration: 480 });
}

function saveMapView() {
  if (!map.isStyleLoaded()) {
    return;
  }
  const center = map.getCenter();
  try {
    sessionStorage.setItem(
      MAP_VIEW_KEY,
      JSON.stringify({
        lng: center.lng,
        lat: center.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function restoreMapViewIfSaved() {
  try {
    const raw = sessionStorage.getItem(MAP_VIEW_KEY);
    if (!raw) {
      return false;
    }
    const view = JSON.parse(raw);
    if (typeof view.lng !== "number" || typeof view.lat !== "number" || typeof view.zoom !== "number") {
      return false;
    }
    map.jumpTo({
      center: [view.lng, view.lat],
      zoom: view.zoom,
      bearing: typeof view.bearing === "number" ? view.bearing : 0,
      pitch: typeof view.pitch === "number" ? view.pitch : 0,
    });
    return true;
  } catch {
    return false;
  }
}

const appRoot = document.getElementById("app");
const basemapAttributionLink = document.getElementById("basemap-attribution-link");
let activeBasemapId = loadBasemapId();

const layerCache = {
  nowcast: { type: "FeatureCollection", features: [] },
  earthquakes: { type: "FeatureCollection", features: [] },
  firms: { type: "FeatureCollection", features: [] },
  usgs: { type: "FeatureCollection", features: [] },
  analyticsGrid: { type: "FeatureCollection", features: [] },
  analyticsProvinces: { type: "FeatureCollection", features: [] },
};

/** @type {(() => void) | null} */
let scheduleApplyOperationalLayers = null;

const map = new Map({
  container: "map",
  style: getBasemapStyle(activeBasemapId),
  bounds: INDONESIA_BOUNDS,
  fitBoundsOptions: { padding: readMapPadding() },
  attributionControl: false,
  maxPitch: 85,
  minZoom: 2,
  maxZoom: MAP_MAX_ZOOM,
});

map.addControl(
  new NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }),
  "bottom-right",
);
map.addControl(new ScaleControl({ maxWidth: 120, unit: "imperial" }), "bottom-left");

const mapLocateBtn = document.getElementById("map-locate-btn");
if (mapLocateBtn) {
  mapLocateBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      resetMapToIndonesia();
      return;
    }
    mapLocateBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapLocateBtn.disabled = false;
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: Math.max(map.getZoom(), 7),
          duration: 900,
        });
      },
      () => {
        mapLocateBtn.disabled = false;
        resetMapToIndonesia();
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    );
  });
}

map.on("error", (event) => {
  const message = event.error?.message || "MapLibre gagal memuat tile/style.";
  setFeedStatus(false);
  setDetailHtml(
    `<span class="brief-title">Map error</span>` +
      `<span class="brief-row">${escapeHtml(message)}</span>`,
  );
});

const detailEl = document.getElementById("detail");
const clockEl = document.getElementById("clock-wib");
const feedStatusEl = document.getElementById("feed-status");
const lastSyncEl = document.getElementById("last-sync");
const hudPanels = document.getElementById("hud-panels");
const panelToggle = document.getElementById("panel-toggle");
const refreshBtn = document.getElementById("refresh-btn");
const weatherBodyEl = document.getElementById("weather-body");
const wilayahSearchForm = document.getElementById("wilayah-search-form");
const wilayahSearchInput = document.getElementById("wilayah-search-input");
const wilayahSearchResults = document.getElementById("wilayah-search-results");
const ctxCoordsEl = document.getElementById("ctx-coords");
const ctxLocationEl = document.getElementById("ctx-location");
const ctxZoomEl = document.getElementById("ctx-zoom");
const nowcastTableWrap = document.getElementById("nowcast-table-wrap");

const PROVINCE_LABEL_MIN_ZOOM = 6.5;

let activePopup = null;
let supportLayersBound = false;
let basemapSwitchInFlight = false;
let basemapSwitchTimer;
let pendingBasemapId = null;
let searchDebounceTimer;
let pinnedLocationLabel = null;
let pointerOnMap = false;
let contextMoveTimer;
let lastContextLngLat = null;
let lastContextMode = "center";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setDetailHtml(html) {
  detailEl.innerHTML = html;
}

function setFeedStatus(ok) {
  feedStatusEl.className = `meta-chip ${ok ? "feed-healthy" : "feed-offline"}`;
  feedStatusEl.innerHTML = ok
    ? '<span class="feed-dot feed-dot-healthy"></span>LIVE'
    : '<span class="feed-dot feed-dot-offline"></span>OFFLINE';
}

function updateClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }) + " WIB";
}

updateClock();
setInterval(updateClock, 1000);

function formatFetchedAt(iso) {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  } catch {
    return iso;
  }
}

const SEVERITY_RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

function walkCoords(coords, visit) {
  if (typeof coords[0] === "number") {
    visit(coords);
    return;
  }
  for (const part of coords) {
    walkCoords(part, visit);
  }
}

function bboxFromGeometry(geometry) {
  if (!geometry?.coordinates) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  walkCoords(geometry.coordinates, ([lng, lat]) => {
    minX = Math.min(minX, lng);
    minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng);
    maxY = Math.max(maxY, lat);
  });
  if (!Number.isFinite(minX)) {
    return null;
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function flyToBounds(bounds, options = {}) {
  map.fitBounds(bounds, {
    padding: readMapPadding(),
    duration: 420,
    maxZoom: options.maxZoom ?? 8,
  });
}

function flyToCenter(center, zoom = 7) {
  if (!center?.length) {
    return;
  }
  map.flyTo({
    center,
    zoom,
    padding: readMapPadding(),
    duration: 480,
  });
}

function setWeatherPin(lng, lat) {
  if (!map.isStyleLoaded()) {
    return;
  }
  const feature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {},
  };
  if (!map.getSource("weather-pin")) {
    map.addSource("weather-pin", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [feature] },
    });
    map.addLayer({
      id: "weather-pin-layer",
      type: "circle",
      source: "weather-pin",
      paint: {
        "circle-radius": 7,
        "circle-color": "#38bdf8",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0f172a",
      },
    });
  } else {
    map.getSource("weather-pin").setData({
      type: "FeatureCollection",
      features: [feature],
    });
  }
}

function weatherContentEl() {
  return weatherBodyEl || detailEl;
}

function renderWeatherLoading(adm4) {
  const el = weatherContentEl();
  if (!el) {
    return;
  }
  el.innerHTML =
    `<p class="weather-loading">Memuat prakiraan BMKG untuk <code>${escapeHtml(adm4)}</code>…</p>`;
}

function renderWeatherError(message) {
  const el = weatherContentEl();
  if (!el) {
    return;
  }
  el.innerHTML = `<p class="weather-error">${escapeHtml(message)}</p>`;
}

function renderWeatherPanel(payload) {
  const el = weatherContentEl();
  if (!el) {
    return;
  }
  const loc = payload.lokasi || {};
  const blocks = payload.data || [];
  const prov = payload.provenance || payload._provenance || {};
  const cached = payload.cached ? " (cache)" : "";

  const dayRows = blocks
    .map((block, dayIndex) => {
      const slots = (block.cuaca && block.cuaca[0]) || [];
      const slotHtml = slots
        .map((slot) => {
          const when = slot.local_datetime || slot.utc_datetime || slot.datetime || "—";
          return (
            `<li><span class="wx-time">${escapeHtml(when)}</span>` +
            `<span class="wx-desc">${escapeHtml(slot.weather_desc || "—")}</span>` +
            `<span class="wx-temp">${slot.t != null ? `${slot.t}°C` : "—"}</span></li>`
          );
        })
        .join("");
      return (
        `<div class="wx-day"><h3 class="wx-day-title">Hari ${dayIndex + 1}</h3>` +
        `<ul class="wx-slots">${slotHtml || "<li>Tidak ada slot</li>"}</ul></div>`
      );
    })
    .join("");

  el.innerHTML =
    `<p class="wx-location"><strong>${escapeHtml(loc.desa || loc.kecamatan || "—")}</strong>` +
    `<br />${escapeHtml(loc.kecamatan || "")} · ${escapeHtml(loc.kotkab || "")}` +
    `<br />${escapeHtml(loc.provinsi || "")}</p>` +
    `<p class="wx-meta">adm4 <code>${escapeHtml(loc.adm4 || prov.adm4 || "—")}</code>${cached}` +
    (prov.fetched_at
      ? ` · di-ingest ${escapeHtml(formatFetchedAt(prov.fetched_at))}`
      : "") +
    `</p>` +
    `<div class="wx-days">${dayRows || "<p>Tidak ada data cuaca.</p>"}</div>`;

  if (loc.lon != null && loc.lat != null) {
    setWeatherPin(Number(loc.lon), Number(loc.lat));
    flyToCenter([Number(loc.lon), Number(loc.lat)], 9);
  }
}

async function loadWeatherAdm4(adm4) {
  const code = String(adm4 || "").trim();
  if (!code) {
    return;
  }
  renderWeatherLoading(code);
  try {
    const payload = await fetchJson(`/api/v1/weather/adm4/${encodeURIComponent(code)}`);
    renderWeatherPanel(payload);
  } catch (err) {
    renderWeatherError(err.message);
  }
}

async function applyWilayahHit(hit) {
  if (!hit) {
    return;
  }
  pinnedLocationLabel = hit.label || hit.name || null;
  if (hit.center?.length === 2) {
    flyToCenter(hit.center, hit.kind === "province" ? 6.5 : 8);
    updateMapContext(hit.center[0], hit.center[1], "center");
  }
  if (hit.adm4) {
    await loadWeatherAdm4(hit.adm4);
  } else {
    renderWeatherError("Preset ini belum punya kode adm4 — ketik kode adm4 lengkap di pencarian.");
  }
}

function extractProvinceLabel(headline, provinces = []) {
  const text = String(headline || "");
  for (const p of provinces) {
    if (p && text.toLowerCase().includes(String(p).toLowerCase())) {
      return p;
    }
  }
  const m = text.match(/\b(di|kepada|wilayah)\s+([A-Za-zÀ-ÿ\s]+?)(?:\.|,|$)/i);
  return m?.[2]?.trim() || "—";
}

function renderCopAlertTable(provinces, alertFeatures) {
  if (!nowcastTableWrap) {
    return;
  }
  const deduped = dedupeNowcastAlerts(alertFeatures);
  if (!deduped.length) {
    nowcastTableWrap.innerHTML =
      `<p class="cop-alert-empty">Tidak ada peringatan cuaca aktif saat ini.</p>`;
    return;
  }
  const rows = deduped
    .slice(0, 40)
    .map((feature, index) => {
      const props = feature.properties || {};
      const prov = extractProvinceLabel(props.headline, provinces);
      return (
        `<tr>` +
        `<td>${escapeHtml(prov)}</td>` +
        `<td><button type="button" class="cop-alert-row-btn" data-alert-index="${index}">${escapeHtml(props.headline || "Peringatan cuaca")}</button></td>` +
        `<td>${escapeHtml(props.expires || "—")}</td>` +
        `</tr>`
      );
    })
    .join("");
  nowcastTableWrap.innerHTML =
    `<table class="cop-alert-table">` +
    `<thead><tr><th>Provinsi</th><th>Peringatan dini cuaca</th><th>Waktu berlaku</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`;
  nowcastTableWrap._copAlerts = deduped.slice(0, 40);
  nowcastTableWrap.querySelectorAll(".cop-alert-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-alert-index"));
      const feature = nowcastTableWrap._copAlerts?.[idx];
      if (!feature) {
        return;
      }
      const bounds = bboxFromGeometry(feature.geometry);
      const props = feature.properties || {};
      if (bounds) {
        flyToBounds(bounds, { maxZoom: 9 });
        const [[x1, y1], [x2, y2]] = bounds;
        showPopup({ lng: (x1 + x2) / 2, lat: (y1 + y2) / 2 }, "Peringatan cuaca", [
          `<strong>${escapeHtml(props.headline)}</strong>`,
          `Severity: ${escapeHtml(props.severity)} · Urgency: ${escapeHtml(props.urgency)}`,
        ]);
      }
    });
  });
}

function dedupeNowcastAlerts(features) {
  const deduped = [];
  const seen = new Set();
  for (const feature of features || []) {
    const props = feature.properties || {};
    const key = props.alert_code || props.cap_identifier || props.headline;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(feature);
  }
  deduped.sort((a, b) => {
    const sa = SEVERITY_RANK[a.properties?.severity] ?? 9;
    const sb = SEVERITY_RANK[b.properties?.severity] ?? 9;
    return sa - sb;
  });
  return deduped;
}

function hideSearchResults() {
  if (wilayahSearchResults) {
    wilayahSearchResults.hidden = true;
    wilayahSearchResults.innerHTML = "";
  }
}

async function runWilayahSearch(query) {
  const q = query.trim();
  if (q.length < 2) {
    hideSearchResults();
    return;
  }
  try {
    const payload = await fetchJson(
      `/api/v1/wilayah/search?${new URLSearchParams({ q, limit: "8" })}`,
    );
    const results = payload.results || [];
    if (!results.length) {
      wilayahSearchResults.hidden = false;
      wilayahSearchResults.innerHTML = `<li class="wilayah-no-hit">Tidak ada hasil.</li>`;
      return;
    }
    wilayahSearchResults.hidden = false;
    wilayahSearchResults.innerHTML = results
      .map(
        (hit, index) =>
          `<li><button type="button" class="wilayah-hit" data-hit-index="${index}">` +
          `<span class="wilayah-hit-label">${escapeHtml(hit.label || hit.name)}</span>` +
          (hit.adm4 ? `<span class="wilayah-hit-adm4">${escapeHtml(hit.adm4)}</span>` : "") +
          `</button></li>`,
      )
      .join("");

    wilayahSearchResults.querySelectorAll(".wilayah-hit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hit = results[Number(btn.getAttribute("data-hit-index"))];
        hideSearchResults();
        if (wilayahSearchInput && hit?.name) {
          wilayahSearchInput.value = hit.adm4 || hit.name;
        }
        void applyWilayahHit(hit);
      });
    });
  } catch {
    hideSearchResults();
  }
}

function initWilayahSearch() {
  if (!wilayahSearchForm || !wilayahSearchInput) {
    return;
  }
  wilayahSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runWilayahSearch(wilayahSearchInput.value);
  });
  wilayahSearchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      void runWilayahSearch(wilayahSearchInput.value);
    }, 280);
  });
  wilayahSearchInput.addEventListener("blur", () => {
    setTimeout(hideSearchResults, 180);
  });
}

initWilayahSearch();

if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "…";
    void refresh().finally(() => {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    });
  });
}

function initPanelToggle() {
  const mobileMq = window.matchMedia("(max-width: 820px)");

  const syncPanels = () => {
    if (mobileMq.matches) {
      hudPanels.classList.remove("hud-panels--open");
      panelToggle.setAttribute("aria-expanded", "false");
    } else {
      hudPanels.classList.add("hud-panels--open");
      panelToggle.setAttribute("aria-expanded", "true");
    }
    resizeMapCanvas();
  };

  panelToggle.addEventListener("click", () => {
    const open = hudPanels.classList.toggle("hud-panels--open");
    panelToggle.setAttribute("aria-expanded", String(open));
    resizeMapCanvas();
  });

  mobileMq.addEventListener("change", syncPanels);
  syncPanels();
}

initPanelToggle();

syncHudTop();
window.addEventListener("resize", () => {
  requestAnimationFrame(syncHudTop);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeMapCanvas, 120);
});

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}`);
  }
  return res.json();
}

async function fetchSupportJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return { type: "FeatureCollection", features: [], enabled: false };
  }
}

function formatUsgsTime(ms) {
  if (ms == null) {
    return "—";
  }
  try {
    return new Date(Number(ms)).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  } catch {
    return String(ms);
  }
}

function showPopup(lngLat, title, lines) {
  if (activePopup) {
    activePopup.remove();
  }
  const body = lines.map((line) => `<p>${line}</p>`).join("");
  activePopup = new Popup({
    closeButton: true,
    closeOnClick: true,
    className: "map-popup",
    maxWidth: "320px",
  })
    .setLngLat(lngLat)
    .setHTML(
      `<div class="map-popup-card"><h3>${title}</h3>${body}</div>`,
    )
    .addTo(map);
}

function bindLayerToggle(layerId, checkboxId, extraLayerIds = []) {
  const checkbox = document.getElementById(checkboxId);
  if (!checkbox || checkbox.dataset.layerToggleBound === "1") {
    return;
  }
  checkbox.dataset.layerToggleBound = "1";
  checkbox.addEventListener("change", (e) => {
    const visible = e.target.checked ? "visible" : "none";
    for (const id of [layerId, ...extraLayerIds]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible);
      }
    }
  });
}

function syncLayerVisibilityFromCheckboxes() {
  const pairs = [
    ["layer-nowcast", ["nowcast-fill", "nowcast-glow", "nowcast-fill-outline"]],
    ["layer-earthquake", ["earthquake-halo", "earthquake-circles"]],
    ["layer-firms", ["firms-circles"]],
    ["layer-usgs", ["usgs-circles"]],
  ];
  for (const [checkboxId, layerIds] of pairs) {
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) {
      for (const layerId of layerIds) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", "none");
        }
      }
      continue;
    }
    const visible = checkbox.checked ? "visible" : "none";
    for (const layerId of layerIds) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visible);
      }
    }
  }
}

function setBasemapButtonsBusy(busy) {
  document.querySelectorAll(".basemap-btn").forEach((btn) => {
    btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
  });
}

function updateBasemapChrome(basemapId) {
  if (appRoot) {
    appRoot.dataset.basemap = basemapId;
  }
  const attr = getBasemapAttribution(basemapId);
  if (basemapAttributionLink) {
    basemapAttributionLink.textContent = attr.label;
    basemapAttributionLink.href = attr.href;
  }
  document.querySelectorAll(".basemap-btn").forEach((btn) => {
    const id = btn.getAttribute("data-basemap");
    btn.classList.toggle("is-active", id === basemapId);
    btn.classList.toggle("is-pending", pendingBasemapId != null && id === pendingBasemapId);
  });
}

function applyEsriImageryLabelMode(basemapId) {
  if (!map.getLayer("basemap-labels")) {
    return;
  }
  const show =
    basemapId === "hybrid" || basemapId === "satellite" || basemapId === "streets";
  map.setLayoutProperty("basemap-labels", "visibility", show ? "visible" : "none");
  if (show) {
    map.setPaintProperty("basemap-labels", "raster-opacity", basemapId === "satellite" ? 0.96 : 1);
  }
}

const vectorLabelLayerIds = new Set();

function mapTextFontStack() {
  const layers = map.getStyle()?.layers || [];
  const ref = layers.find((l) => l.type === "symbol" && l.layout?.["text-font"]);
  return ref?.layout?.["text-font"] || ["Noto Sans Regular"];
}

function enhanceVectorBasemapLabels() {
  if (basemapStyleKey(activeBasemapId) !== "openfreemap-dark") {
    return;
  }
  const layers = map.getStyle()?.layers || [];
  for (const layer of layers) {
    if (layer.type !== "symbol" || !layer.layout?.["text-field"]) {
      continue;
    }
    const id = layer.id;
    if (vectorLabelLayerIds.has(id)) {
      continue;
    }
    if (!/place|country|state|city|town|village|suburb|locality|water|ocean|sea|label/i.test(id)) {
      continue;
    }
    try {
      map.setPaintProperty(id, "text-color", "#f1f5f9");
      map.setPaintProperty(id, "text-halo-color", "rgba(5, 10, 18, 0.92)");
      map.setPaintProperty(id, "text-halo-width", 1.35);
      map.setLayoutProperty(id, "text-size", [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        11,
        6,
        13,
        9,
        15,
        12,
        17,
      ]);
      vectorLabelLayerIds.add(id);
    } catch {
      /* layer may not support paint override */
    }
  }
}

function applyBasemapModeWithoutStyleReload(nextId) {
  activeBasemapId = nextId;
  saveBasemapId(nextId);
  pendingBasemapId = null;
  updateBasemapChrome(nextId);
  applyMap3DEnvironment(map);
  if (basemapStyleKey(nextId) === "esri-imagery") {
    applyEsriImageryLabelMode(nextId);
  }
  tuneLayerPaintForBasemap(nextId);
  syncAnalyticsLayerVisibility();
  if (basemapStyleKey(nextId) === "openfreemap-dark") {
    enhanceOpenFreeMapDarkBasemap(map);
    enhanceVectorBasemapLabels();
  }
  if (isAnalyticsBasemap(nextId)) {
    const analytics = analyticsPayloadForBasemap();
    ensureAnalyticsLayers(analytics.grid, analytics.provinces);
  }
  setBasemapButtonsBusy(false);
  basemapSwitchInFlight = false;
}

function formatCoords(lng, lat) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function geometryCentroid(geometry) {
  if (!geometry?.coordinates) {
    return null;
  }
  const points = [];
  const walk = (obj) => {
    if (typeof obj[0] === "number") {
      points.push([obj[0], obj[1]]);
      return;
    }
    for (const part of obj) {
      walk(part);
    }
  };
  walk(geometry.coordinates);
  if (!points.length) {
    return null;
  }
  const lng = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return { lng, lat };
}

function nearestProvinceLabel(lng, lat) {
  const features = layerCache.analyticsProvinces?.features || [];
  if (!features.length) {
    return "Tidak diketahui";
  }
  let bestName = null;
  let bestDist = Infinity;
  for (const feature of features) {
    const center = geometryCentroid(feature.geometry);
    const name = feature.properties?.province_name || feature.properties?.shapeName;
    if (!center || !name) {
      continue;
    }
    const d = (center.lng - lng) ** 2 + (center.lat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestName = name;
    }
  }
  return bestName || "Tidak diketahui";
}

function updateMapZoomContext() {
  if (!ctxZoomEl || !map.isStyleLoaded()) {
    return;
  }
  ctxZoomEl.textContent = map.getZoom().toFixed(1);
  ctxZoomEl.title = `Level zoom · maks ${MAP_MAX_ZOOM} (detail pemukiman ≈ 16+)`;
}

function updateMapContext(lng, lat, mode = "cursor") {
  lastContextLngLat = { lng, lat };
  lastContextMode = mode;
  if (mode === "cursor") {
    pinnedLocationLabel = null;
  }
  if (ctxCoordsEl) {
    ctxCoordsEl.textContent = formatCoords(lng, lat);
    ctxCoordsEl.title =
      mode === "center" ? "Pusat peta (WGS84)" : "Kursor · WGS84 lintang, bujur";
  }
  if (ctxLocationEl) {
    ctxLocationEl.textContent = pinnedLocationLabel || nearestProvinceLabel(lng, lat);
  }
  updateMapZoomContext();
}

function refreshMapContextFromCenter() {
  const center = map.getCenter();
  updateMapContext(center.lng, center.lat, "center");
}

function initMapContextBar() {
  updateBasemapChrome(activeBasemapId);

  map.on("mousemove", (e) => {
    pointerOnMap = true;
    clearTimeout(contextMoveTimer);
    contextMoveTimer = setTimeout(() => {
      updateMapContext(e.lngLat.lng, e.lngLat.lat, "cursor");
    }, 60);
  });

  map.on("moveend", () => {
    if (!pointerOnMap) {
      refreshMapContextFromCenter();
    }
  });

  map.on("zoomend", updateMapZoomContext);

  map.getCanvas().addEventListener("mouseleave", () => {
    pointerOnMap = false;
    refreshMapContextFromCenter();
  });

  if (map.loaded()) {
    refreshMapContextFromCenter();
  } else {
    map.once("load", refreshMapContextFromCenter);
  }
}

map.on("moveend", () => {
  saveMapView();
  syncProvinceLabelsForZoom();
});
map.on("zoomend", () => {
  syncProvinceLabelsForZoom();
  syncTerrainForZoom(map);
});
map.on("style.load", () => {
  applyMap3DEnvironment(map);
  scheduleApplyOperationalLayers?.();
});

let copLayerRestackTimer;
map.on("idle", () => {
  if (!map.getLayer("analytics-choropleth-fill") && !map.getLayer("nowcast-fill")) {
    return;
  }
  clearTimeout(copLayerRestackTimer);
  copLayerRestackTimer = setTimeout(() => {
    ensureCopMapLighting(map);
    stackCopLayersOnTop(map);
    tuneLayerPaintForBasemap(activeBasemapId);
    syncAnalyticsLayerVisibility();
  }, 120);
});

initMapContextBar();

function syncProvinceLabelsForZoom() {
  if (!map.getLayer("analytics-province-labels")) {
    return;
  }
  const hasProvinces = (layerCache.analyticsProvinces.features?.length ?? 0) > 0;
  const show = hasProvinces && map.getZoom() >= PROVINCE_LABEL_MIN_ZOOM;
  map.setLayoutProperty("analytics-province-labels", "visibility", show ? "visible" : "none");
}

function syncAnalyticsLayerVisibility() {
  const showChoropleth = isAnalyticsBasemap(activeBasemapId);
  const hasProvinces = (layerCache.analyticsProvinces.features?.length ?? 0) > 0;
  for (const layerId of ["analytics-grid-fill", "analytics-grid-line"]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "none");
    }
  }
  for (const layerId of ["analytics-choropleth-fill", "analytics-choropleth-line"]) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", showChoropleth ? "visible" : "none");
    }
  }
  syncProvinceLabelsForZoom();
}

function tuneLayerPaintForBasemap(basemapId) {
  const imagery = isImageryBasemap(basemapId);
  const analytics = isAnalyticsBasemap(basemapId);
  const nowcastFillOpacity = imagery ? 0.52 : analytics ? 0.65 : 0.48;
  const nowcastLineWidth = [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    2.8,
    6,
    4,
    10,
    5.5,
    14,
    7,
  ];
  const nowcastGlowWidth = [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,
    8,
    6,
    12,
    10,
    18,
    14,
    24,
  ];
  if (map.getLayer("nowcast-fill")) {
    map.setPaintProperty("nowcast-fill", "fill-opacity", nowcastFillOpacity);
    map.setPaintProperty("nowcast-fill", "fill-color", NOWCAST_SEVERITY_FILL_COLOR);
  }
  if (map.getLayer("nowcast-glow")) {
    map.setPaintProperty("nowcast-glow", "line-color", NOWCAST_SEVERITY_LINE_COLOR);
    map.setPaintProperty("nowcast-glow", "line-width", nowcastGlowWidth);
    map.setPaintProperty("nowcast-glow", "line-opacity", imagery ? 0.5 : 0.72);
  }
  if (map.getLayer("nowcast-fill-outline")) {
    map.setPaintProperty("nowcast-fill-outline", "line-width", nowcastLineWidth);
    map.setPaintProperty("nowcast-fill-outline", "line-color", "#f0fdfa");
    map.setPaintProperty("nowcast-fill-outline", "line-opacity", 1);
  }
  if (map.getLayer("firms-circles")) {
    map.setPaintProperty("firms-circles", "circle-opacity", imagery ? 0.82 : 0.88);
    map.setPaintProperty("firms-circles", "circle-stroke-color", imagery ? "#fef3c7" : "#451a03");
  }
  if (map.getLayer("earthquake-halo")) {
    map.setPaintProperty("earthquake-halo", "circle-opacity", imagery ? 0.35 : 0.42);
  }
  if (map.getLayer("earthquake-circles")) {
    map.setPaintProperty("earthquake-circles", "circle-stroke-color", "#fefce8");
    map.setPaintProperty("earthquake-circles", "circle-stroke-width", imagery ? 2.5 : 2.2);
  }
  if (map.getLayer("analytics-grid-fill")) {
    map.setPaintProperty("analytics-grid-fill", "fill-opacity", analytics ? 0.52 : 0.35);
  }
  if (map.getLayer("analytics-choropleth-fill")) {
    map.setPaintProperty(
      "analytics-choropleth-fill",
      "fill-opacity",
      analytics ? CHOROPLETH_FILL_OPACITY : 0.5,
    );
    if (analytics) {
      map.setPaintProperty("analytics-choropleth-fill", "fill-color", CHOROPLETH_FILL_COLOR);
    }
  }
  if (map.getLayer("analytics-choropleth-line") && analytics) {
    map.setPaintProperty("analytics-choropleth-line", "line-color", CHOROPLETH_LINE_COLOR);
    map.setPaintProperty("analytics-choropleth-line", "line-opacity", CHOROPLETH_LINE_OPACITY);
    map.setPaintProperty("analytics-choropleth-line", "line-width", CHOROPLETH_LINE_WIDTH);
  }
  syncAnalyticsLayerVisibility();
}

function resetOperationalLayerState() {
  supportLayersBound = false;
  map.__copHandlersAttached = false;
  vectorLabelLayerIds.clear();
  resetBasemapEnhanceState();
}

function ensureMapLayerHandlers() {
  if (map.__copHandlersAttached) {
    return;
  }
  map.__copHandlersAttached = true;

  map.on("click", "nowcast-fill", (e) => {
    const props = e.features?.[0]?.properties || {};
    const lngLat = e.lngLat;
    showPopup(lngLat, "Peringatan cuaca", [
      `<strong>${escapeHtml(props.headline)}</strong>`,
      `Severity: ${escapeHtml(props.severity)} · Urgency: ${escapeHtml(props.urgency)}`,
      `Berakhir: ${escapeHtml(props.expires)}`,
      props.cap_identifier ? `CAP ID: ${escapeHtml(props.cap_identifier)}` : "",
    ]);
    setDetailHtml(
      `<span class="brief-title">${escapeHtml(props.headline)}</span>` +
        `<span class="brief-row"><strong>Severity</strong> ${escapeHtml(props.severity)} · ` +
        `<strong>Urgency</strong> ${escapeHtml(props.urgency)}</span>` +
        `<span class="brief-row">Berakhir: ${escapeHtml(props.expires)}</span>`,
    );
  });

  map.on("click", "earthquake-circles", (e) => {
    const props = e.features?.[0]?.properties || {};
    const lngLat = e.lngLat;
    showPopup(lngLat, `Gempa M${escapeHtml(props.magnitude)}`, [
      escapeHtml(props.region),
      escapeHtml(props.local_time),
      `Kedalaman: ${escapeHtml(props.depth)}`,
      escapeHtml(props.potential || ""),
    ]);
    setDetailHtml(
      `<span class="brief-title">M${escapeHtml(props.magnitude)} · ${escapeHtml(props.category)}</span>` +
        `<span class="brief-row">${escapeHtml(props.region)}</span>` +
        `<span class="brief-row">${escapeHtml(props.local_time)} · Kedalaman ${escapeHtml(props.depth)}</span>` +
        `<span class="brief-row">${escapeHtml(props.potential || "")}</span>`,
    );
  });

  map.on("click", "firms-circles", (e) => {
    const props = e.features?.[0]?.properties || {};
    showPopup(e.lngLat, "Hotspot FIRMS", [
      `FRP: ${escapeHtml(String(props.frp ?? "—"))} MW`,
      `Confidence: ${escapeHtml(String(props.confidence ?? "—"))}`,
      `Satelit: ${escapeHtml(String(props.satellite ?? "—"))}`,
      `Pengamatan: ${escapeHtml(String(props.acq_date ?? ""))} ${escapeHtml(String(props.acq_time ?? ""))}`,
      `<span class="prov-nonofficial">Sumber NASA FIRMS — bukan BMKG</span>`,
    ]);
  });

  map.on("click", "usgs-circles", (e) => {
    const props = e.features?.[0]?.properties || {};
    const url = props.url ? `<a href="${escapeHtml(props.url)}" target="_blank" rel="noopener">Detail USGS</a>` : "";
    showPopup(e.lngLat, `USGS M${escapeHtml(String(props.magnitude ?? "?"))}`, [
      escapeHtml(props.place || "—"),
      formatUsgsTime(props.time),
      props.depth_km != null ? `Kedalaman: ${escapeHtml(String(props.depth_km))} km` : "",
      url,
      `<span class="prov-nonofficial">Referensi USGS — operasional Indonesia: BMKG TEWS</span>`,
    ]);
  });

  map.on("click", "analytics-choropleth-fill", (e) => {
    const props = e.features?.[0]?.properties || {};
    showPopup(e.lngLat, escapeHtml(props.province_name || "Provinsi"), [
      `Skor risiko: ${escapeHtml(String(props.risk_score ?? "—"))}/100`,
      `Alert cuaca aktif: ${props.alert_active ? "Ya" : "Tidak"}`,
      `Titik gempa (BMKG): ${escapeHtml(String(props.earthquake_points ?? 0))}`,
      `Hotspot FIRMS: ${escapeHtml(String(props.fire_points ?? 0))}`,
      `Agregat grid: ${escapeHtml(String(props.grid_weight_sum ?? 0))}`,
    ]);
  });

  for (const layerId of [
    "nowcast-fill",
    "nowcast-glow",
    "nowcast-fill-outline",
    "earthquake-halo",
    "earthquake-circles",
    "firms-circles",
    "usgs-circles",
    "analytics-choropleth-fill",
  ]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function analyticsPayloadForBasemap() {
  if (!isAnalyticsBasemap(activeBasemapId)) {
    return { grid: EMPTY_FEATURE_COLLECTION, provinces: EMPTY_FEATURE_COLLECTION };
  }
  return {
    grid: layerCache.analyticsGrid,
    provinces: layerCache.analyticsProvinces,
  };
}

function ensureAnalyticsLayers(grid, provinces) {
  const showAnalytics = isAnalyticsBasemap(activeBasemapId);
  const gridData = showAnalytics ? grid : EMPTY_FEATURE_COLLECTION;
  const provinceData = showAnalytics ? provinces : EMPTY_FEATURE_COLLECTION;

  if (map.getSource("analytics-grid")) {
    map.getSource("analytics-grid").setData(gridData);
    map.getSource("analytics-provinces").setData(provinceData);
    if (!map.getLayer("analytics-province-labels")) {
      const before = map.getLayer("nowcast-fill") ? "nowcast-fill" : undefined;
      map.addLayer(
        {
          id: "analytics-province-labels",
          type: "symbol",
          source: "analytics-provinces",
          minzoom: 4,
          layout: {
            "text-field": ["coalesce", ["get", "province_name"], ["get", "shapeName"], ""],
            "text-font": mapTextFontStack(),
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              4,
              10,
              6,
              12,
              8,
              14,
              10,
              16,
            ],
            "text-max-width": 9,
            "text-line-height": 1.2,
            "text-letter-spacing": 0.02,
            "text-allow-overlap": false,
            "text-ignore-placement": false,
            "text-padding": 4,
            "symbol-placement": "point",
          },
          paint: {
            "text-color": "#f8fafc",
            "text-halo-color": "rgba(5, 10, 18, 0.92)",
            "text-halo-width": 1.6,
          },
        },
        before,
      );
    }
    syncAnalyticsLayerVisibility();
    return;
  }

  map.addSource("analytics-grid", { type: "geojson", data: gridData });
  map.addSource("analytics-provinces", { type: "geojson", data: provinceData });

  const before = map.getLayer("nowcast-fill") ? "nowcast-fill" : undefined;

  map.addLayer(
    {
      id: "analytics-grid-fill",
      type: "fill",
      source: "analytics-grid",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "intensity"],
          0,
          "#0e7490",
          0.25,
          "#0891b2",
          0.55,
          "#f59e0b",
          0.85,
          "#ef4444",
          1,
          "#7f1d1d",
        ],
        "fill-opacity": 0.52,
      },
    },
    before,
  );

  map.addLayer(
    {
      id: "analytics-grid-line",
      type: "line",
      source: "analytics-grid",
      paint: {
        "line-color": "#67e8f9",
        "line-width": 0.35,
        "line-opacity": 0.22,
      },
    },
    before,
  );

  map.addLayer(
    {
      id: "analytics-choropleth-fill",
      type: "fill",
      source: "analytics-provinces",
      paint: {
        "fill-color": CHOROPLETH_FILL_COLOR,
        "fill-opacity": CHOROPLETH_FILL_OPACITY,
      },
    },
    before,
  );

  map.addLayer(
    {
      id: "analytics-choropleth-line",
      type: "line",
      source: "analytics-provinces",
      paint: {
        "line-color": CHOROPLETH_LINE_COLOR,
        "line-width": CHOROPLETH_LINE_WIDTH,
        "line-opacity": CHOROPLETH_LINE_OPACITY,
      },
    },
    before,
  );

  map.addLayer(
    {
      id: "analytics-province-labels",
      type: "symbol",
      source: "analytics-provinces",
      minzoom: 4,
      layout: {
        "text-field": ["coalesce", ["get", "province_name"], ["get", "shapeName"], ""],
        "text-font": mapTextFontStack(),
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          10,
          6,
          12,
          8,
          14,
          10,
          16,
        ],
        "text-max-width": 9,
        "text-line-height": 1.2,
        "text-letter-spacing": 0.02,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-padding": 4,
        "symbol-placement": "point",
      },
      paint: {
        "text-color": "#f8fafc",
        "text-halo-color": "rgba(5, 10, 18, 0.92)",
        "text-halo-width": 1.6,
      },
    },
    before,
  );

  syncAnalyticsLayerVisibility();
}

function applyOperationalLayers() {
  if (!map.isStyleLoaded()) {
    return;
  }
  const analytics = analyticsPayloadForBasemap();
  ensureAnalyticsLayers(analytics.grid, analytics.provinces);
  addDataLayers(
    layerCache.nowcast,
    layerCache.earthquakes,
    layerCache.firms,
    layerCache.usgs,
  );
  ensureOperationalHighlightLayers();
  syncLayerVisibilityFromCheckboxes();
  tuneLayerPaintForBasemap(activeBasemapId);
  if (basemapStyleKey(activeBasemapId) === "esri-imagery") {
    applyEsriImageryLabelMode(activeBasemapId);
  }
  if (basemapStyleKey(activeBasemapId) === "openfreemap-dark") {
    enhanceOpenFreeMapDarkBasemap(map);
    enhanceVectorBasemapLabels();
  }
  ensureCopMapLighting(map);
  stackCopLayersOnTop(map);
  syncTerrainForZoom(map);
  ensureMapLayerHandlers();
}

scheduleApplyOperationalLayers = createOperationalLayerScheduler(
  map,
  () => layerCache,
  applyOperationalLayers,
);

map.once("load", () => {
  applyMap3DEnvironment(map);
  const restored = restoreMapViewIfSaved();
  if (!restored) {
    easeToDefault3DCamera(map);
  }
  scheduleApplyOperationalLayers();
});

function clearBasemapSwitchTimer() {
  if (basemapSwitchTimer) {
    clearTimeout(basemapSwitchTimer);
    basemapSwitchTimer = null;
  }
}

function finishBasemapStyleSwitch(camera, previousId) {
  clearBasemapSwitchTimer();
  try {
    map.jumpTo(camera);
    requestAnimationFrame(() => {
      applyMap3DEnvironment(map);
      applyOperationalLayers();
    });
    pendingBasemapId = null;
    updateBasemapChrome(activeBasemapId);
  } catch (err) {
    console.error(err);
    activeBasemapId = previousId;
    saveBasemapId(previousId);
    pendingBasemapId = null;
    updateBasemapChrome(previousId);
  }
  basemapSwitchInFlight = false;
  setBasemapButtonsBusy(false);
}

function switchBasemap(nextId) {
  if (nextId === activeBasemapId) {
    return;
  }
  if (basemapSwitchInFlight) {
    return;
  }

  const nextKey = basemapStyleKey(nextId);
  const currentKey = basemapStyleKey(activeBasemapId);
  if (nextKey === currentKey) {
    applyBasemapModeWithoutStyleReload(nextId);
    return;
  }

  const previousId = activeBasemapId;
  basemapSwitchInFlight = true;
  pendingBasemapId = nextId;
  setBasemapButtonsBusy(true);
  updateBasemapChrome(activeBasemapId);

  activeBasemapId = nextId;
  saveBasemapId(nextId);

  const camera = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };

  resetOperationalLayerState();
  clearBasemapSwitchTimer();

  const onStyleReady = () => {
    clearBasemapSwitchTimer();
    finishBasemapStyleSwitch(camera, previousId);
  };

  const onStyleSwitchTimeout = () => {
    if (!basemapSwitchInFlight) {
      return;
    }
    console.warn("Ganti basemap timeout — kembalikan mode sebelumnya");
    map.off("style.load", onStyleReady);
    clearBasemapSwitchTimer();
    activeBasemapId = previousId;
    saveBasemapId(previousId);
    pendingBasemapId = null;
    updateBasemapChrome(previousId);
    basemapSwitchInFlight = false;
    setBasemapButtonsBusy(false);
  };

  basemapSwitchTimer = setTimeout(onStyleSwitchTimeout, 18_000);

  map.once("style.load", onStyleReady);
  map.setStyle(getBasemapStyle(nextId));
}

function initBasemapSwitcher() {
  updateBasemapChrome(activeBasemapId);
  document.querySelectorAll(".basemap-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-basemap");
      if (
        next === "hybrid" ||
        next === "satellite" ||
        next === "tactical" ||
        next === "analytics" ||
        next === "streets"
      ) {
        switchBasemap(next);
      }
    });
  });
}

initBasemapSwitcher();

function ensureSupportLayers(firms, usgs) {
  if (map.getSource("firms")) {
    map.getSource("firms").setData(firms);
    map.getSource("usgs-quakes").setData(usgs);
    return;
  }

  map.addSource("firms", { type: "geojson", data: firms });
  map.addSource("usgs-quakes", { type: "geojson", data: usgs });

  const beforeEq = map.getLayer("earthquake-circles") ? "earthquake-circles" : undefined;

  map.addLayer(
    {
      id: "firms-circles",
      type: "circle",
      source: "firms",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "frp"], 1],
          1,
          4,
          20,
          8,
          80,
          14,
        ],
        "circle-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "frp"], 1],
          1,
          "#fbbf24",
          30,
          "#f97316",
          80,
          "#ef4444",
        ],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#451a03",
        "circle-opacity": 0.88,
      },
    },
    beforeEq,
  );

  map.addLayer({
    id: "usgs-circles",
    type: "circle",
    source: "usgs-quakes",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "magnitude"], 4],
        4,
        5,
        6,
        10,
        7,
        14,
      ],
      "circle-color": "#a78bfa",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#4c1d95",
      "circle-opacity": 0.85,
    },
  });

  if (!supportLayersBound) {
    bindLayerToggle("firms-circles", "layer-firms");
    bindLayerToggle("usgs-circles", "layer-usgs");
    supportLayersBound = true;
  }
}

function ensureOperationalHighlightLayers() {
  if (map.getSource("nowcast") && !map.getLayer("nowcast-glow")) {
    const beforeOutline = map.getLayer("nowcast-fill-outline")
      ? "nowcast-fill-outline"
      : undefined;
    map.addLayer(
      {
        id: "nowcast-glow",
        type: "line",
        source: "nowcast",
        paint: {
          "line-color": NOWCAST_SEVERITY_LINE_COLOR,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            3,
            8,
            6,
            12,
            10,
            18,
            14,
            24,
          ],
          "line-blur": 2,
          "line-opacity": 0.72,
        },
      },
      beforeOutline,
    );
  }
  if (map.getSource("earthquakes") && !map.getLayer("earthquake-halo")) {
    map.addLayer(
      {
        id: "earthquake-halo",
        type: "circle",
        source: "earthquakes",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            3,
            ["interpolate", ["linear"], ["get", "magnitude"], 3, 12, 5, 18, 7, 26],
            8,
            ["interpolate", ["linear"], ["get", "magnitude"], 3, 10, 5, 16, 7, 28],
          ],
          "circle-color": [
            "match",
            ["get", "category"],
            "latest",
            "#ef4444",
            "strong",
            "#fb923c",
            "felt",
            "#fde047",
            "#94a3b8",
          ],
          "circle-opacity": 0.38,
          "circle-blur": 0.35,
          "circle-pitch-alignment": "map",
        },
      },
      map.getLayer("earthquake-circles") ? "earthquake-circles" : undefined,
    );
  }
}

function addDataLayers(nowcast, earthquakes, firms, usgs) {
  if (map.getSource("nowcast")) {
    map.getSource("nowcast").setData(nowcast);
    map.getSource("earthquakes").setData(earthquakes);
    ensureOperationalHighlightLayers();
    ensureSupportLayers(firms, usgs);
    return;
  }

  map.addSource("nowcast", { type: "geojson", data: nowcast });
  map.addSource("earthquakes", { type: "geojson", data: earthquakes });

  map.addLayer({
    id: "nowcast-fill",
    type: "fill",
    source: "nowcast",
    paint: {
      "fill-color": NOWCAST_SEVERITY_FILL_COLOR,
      "fill-opacity": 0.65,
    },
  });

  map.addLayer({
    id: "nowcast-fill-outline",
    type: "line",
    source: "nowcast",
    paint: {
      "line-color": "#f0fdfa",
      "line-width": 3,
      "line-opacity": 1,
    },
  });

  ensureOperationalHighlightLayers();

  map.addLayer({
    id: "earthquake-circles",
    type: "circle",
    source: "earthquakes",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        ["interpolate", ["linear"], ["get", "magnitude"], 3, 6, 5, 10, 7, 14],
        8,
        ["interpolate", ["linear"], ["get", "magnitude"], 3, 5, 5, 9, 7, 16],
      ],
      "circle-color": [
        "match",
        ["get", "category"],
        "latest",
        "#ef4444",
        "strong",
        "#fb923c",
        "felt",
        "#fde047",
        "#94a3b8",
      ],
      "circle-stroke-width": 2.2,
      "circle-stroke-color": "#fefce8",
      "circle-opacity": 0.95,
      "circle-blur": 0.1,
      "circle-pitch-alignment": "map",
    },
  });

  bindLayerToggle("nowcast-fill", "layer-nowcast", ["nowcast-glow", "nowcast-fill-outline"]);
  bindLayerToggle("earthquake-circles", "layer-earthquake", ["earthquake-halo"]);

  ensureSupportLayers(firms, usgs);
  ensureMapLayerHandlers();
}

async function refresh() {
  try {
    const [summary, nowcast, earthquakes, firms, usgs, analytics] = await Promise.all([
      fetchJson("/api/v1/national/summary"),
      fetchJson("/api/v1/nowcast/geojson"),
      fetchJson("/api/v1/earthquake/geojson"),
      fetchSupportJson("/api/v1/support/firms/geojson"),
      fetchSupportJson("/api/v1/support/usgs/earthquake/geojson"),
      fetchSupportJson("/api/v1/viz/analytics/geojson"),
    ]);

    const nowcastFc = {
      type: "FeatureCollection",
      features: nowcast.features || [],
    };
    const eqFc = {
      type: "FeatureCollection",
      features: earthquakes.features || [],
    };
    const firmsFc = {
      type: "FeatureCollection",
      features: firms.features || [],
    };
    const usgsFc = {
      type: "FeatureCollection",
      features: usgs.features || [],
    };

    layerCache.nowcast = nowcastFc;
    layerCache.earthquakes = eqFc;
    layerCache.firms = firmsFc;
    layerCache.usgs = usgsFc;
    layerCache.analyticsGrid = analytics.grid || { type: "FeatureCollection", features: [] };
    layerCache.analyticsProvinces = analytics.provinces || {
      type: "FeatureCollection",
      features: [],
    };

    if (lastContextLngLat) {
      updateMapContext(lastContextLngLat.lng, lastContextLngLat.lat, lastContextMode);
    }

    scheduleApplyOperationalLayers?.();

    requestAnimationFrame(() => {
      syncHudTop();
      resizeMapCanvas();
    });

    const provinces = summary.provinces_with_weather_alerts || [];
    renderCopAlertTable(provinces, nowcastFc.features);
    syncProvinceLabelsForZoom();
    const latest = summary.latest_earthquake || {};
    setDetailHtml(
      `<span class="brief-title">Ringkasan nasional</span>` +
        `<span class="brief-row"><strong>Peringatan cuaca (CAP)</strong> ${summary.nowcast_active ?? 0} aktif · ` +
        `<strong>${provinces.length}</strong> provinsi terdampak.</span>` +
        (latest.Magnitude
          ? `<span class="brief-row"><strong>Gempa terbaru (TEWS)</strong> M${escapeHtml(latest.Magnitude)} — ${escapeHtml(latest.Wilayah || latest.wilayah || "BMKG")}</span>`
          : "") +
        `<span class="brief-row">Cari adm4 untuk prakiraan 3 hari. Klik polygon cuaca atau titik gempa untuk detail.</span>` +
        (nowcast.provenance?.ingested_at
          ? `<span class="brief-row"><strong>Cuaca di-ingest</strong> ${escapeHtml(formatFetchedAt(nowcast.provenance.ingested_at))}</span>`
          : "") +
        (earthquakes.provenance?.ingested_at
          ? `<span class="brief-row"><strong>Gempa di-ingest</strong> ${escapeHtml(formatFetchedAt(earthquakes.provenance.ingested_at))}</span>`
          : ""),
    );

    setFeedStatus(true);
    lastSyncEl.textContent = `Sync: ${new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;
  } catch (err) {
    setFeedStatus(false);
    setDetailHtml(
      `<span class="brief-title">Feed error</span>` +
        `<span class="brief-row">${escapeHtml(err.message)}</span>` +
        `<span class="brief-row">Pastikan backend aktif di port 8080.</span>`,
    );
  }
}

// Fetch telemetri sekali; layer diterapkan via scheduler (style + data siap).
void refresh();
setInterval(refresh, 60_000);
