import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Shared runtime-config generation used by both the CLI (sync-runtime-config.mjs)
// and the Vite dev plugin. Kept free of process.argv so it can be imported safely.

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

    if (arrayKey) {
      if (trimmed === "]" || trimmed.startsWith("]")) {
        commitArray();
        continue;
      }
      arrayValues.push(parseTomlScalar(trimmed));
      continue;
    }

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

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      commitArray();
      section = sectionMatch[1].trim();
      continue;
    }

    const entryMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!entryMatch || !section) continue;
    const [, key, rawValue] = entryMatch;

    if (entry) {
      if (rawValue.trim() === "[") {
        entry.__arrayKey = key;
        entry.__arrayValues = [];
      } else {
        entry[key] = parseTomlScalar(rawValue);
      }
      continue;
    }

    config[section] ||= {};
    if (rawValue.trim() === "[") {
      arrayKey = key;
      arrayValues = [];
    } else {
      config[section][key] = parseTomlScalar(rawValue);
    }
  }

  commitArray();

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

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
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

    const turnUrls = Array.isArray(rtc.turnUrls) ? rtc.turnUrls.map(String).filter(Boolean) : [];
    const turnUsername = String(rtc.turnUsername || "").trim();
    const turnCredential = String(rtc.turnCredential || "").trim();
    const relayOnly = typeof rtc.relayOnly === "boolean" ? rtc.relayOnly : undefined;
    const defaultTurnServer = String(rtc.defaultTurnServer || "").trim();

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

async function buildEnvRuntimePayload() {
  const serverOriginRaw = firstEnv("QXP_SERVER_ORIGIN", "VITE_QXP_SERVER_ORIGIN");
  const apiBaseUrlRaw = firstEnv("QXP_API_BASE_URL", "VITE_QXP_API_BASE_URL");
  const wsUrlRaw = firstEnv("QXP_WS_URL", "VITE_QXP_WS_URL");
  const turnUrlsRaw = firstEnv("QXP_TURN_URLS", "VITE_QXP_TURN_URLS");
  const turnUsernameRaw = firstEnv("QXP_TURN_USERNAME", "VITE_QXP_TURN_USERNAME");
  const turnCredentialRaw = firstEnv("QXP_TURN_CREDENTIAL", "VITE_QXP_TURN_CREDENTIAL");
  const relayOnlyRaw = firstEnv("QXP_RELAY_ONLY", "VITE_QXP_RELAY_ONLY");
  const callsEnabledRaw = firstEnv("QXP_CALLS_ENABLED", "VITE_QXP_CALLS_ENABLED");
  const callsUnavailableReasonRaw = firstEnv("QXP_CALLS_UNAVAILABLE_REASON", "VITE_QXP_CALLS_UNAVAILABLE_REASON");

  const serverOrigin = serverOriginRaw ? httpOrigin(serverOriginRaw) : "";
  const apiBaseUrl = apiBaseUrlRaw ? httpOrigin(apiBaseUrlRaw) : (serverOrigin || "");
  const wsUrl = wsUrlRaw ? (() => {
    const url = new URL(wsUrlRaw);
    return url.toString();
  })() : (apiBaseUrl ? webSocketUrlFromOrigin(apiBaseUrl) : "");
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

export async function buildRuntimeScript() {
  const configPayload = await buildConfigRuntimePayload();
  const envPayload = await buildEnvRuntimePayload();
  const merged = mergePayloads(configPayload, envPayload);
  if (merged) {
    return `// Generated runtime config. Do not edit by hand.\nwindow.__QXP_RUNTIME__ = ${JSON.stringify(merged)};\n`;
  }

  // Fallback: serve the static placeholder so the app still boots.
  try {
    return await readFile(resolve("public/runtime-config.js"), "utf8");
  } catch {
    return `window.__QXP_RUNTIME__ = {};\n`;
  }
}
