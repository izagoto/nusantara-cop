/** Terrain + sky + bangunan 3D (MapLibre GL) — tanpa API key tambahan */

export const TERRAIN_SOURCE_ID = "cop-terrain-dem";
const TERRAIN_TILES_URL = "https://demotiles.maplibre.org/terrain-tiles/tiles.json";
export const BUILDING_3D_LAYER_ID = "cop-building-3d";

export const DEFAULT_TERRAIN_EXAGGERATION = 1.4;
export const DEFAULT_MAP_PITCH = 50;
export const DEFAULT_MAP_BEARING = 12;

/** Globe premium — hitam dominan, halo horizon gelap (bukan abu / biru portal cuaca) */
export const COP_PREMIUM_SKY = {
  "sky-color": "#000000",
  "horizon-color": "#0d1520",
  "sky-horizon-blend": 0.42,
  "fog-color": "#030508",
  "fog-ground-blend": 0.16,
  "horizon-fog-blend": 0.38,
  "atmosphere-blend": [
    "interpolate",
    ["linear"],
    ["zoom"],
    2,
    0.72,
    5,
    0.55,
    8,
    0.32,
    12,
    0.12,
  ],
};

/**
 * @param {import('maplibre-gl').Map} map
 */
export function ensureMapTerrain(map) {
  if (!map.isStyleLoaded()) {
    return;
  }
  try {
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
      map.addSource(TERRAIN_SOURCE_ID, {
        type: "raster-dem",
        url: TERRAIN_TILES_URL,
        tileSize: 256,
      });
    }
    const zoom = map.getZoom();
    const exaggeration =
      zoom < 5 ? 0.62 : zoom < 7 ? 1.05 : DEFAULT_TERRAIN_EXAGGERATION;
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
  } catch (err) {
    console.warn("Terrain 3D tidak dapat diaktifkan:", err);
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
/** Langit + atmosfer globe (MapLibre Style Spec — sky.*) */
export function ensureMapSky(map) {
  if (!map.isStyleLoaded()) {
    return;
  }
  try {
    map.setSky(COP_PREMIUM_SKY);
  } catch (err) {
    console.warn("Sky premium tidak dapat diterapkan:", err);
  }
}

const MAP_BACKGROUND_COLOR = "#000000";

/**
 * @param {import('maplibre-gl').Map} map
 */
export function ensureMapBackgroundBlack(map) {
  if (!map.isStyleLoaded()) {
    return;
  }
  const layers = map.getStyle()?.layers;
  if (!layers?.length) {
    return;
  }
  let hasBackground = false;
  for (const layer of layers) {
    if (layer.type !== "background") {
      continue;
    }
    hasBackground = true;
    try {
      map.setPaintProperty(layer.id, "background-color", MAP_BACKGROUND_COLOR);
    } catch {
      /* ignore */
    }
  }
  if (!hasBackground) {
    try {
      map.addLayer(
        {
          id: "cop-background",
          type: "background",
          paint: { "background-color": MAP_BACKGROUND_COLOR },
        },
        layers[0]?.id,
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function ensureGlobeProjection(map) {
  try {
    map.setProjection({ type: "globe" });
  } catch {
    /* ignore */
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @returns {string | undefined}
 */
function firstSymbolLayerId(map) {
  const layers = map.getStyle()?.layers;
  if (!layers) {
    return undefined;
  }
  for (const layer of layers) {
    if (layer.type === "symbol") {
      return layer.id;
    }
  }
  return undefined;
}

/**
 * Extrude bangunan dari layer vektor OpenFreeMap / OpenMapTiles (zoom pemukiman).
 * @param {import('maplibre-gl').Map} map
 */
export function ensureBuildingExtrusion(map) {
  if (!map.isStyleLoaded() || map.getLayer(BUILDING_3D_LAYER_ID)) {
    return;
  }
  const layers = map.getStyle()?.layers;
  if (!layers) {
    return;
  }
  let vectorSource = null;
  for (const layer of layers) {
    if (layer["source-layer"] === "building" && layer.source) {
      vectorSource = layer.source;
      break;
    }
  }
  if (!vectorSource) {
    return;
  }
  try {
    map.addLayer(
      {
        id: BUILDING_3D_LAYER_ID,
        type: "fill-extrusion",
        source: vectorSource,
        "source-layer": "building",
        minzoom: 13,
        filter: ["==", ["get", "extrude"], "true"],
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["get", "render_height"],
            0,
            "#0f172a",
            40,
            "#1e293b",
            120,
            "#334155",
          ],
          "fill-extrusion-height": [
            "coalesce",
            ["get", "render_height"],
            ["get", "height"],
            8,
          ],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.72,
        },
      },
      firstSymbolLayerId(map),
    );
  } catch (err) {
    console.warn("Layer bangunan 3D dilewati:", err);
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function syncTerrainForZoom(map) {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    return;
  }
  const zoom = map.getZoom();
  const exaggeration =
    zoom < 5 ? 0.62 : zoom < 7 ? 1.05 : DEFAULT_TERRAIN_EXAGGERATION;
  try {
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
  } catch {
    /* ignore */
  }
}

export function applyMap3DEnvironment(map) {
  ensureGlobeProjection(map);
  ensureMapBackgroundBlack(map);
  ensureMapTerrain(map);
  ensureMapSky(map);
  ensureBuildingExtrusion(map);
}

/**
 * Kamera oblique default saat belum ada view tersimpan.
 * @param {import('maplibre-gl').Map} map
 */
export function easeToDefault3DCamera(map) {
  map.easeTo({
    pitch: DEFAULT_MAP_PITCH,
    bearing: DEFAULT_MAP_BEARING,
    duration: 1400,
    essential: true,
  });
}
