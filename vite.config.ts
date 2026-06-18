import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

const isWeb = basename(process.cwd()) === "web";

export default defineConfig({
  base: isWeb ? "/app/" : "./",

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
