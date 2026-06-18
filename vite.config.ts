import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const isTauri = process.env.TAURI_PLATFORM !== undefined;
console.log(process.env.TAURI_PLATFORM)
export default defineConfig({
  base: isTauri ? "./" : "/app/",
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 4173,
  },
  define: {
    __APP_VERSION__: JSON.stringify(String(packageJson.version || "0.0.0")),
  },
});
