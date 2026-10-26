import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Vite prebundle breaks MapLibre worker → blank map in dev
    exclude: ["maplibre-gl"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        timeout: 120_000,
        proxyTimeout: 120_000,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl")) {
            return "maplibre";
          }
        },
      },
    },
  },
});
