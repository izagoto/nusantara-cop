/** Layer telemetri COP — urutan di atas basemap & pencahayaan agar warna terbaca di globe 3D */

const COP_LAYER_PREFIXES = [
  "analytics-",
  "nowcast",
  "earthquake",
  "firms-",
  "usgs-",
  "cop-",
];

/** @param {string} layerId */
export function isCopOperationalLayerId(layerId) {
  return COP_LAYER_PREFIXES.some((prefix) => layerId.startsWith(prefix));
}

const COP_LAYER_STACK_BOTTOM_TO_TOP = [
  "analytics-grid-fill",
  "analytics-grid-line",
  "analytics-choropleth-fill",
  "analytics-choropleth-line",
  "nowcast-fill",
  "nowcast-glow",
  "nowcast-fill-outline",
  "analytics-province-labels",
  "earthquake-halo",
  "earthquake-circles",
  "firms-circles",
  "usgs-circles",
  "cop-building-3d",
];

export function stackCopLayersOnTop(map) {
  if (!map.isStyleLoaded()) {
    return;
  }
  for (const layerId of COP_LAYER_STACK_BOTTOM_TO_TOP) {
    if (!map.getLayer(layerId)) {
      continue;
    }
    try {
      map.moveLayer(layerId);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pencahayaan terang — fill/koropleth tidak “mati” di proyeksi globe.
 * @param {import('maplibre-gl').Map} map
 */
export function ensureCopMapLighting(map) {
  try {
    map.setLight({
      anchor: "viewport",
      color: "#e2e8f0",
      intensity: 0.78,
      position: [1.15, 200, 42],
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ nowcast?: { features?: unknown[] }; analyticsProvinces?: { features?: unknown[] }; earthquakes?: { features?: unknown[] } }} cache
 */
export function hasOperationalLayerData(cache) {
  return Boolean(
    cache.nowcast?.features?.length ||
      cache.earthquakes?.features?.length ||
      cache.analyticsProvinces?.features?.length,
  );
}

/**
 * Terapkan layer telemetri setelah style + data siap (hindari race saat hard refresh).
 * @param {import('maplibre-gl').Map} map
 * @param {() => Parameters<typeof hasOperationalLayerData>[0]} getCache
 * @param {() => void} applyOperationalLayers
 */
export function createOperationalLayerScheduler(map, getCache, applyOperationalLayers) {
  let pending = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;

  const cleanup = (onLoad, onStyleLoad) => {
    pending = false;
    map.off("load", onLoad);
    map.off("style.load", onStyleLoad);
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  return function scheduleApplyOperationalLayers() {
    const cache = getCache();
    if (!hasOperationalLayerData(cache)) {
      return;
    }

    const attempt = () => {
      if (!map.isStyleLoaded()) {
        return false;
      }
      applyOperationalLayers();
      return true;
    };

    if (attempt()) {
      return;
    }
    if (pending) {
      return;
    }
    pending = true;

    const onReady = () => {
      if (attempt()) {
        cleanup(onReady, onReady);
      }
    };

    map.on("load", onReady);
    map.on("style.load", onReady);

    let attempts = 0;
    pollTimer = setInterval(() => {
      attempts += 1;
      if (attempt() || attempts >= 48) {
        cleanup(onReady, onReady);
      }
    }, 250);
  };
}
