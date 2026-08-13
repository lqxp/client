import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { buildRuntimeScript } from "./scripts/runtime-lib.mjs";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

const isWeb = basename(process.cwd()) === "web";

function runtimeConfigPlugin() {
  return {
    name: "qxp-runtime-config",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || "";
        if (!url.endsWith("/runtime-config.js")) {
          return next();
        }
        try {
          const script = await buildRuntimeScript();
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(script);
        } catch (error) {
          console.error("[qxp-runtime-config] failed to generate:", error);
          res.statusCode = 500;
          res.end("/* runtime config generation failed */");
        }
      });
    },
  };
}

export default defineConfig({
  base: isWeb ? "/app/" : "./",

  plugins: [vue(), runtimeConfigPlugin()],

  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: true
  },

  server: {
    host: "0.0.0.0",
    port: 4173,
  },

  define: {
    __APP_VERSION__: JSON.stringify(String(packageJson.version || "0.0.0")),
  },
});
