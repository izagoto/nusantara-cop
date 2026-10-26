/** @typedef {'hybrid' | 'satellite' | 'tactical' | 'analytics' | 'streets'} BasemapId */

/** Zoom maksimum interaksi peta (citra Esri / OSM mendukung detail pemukiman) */
export const MAP_MAX_ZOOM = 20;

/** DEM untuk relief 3D — ditambahkan ke style inline & runtime (map3d.js) */
export const TERRAIN_DEM_SOURCE = {
  type: "raster-dem",
  url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
  tileSize: 256,
};

const STORAGE_KEY = "indonesia-cop-basemap";

const ESRI_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places_Alternate/MapServer/tile/{z}/{y}/{x}";

const ESRI_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community";

export const BASEMAP_OPTIONS = [
  {
    id: "analytics",
    label: "Analitik",
    description: "Koroplet provinsi + grid kepadatan telemetri",
  },
  {
    id: "hybrid",
    label: "Hibrid",
    description: "Satelit + label",
  },
  {
    id: "satellite",
    label: "Satelit",
    description: "Citra satelit tanpa label",
  },
  {
    id: "tactical",
    label: "Taktis",
    description: "Peta gelap vektor (OpenFreeMap)",
  },
  {
    id: "streets",
    label: "Pemukiman",
    description: "Jalan & nama lokasi (Esri World Street Map)",
  },
];

/** Esri (sama keluarga tile Hibrid/Satelit) — CARTO Voyager sekarang wajib API key */
const ESRI_STREETS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const ESRI_STREETS_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, HERE, Garmin, USGS, GeoTechnologies, Inc., OpenStreetMap contributors";

/** @returns {BasemapId} */
export function loadBasemapId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (
      saved === "hybrid" ||
      saved === "satellite" ||
      saved === "tactical" ||
      saved === "analytics" ||
      saved === "streets"
    ) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return "analytics";
}

/** @param {BasemapId} id */
export function saveBasemapId(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Kunci kelompok style — sama = ganti mode tanpa `setStyle` penuh */
export function basemapStyleKey(id) {
  if (id === "analytics" || id === "tactical") {
    return "openfreemap-dark";
  }
  if (id === "hybrid" || id === "satellite") {
    return "esri-imagery";
  }
  if (id === "streets") {
    return "esri-streets";
  }
  return String(id);
}

/** @param {BasemapId} id */
export function getBasemapStyle(id) {
  if (id === "streets") {
    /** @type {import('maplibre-gl').StyleSpecification} */
    return {
      version: 8,
      name: "Indonesia COP Streets",
      projection: { type: "globe" },
      sources: {
        "cop-terrain-dem": TERRAIN_DEM_SOURCE,
        "esri-streets": {
          type: "raster",
          tiles: [ESRI_STREETS],
          tileSize: 256,
          attribution: ESRI_STREETS_ATTRIBUTION,
          maxzoom: 20,
        },
      },
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#000000" },
        },
        {
          id: "basemap-streets",
          type: "raster",
          source: "esri-streets",
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    };
  }

  if (id === "tactical" || id === "analytics") {
    return "https://tiles.openfreemap.org/styles/dark";
  }

  /** @type {import('maplibre-gl').StyleSpecification} */
  const style = {
    version: 8,
    name: id === "hybrid" ? "Indonesia COP Hybrid" : "Indonesia COP Satellite",
    projection: { type: "globe" },
    sources: {
      "cop-terrain-dem": TERRAIN_DEM_SOURCE,
      "esri-imagery": {
        type: "raster",
        tiles: [ESRI_IMAGERY],
        tileSize: 256,
        attribution: ESRI_ATTRIBUTION,
        maxzoom: 20,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#000000" },
      },
      {
        id: "basemap-satellite",
        type: "raster",
        source: "esri-imagery",
        minzoom: 0,
        maxzoom: 22,
        paint: {
          "raster-opacity": 1,
          "raster-contrast": 0.08,
          "raster-saturation": 0.12,
          "raster-brightness-min": 0.05,
          "raster-brightness-max": 0.95,
        },
      },
    ],
  };

  style.sources["esri-labels"] = {
    type: "raster",
    tiles: [ESRI_LABELS],
    tileSize: 256,
    maxzoom: 20,
  };
  style.layers.push({
    id: "basemap-labels",
    type: "raster",
    source: "esri-labels",
    minzoom: 0,
    maxzoom: 22,
    layout: {
      visibility: id === "hybrid" ? "visible" : "none",
    },
    paint: {
      "raster-opacity": 1,
      "raster-contrast": 0.05,
      "raster-brightness-min": 0.08,
      "raster-brightness-max": 1,
    },
  });

  return style;
}

/** @param {BasemapId} id */
export function getBasemapAttribution(id) {
  if (id === "streets") {
    return {
      label: "Esri World Street Map",
      href: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
    };
  }
  if (id === "tactical" || id === "analytics") {
    return {
      label: id === "analytics" ? "OpenFreeMap + geoBoundaries" : "OpenFreeMap",
      href: "https://openfreemap.org",
    };
  }
  return {
    label: "Esri World Imagery",
    href: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
  };
}

/** @param {BasemapId} id */
export function isImageryBasemap(id) {
  return id === "hybrid" || id === "satellite";
}

/** @param {BasemapId} id */
export function isAnalyticsBasemap(id) {
  return id === "analytics";
}

/** @param {BasemapId | string} id */
export function basemapLabel(id) {
  const hit = BASEMAP_OPTIONS.find((o) => o.id === id);
  return hit?.label ?? String(id);
}

/** Label singkat uppercase untuk HUD bawah (seperti STYLE: TACTICAL) */
const BASEMAP_HUD_STYLE = {
  analytics: "ANALYTICS",
  hybrid: "HYBRID",
  satellite: "SATELLITE",
  tactical: "TACTICAL",
  streets: "STREETS",
};

/** @param {BasemapId | string} id */
export function basemapHudStyle(id) {
  return BASEMAP_HUD_STYLE[id] ?? String(id).toUpperCase();
}
