import { existsSync, watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const initialEnvKeys = new Set(Object.keys(process.env));
const dotenvKeys = new Set();
const dotenvFiles = [
  resolve(".env.local"),
  resolve(".env"),
  resolve("../.env.local"),
  resolve("../.env")
];
let lastOutputScript = "";
let syncTimer;
let syncing = false;

function parseDotEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadDotEnvFile(filepath) {
  try {
    const contents = await readFile(filepath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (initialEnvKeys.has(key) && typeof process.env[key] === "string" && process.env[key].trim()) continue;
      if (typeof process.env[key] === "string" && process.env[key].trim()) continue;
      process.env[key] = parseDotEnvValue(rawValue);
      dotenvKeys.add(key);
    }
  } catch {
    /* optional dotenv file */
  }
}

async function loadDotEnvFiles() {
  for (const key of dotenvKeys) {
    if (!initialEnvKeys.has(key)) delete process.env[key];
  }
  dotenvKeys.clear();

  for (const filepath of dotenvFiles) {
    await loadDotEnvFile(filepath);
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function httpOrigin(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";

  const url = new URL(text.includes("://") ? text : `https://${text}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported server origin protocol: ${url.protocol}`);
  }
  return url.origin;
}

function webSocketUrlFromOrigin(origin) {
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeWsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const url = new URL(text);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported websocket protocol: ${url.protocol}`);
  }
  url.hash = "";
  return url.toString();
}

function parseBool(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return undefined;
  if (["1", "true", "yes", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(text)) return false;
  throw new Error(`Unsupported boolean value: ${value}`);
}

function parseStringArray(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildEnvRuntimePayload() {
  const serverOriginRaw = argValue("--server-origin") || firstEnv("QXP_SERVER_ORIGIN", "VITE_QXP_SERVER_ORIGIN");
  const apiBaseUrlRaw = argValue("--api-base-url") || firstEnv("QXP_API_BASE_URL", "VITE_QXP_API_BASE_URL");
  const wsUrlRaw = argValue("--ws-url") || firstEnv("QXP_WS_URL", "VITE_QXP_WS_URL");
  const turnUrlsRaw = argValue("--turn-urls") || firstEnv("QXP_TURN_URLS", "VITE_QXP_TURN_URLS");
  const turnUsernameRaw = argValue("--turn-username") || firstEnv("QXP_TURN_USERNAME", "VITE_QXP_TURN_USERNAME");
  const turnCredentialRaw = argValue("--turn-credential") || firstEnv("QXP_TURN_CREDENTIAL", "VITE_QXP_TURN_CREDENTIAL");
  const relayOnlyRaw = argValue("--relay-only") || firstEnv("QXP_RELAY_ONLY", "VITE_QXP_RELAY_ONLY");
  const callsEnabledRaw = argValue("--calls-enabled") || firstEnv("QXP_CALLS_ENABLED", "VITE_QXP_CALLS_ENABLED");
  const callsUnavailableReasonRaw = argValue("--calls-unavailable-reason") || firstEnv("QXP_CALLS_UNAVAILABLE_REASON", "VITE_QXP_CALLS_UNAVAILABLE_REASON");

  const serverOrigin = serverOriginRaw ? httpOrigin(serverOriginRaw) : "";
  const apiBaseUrl = apiBaseUrlRaw ? httpOrigin(apiBaseUrlRaw) : (serverOrigin || "");
  const wsUrl = wsUrlRaw ? normalizeWsUrl(wsUrlRaw) : (apiBaseUrl ? webSocketUrlFromOrigin(apiBaseUrl) : "");
  const turnUrls = parseStringArray(turnUrlsRaw);
  const relayOnly = parseBool(relayOnlyRaw);
  const callsEnabled = parseBool(callsEnabledRaw);
  const callsUnavailableReason = String(callsUnavailableReasonRaw || "").trim();

  const hasRtc = turnUrls.length || turnUsernameRaw || turnCredentialRaw || relayOnly !== undefined || callsEnabled !== undefined || callsUnavailableReason;
  const hasApp = serverOrigin || apiBaseUrl || wsUrl;
  if (!hasApp && !hasRtc) return null;

  return {
    ...(serverOrigin ? { serverOrigin } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(wsUrl ? { wsUrl } : {}),
    ...(hasRtc
      ? {
          rtc: {
            ...(relayOnly !== undefined ? { relayOnly } : {}),
            ...(turnUrls.length ? { turnUrls } : {}),
            ...(turnUsernameRaw ? { turnUsername: String(turnUsernameRaw).trim() } : {}),
            ...(turnCredentialRaw ? { turnCredential: String(turnCredentialRaw).trim() } : {}),
            ...(callsEnabled !== undefined ? { callsEnabled } : {}),
            ...(callsUnavailableReason ? { callsUnavailableReason } : {})
          }
        }
      : {})
  };
}

function runtimeScript(payload) {
  return `// Generated by scripts/sync-runtime-config.mjs. Do not edit by hand.\nwindow.__QXP_RUNTIME__ = ${JSON.stringify(payload)};\n`;
}

function extractRuntimeConfigFromHtml(html) {
  const runtimeConfigUrlMatch = String(html || "").match(
    /<script\b[^>]*\bsrc=["']([^"']*runtime-config\.js[^"']*)["'][^>]*><\/script>/i
  );
  if (runtimeConfigUrlMatch) {
    return { __runtimeConfigScriptUrl: runtimeConfigUrlMatch[1] };
  }

  const match = String(html || "").match(
    /<script\b[^>]*>\s*window\.__QXP_RUNTIME__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/m
  );
  if (!match) {
    throw new Error("Could not find runtime config in the production HTML.");
  }
  return JSON.parse(match[1]);
}

async function fetchRuntimeConfigScript(configUrl, htmlPayload) {
  const runtimeConfigScriptUrl = String(htmlPayload?.__runtimeConfigScriptUrl || "").trim();
  if (!runtimeConfigScriptUrl) return htmlPayload;

  const resolvedUrl = new URL(runtimeConfigScriptUrl, configUrl).toString();
  const response = await fetch(resolvedUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ${resolvedUrl}: HTTP ${response.status}`);
  }

  const script = await response.text();
  const match = script.match(/window\.__QXP_RUNTIME__\s*=\s*(\{[\s\S]*?\})\s*;?/m);
  if (!match) {
    throw new Error(`Could not find window.__QXP_RUNTIME__ in ${resolvedUrl}.`);
  }

  return JSON.parse(match[1]);
}

function parseOutputScript(outputScript) {
  return JSON.parse(outputScript.match(/window\.__QXP_RUNTIME__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/m)?.[1] || "{}");
}

async function buildOutputScript() {
  await loadDotEnvFiles();

  const configUrl = argValue("--url") || firstEnv("QXP_RUNTIME_CONFIG_URL");
  const envPayload = buildEnvRuntimePayload();

  if (configUrl) {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`Could not fetch ${configUrl}: HTTP ${response.status}`);
    }

    const htmlPayload = extractRuntimeConfigFromHtml(await response.text());
    const runtimeConfig = await fetchRuntimeConfigScript(configUrl, htmlPayload);
    const payload = {
      ...runtimeConfig,
      ...(envPayload || {}),
      rtc: {
        ...(runtimeConfig.rtc || {}),
        ...(envPayload?.rtc || {})
      }
    };

    return {
      outputScript: runtimeScript(payload),
      configSource: configUrl,
      rtcStatus: payload.rtc?.callsEnabled ? "enabled" : "disabled"
    };
  }

  if (envPayload) {
    return {
      outputScript: runtimeScript(envPayload),
      configSource: "environment",
      rtcStatus: envPayload.rtc?.callsEnabled ? "enabled" : envPayload.rtc ? "disabled" : "unknown"
    };
  }

  const localRuntimePath = resolve("public/runtime-config.js");
  return {
    outputScript: await readFile(localRuntimePath, "utf8"),
    configSource: localRuntimePath,
    rtcStatus: "unknown"
  };
}

async function syncRuntimeConfig() {
  if (syncing) return;
  syncing = true;

  try {
    const outputPath = resolve(argValue("--out") || "dist/runtime-config.js");
    const { outputScript, configSource, rtcStatus } = await buildOutputScript();

    if (outputScript !== lastOutputScript) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, outputScript, "utf8");
      lastOutputScript = outputScript;
    }

    const writtenPayload = parseOutputScript(outputScript);
    const summary = {
      configSource,
      outputPath,
      serverOrigin: writtenPayload.serverOrigin || "",
      apiBaseUrl: writtenPayload.apiBaseUrl || "",
      wsUrl: writtenPayload.wsUrl || "",
      rtc: {
        relayOnly: writtenPayload.rtc?.relayOnly,
        turnUrlsCount: Array.isArray(writtenPayload.rtc?.turnUrls) ? writtenPayload.rtc.turnUrls.length : 0,
        turnUsername: writtenPayload.rtc?.turnUsername ? "***set***" : "",
        turnCredential: writtenPayload.rtc?.turnCredential ? "***set***" : "",
        callsEnabled: writtenPayload.rtc?.callsEnabled,
        callsUnavailableReason: writtenPayload.rtc?.callsUnavailableReason || ""
      }
    };

    console.log(`Wrote ${outputPath} from ${configSource} with RTC ${rtcStatus}.`);
    console.log("Runtime config summary:");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    syncing = false;
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncRuntimeConfig().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }, 100);
}

await syncRuntimeConfig();

if (hasArg("--watch")) {
  const outputPath = resolve(argValue("--out") || "dist/runtime-config.js");
  const watchFiles = [...dotenvFiles, resolve("public/runtime-config.js"), outputPath];

  for (const filepath of watchFiles) {
    if (!existsSync(filepath)) continue;
    watch(filepath, { persistent: true }, scheduleSync);
  }

  console.log("Watching runtime config inputs.");
}
