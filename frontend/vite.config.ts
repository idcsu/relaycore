import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Go panel serves the built assets from ../web as plain static files.
// We keep everything same-origin and self-hosted (no runtime CDN) so the
// strict Content-Security-Policy on the backend is satisfied.
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:10028";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "../web",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // The backend rejects state-changing requests whose Origin does not
      // match its own host, so rewrite Origin to the proxy target in dev.
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
        headers: { Origin: proxyTarget },
      },
      "/healthz": {
        target: proxyTarget,
        changeOrigin: true,
        headers: { Origin: proxyTarget },
      },
    },
  },
});
