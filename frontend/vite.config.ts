import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In development the API runs separately on :8000; in production FastAPI serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, proxy: { "/api": "http://localhost:8000" } },
});
