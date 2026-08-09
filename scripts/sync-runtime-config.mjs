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

function parseTomlScalar(value) {
  const text = String(value || "").trim().replace(/,$/, "");
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

function parseRuntimeToml(raw) {
  const config = {};
  let section = "";
  let arrayKey = "";
  let arrayValues = [];

  function commitArray() {
    if (!arrayKey) return;
    config[section] ||= {};
    config[section][arrayKey] = arrayValues;
    arrayKey = "";
    arrayValues = [];
  }

  // Returns the array-of-tables entry we're currently populating, if any.
  function activeArrayEntry() {
    if (!section || !section.includes(".")) return null;
    const parentSection = section.replace(/\.[^.]+$/, "");
    const arrayName = section.split(".").pop();
    const list = config[parentSection]?.[arrayName];
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[list.length - 1];
  }

  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Handle array value lines (when we're inside a [ ... ] block)
    if (arrayKey) {
      if (trimmed === "]" || trimmed.startsWith("]")) {
        commitArray();
        continue;
      }
      arrayValues.push(parseTomlScalar(trimmed));
      continue;
    }

    // Also handle values for an array-of-tables entry's nested array
    const entry = activeArrayEntry();
    if (entry?.__arrayKey) {
      if (trimmed === "]" || trimmed.startsWith("]")) {
        entry[entry.__arrayKey] = entry.__arrayValues;
        delete entry.__arrayKey;
        delete entry.__arrayValues;
        continue;
      }
      entry.__arrayValues.push(parseTomlScalar(trimmed));
      continue;
    }

    // Array of tables: [[section]] or [[section.sub]]
    const arrayTableMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTableMatch) {
      commitArray();
      section = arrayTableMatch[1].trim();
      const parentSection = section.replace(/\.[^.]+$/, "");
      const arrayName = section.split(".").pop();
      config[parentSection] ||= {};
      config[parentSection][arrayName] ||= [];
      config[parentSection][arrayName].push({});
      continue;
    }

    // Regular [section]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      commitArray();
      section = sectionMatch[1].trim();
      continue;
    }

    // Key = value
    const entryMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!entryMatch || !section) continue;
    const [, key, rawValue] = entryMatch;

    // Populating an array-of-tables entry
    if (entry) {
      if (rawValue.trim() === "[") {
        entry.__arrayKey = key;
        entry.__arrayValues = [];
      } else {
        entry[key] = parseTomlScalar(rawValue);
      }
      continue;
    }

    // Regular key in a [section]
    config[section] ||= {};
    if (rawValue.trim() === "[") {
      arrayKey = key;
      arrayValues = [];
    } else {
      config[section][key] = parseTomlScalar(rawValue);
    }
  }

  commitArray();

  // Finalize any remaining __arrayKey in array-of-tables entries
  for (const [, sectionValue] of Object.entries(config)) {
    if (!sectionValue || typeof sectionValue !== "object") continue;
    for (const [, value] of Object.entries(sectionValue)) {
      if (!Array.isArray(value)) continue;
      for (const e of value) {
        if (!e || typeof e !== "object") continue;
        if (e.__arrayKey && e.__arrayValues) {
          e[e.__arrayKey] = e.__arrayValues;
          delete e.__arrayKey;
          delete e.__arrayValues;
        }
      }
    }
  }

  return config;
}

async function buildConfigRuntimePayload() {
  const configPath = resolve("../files/config.custom.toml");
  try {
    const config = parseRuntimeToml(await readFile(configPath, "utf8"));
    const api = config.api || {};
    const rtc = config.rtc || {};
    const publicDomain = String(api.publicDomain || "").trim();
    const serverOrigin = publicDomain ? httpOrigin(publicDomain) : "";
    const apiBaseUrl = serverOrigin;
    const wsUrl = apiBaseUrl ? webSocketUrlFromOrigin(apiBaseUrl) : "";

    // Legacy flat fields
    const turnUrls = Array.isArray(rtc.turnUrls) ? rtc.turnUrls.map(String).filter(Boolean) : [];
    const turnUsername = String(rtc.turnUsername || "").trim();
    const turnCredential = String(rtc.turnCredential || "").trim();
    const relayOnly = typeof rtc.relayOnly === "boolean" ? rtc.relayOnly : undefined;
    const defaultTurnServer = String(rtc.defaultTurnServer || "").trim();

    // New [[rtc.servers]] array-of-tables
    const rawServers = Array.isArray(rtc.servers) ? rtc.servers : [];
    const servers = rawServers
      .filter((s) => s && Array.isArray(s.turnUrls) && s.turnUrls.length > 0)
      .map((s) => ({
        id: String(s.id || "").trim(),
        label: String(s.label || s.id || "").trim(),
        hint: String(s.hint || "").trim(),
        urls: s.turnUrls.map(String).filter(Boolean),
        username: String(s.turnUsername || "").trim(),
        credential: String(s.turnCredential || "").trim()
      }));

    const hasRtc = turnUrls.length || turnUsername || turnCredential || relayOnly !== undefined || servers.length > 0;
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
              ...(turnUsername ? { turnUsername } : {}),
              ...(turnCredential ? { turnCredential } : {}),
              ...(servers.length ? { servers } : {}),
              ...(defaultTurnServer ? { defaultTurnServer } : {}),
              callsEnabled: true,
              callsUnavailableReason: ""
            }
          }
        : {})
    };
  } catch {
    return null;
  }
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

