/** Kontras warna basemap vektor gelap (OpenFreeMap) — laut vs daratan tetap tema COP */

import { isCopOperationalLayerId } from "./mapOperationalLayers.js";

const TUNED_LAYER_IDS = new Set();

export function resetBasemapEnhanceState() {
  TUNED_LAYER_IDS.clear();
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function enhanceOpenFreeMapDarkBasemap(map) {
  if (!map.isStyleLoaded()) {
    return;
  }
  for (const layer of map.getStyle()?.layers || []) {
    if (layer.type === "background") {
      try {
        map.setPaintProperty(layer.id, "background-color", "#000000");
      } catch {
        /* ignore */
      }
    }
  }
  const layers = map.getStyle()?.layers;
  if (!layers?.length) {
    return;
  }

  for (const layer of layers) {
    if (TUNED_LAYER_IDS.has(layer.id)) {
      continue;
    }
    const id = layer.id;
    if (isCopOperationalLayerId(id)) {
      continue;
    }
    const sourceLayer = layer["source-layer"] || "";
    const source = layer.source;
    if (source && map.getSource(source)?.type === "geojson") {
      continue;
    }

    if (layer.type === "fill") {
      if (sourceLayer === "water" || /\bwater\b|ocean|sea|marine|waterway/i.test(id)) {
        try {
          map.setPaintProperty(id, "fill-color", "#030712");
          map.setPaintProperty(id, "fill-opacity", 1);
          TUNED_LAYER_IDS.add(id);
        } catch {
          /* ignore */
        }
        continue;
      }
      if (
        sourceLayer === "landcover" ||
        sourceLayer === "landuse" ||
        /landcover|landuse|land\b|urban|park|grass|wood|ice/i.test(id)
      ) {
        try {
          map.setPaintProperty(id, "fill-color", "#0a0f14");
          map.setPaintProperty(id, "fill-opacity", 1);
          TUNED_LAYER_IDS.add(id);
        } catch {
          /* ignore */
        }
      }
    }

    if (layer.type === "line") {
      if (
        sourceLayer === "boundary" ||
        /bound|border|admin|country|state|disputed/i.test(id)
      ) {
        try {
          map.setPaintProperty(id, "line-color", "#1e3a4f");
          map.setPaintProperty(id, "line-opacity", 0.45);
          map.setPaintProperty(id, "line-width", [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            0.4,
            6,
            0.8,
            10,
            1.2,
          ]);
          TUNED_LAYER_IDS.add(id);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Ramp koropleth — provinsi tanpa risiko tetap terbaca di atas laut hitam */
export const CHOROPLETH_FILL_COLOR = [
  "interpolate",
  ["linear"],
  ["coalesce", ["get", "risk_score"], 0],
  0,
  "#1e4d63",
  12,
  "#0e7490",
  28,
  "#06b6d4",
  45,
  "#22c55e",
  60,
  "#eab308",
  78,
  "#f97316",
  100,
  "#dc2626",
];

export const CHOROPLETH_LINE_COLOR = "#e0f2fe";
export const CHOROPLETH_FILL_OPACITY = 0.92;
export const CHOROPLETH_LINE_OPACITY = 0.95;
export const CHOROPLETH_LINE_WIDTH = 2.75;

/** Warna garis / glow polygon CAP (severity BMKG) */
export const NOWCAST_SEVERITY_LINE_COLOR = [
  "match",
  ["get", "severity"],
  "Extreme",
  "#ff5555",
  "Severe",
  "#fb923c",
  "Moderate",
  "#fde047",
  "#22d3ee",
];

export const NOWCAST_SEVERITY_FILL_COLOR = [
  "match",
  ["get", "severity"],
  "Extreme",
  "#ef4444",
  "Severe",
  "#f97316",
  "Moderate",
  "#fbbf24",
  "#22d3ee",
];