function emptySummaryPayload() {
  return {
    serverOrigin: "",
    apiBaseUrl: "",
    wsUrl: "",
    rtc: {}
  };
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

async function buildOutputScript() {
  await loadDotEnvFiles();

  const configUrl = argValue("--url") || firstEnv("QXP_RUNTIME_CONFIG_URL");
  const envPayload = buildEnvRuntimePayload();
  const configPayload = await buildConfigRuntimePayload();

  // Merge: env vars override TOML on a per-field basis.
  // RTC fields from env take priority; TOML fills in the rest.
  function mergePayloads(base, override) {
    if (!base && !override) return null;
    if (!base) return override;
    if (!override) return base;
    return {
      ...base,
      ...override,
      rtc: {
        ...(base.rtc || {}),
        ...(override.rtc || {})
      }
    };
  }

  if (configUrl) {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`Could not fetch ${configUrl}: HTTP ${response.status}`);
    }

    const htmlPayload = extractRuntimeConfigFromHtml(await response.text());
    const runtimeConfig = await fetchRuntimeConfigScript(configUrl, htmlPayload);
    const merged = mergePayloads(mergePayloads(runtimeConfig, configPayload), envPayload);

    return {
      outputScript: runtimeScript(merged),
      summaryPayload: merged,
      configSource: configUrl,
      rtcStatus: merged.rtc?.callsEnabled ? "enabled" : "disabled"
    };
  }

  const merged = mergePayloads(configPayload, envPayload);
  if (merged) {
    const hasApp = merged.serverOrigin || merged.apiBaseUrl || merged.wsUrl;
    const hasRtc = merged.rtc && (merged.rtc.turnUrls?.length || merged.rtc.servers?.length || merged.rtc.turnUsername);
    return {
      outputScript: runtimeScript(merged),
      summaryPayload: merged,
      configSource: hasRtc && configPayload?.rtc?.servers?.length ? "files/config.custom.toml" : "environment",
      rtcStatus: merged.rtc?.callsEnabled ? "enabled" : merged.rtc ? "disabled" : "unknown"
    };
  }

  const localRuntimePath = resolve("public/runtime-config.js");
  return {
    outputScript: await readFile(localRuntimePath, "utf8"),
    summaryPayload: emptySummaryPayload(),
    configSource: localRuntimePath,
    rtcStatus: "unknown"
  };
}

async function syncRuntimeConfig() {
  if (syncing) return;
  syncing = true;

  try {
    const outputPath = resolve(argValue("--out") || "dist/runtime-config.js");
    const { outputScript, summaryPayload, configSource, rtcStatus } = await buildOutputScript();

    if (outputScript !== lastOutputScript) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, outputScript, "utf8");
      lastOutputScript = outputScript;
    }

    const summary = {
      configSource,
      outputPath,
      serverOrigin: summaryPayload.serverOrigin || "",
      apiBaseUrl: summaryPayload.apiBaseUrl || "",
      wsUrl: summaryPayload.wsUrl || "",
      rtc: {
        relayOnly: summaryPayload.rtc?.relayOnly,
        turnUrlsCount: Array.isArray(summaryPayload.rtc?.turnUrls) ? summaryPayload.rtc.turnUrls.length : 0,
        turnServersCount: Array.isArray(summaryPayload.rtc?.servers) ? summaryPayload.rtc.servers.length : 0,
        turnUsername: summaryPayload.rtc?.turnUsername ? "***set***" : "",
        turnCredential: summaryPayload.rtc?.turnCredential ? "***set***" : "",
        callsEnabled: summaryPayload.rtc?.callsEnabled,
        callsUnavailableReason: summaryPayload.rtc?.callsUnavailableReason || ""
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
  const watchFiles = [...dotenvFiles, resolve("../files/config.custom.toml"), resolve("public/runtime-config.js"), outputPath];

  for (const filepath of watchFiles) {
    if (!existsSync(filepath)) continue;
    watch(filepath, { persistent: true }, scheduleSync);
  }

  console.log("Watching runtime config inputs.");
}
