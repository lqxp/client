function normalizedStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

interface RuntimeRtcConfig {
  relayOnly?: boolean;
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
  callsEnabled?: boolean;
  callsUnavailableReason?: string;
}

interface RuntimeConfigPayload {
  serverOrigin?: string;
  apiBaseUrl?: string;
  wsUrl?: string;
  rtc?: RuntimeRtcConfig;
}

const DEFAULT_SERVER_ORIGIN = "https://qxch.at/app";
const RUNTIME_SCRIPT_RE = /<script\b[^>]*>\s*window\.__QXP_RUNTIME__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/m;

const envServerOrigin = normalizeHttpUrl(import.meta.env.VITE_QXP_SERVER_ORIGIN);
const envApiBaseUrl = normalizeHttpUrl(import.meta.env.VITE_QXP_API_BASE_URL);
const envWsUrl = normalizeWebSocketUrl(import.meta.env.VITE_QXP_WS_URL);
const envRelayOnly = normalizeBoolean(import.meta.env.VITE_QXP_RELAY_ONLY);
const envTurnUrls = normalizeEnvStringArray(import.meta.env.VITE_QXP_TURN_URLS || import.meta.env.QXP_TURN_URLS);
const envTurnUsername = normalizeEnvString(import.meta.env.VITE_QXP_TURN_USERNAME || import.meta.env.QXP_TURN_USERNAME);
const envTurnCredential = normalizeEnvString(import.meta.env.VITE_QXP_TURN_CREDENTIAL || import.meta.env.QXP_TURN_CREDENTIAL);
const envCallsEnabled = normalizeBoolean(import.meta.env.VITE_QXP_CALLS_ENABLED);
const envCallsUnavailableReason = normalizeEnvString(import.meta.env.VITE_QXP_CALLS_UNAVAILABLE_REASON);

let runtimeInitPromise: Promise<void> | null = null;

function normalizeHttpUrl(value: unknown) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";

  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeWebSocketUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeEnvString(value: unknown) {
  return String(value || "").trim();
}

function normalizeEnvStringArray(value: unknown) {
  return normalizeEnvString(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBoolean(value: unknown) {
  const text = normalizeEnvString(value).toLowerCase();
  if (!text) return undefined;
  if (["1", "true", "yes", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(text)) return false;
  return undefined;
}

function isEmbeddedAppOrigin() {
  return window.location.protocol !== "http:" && window.location.protocol !== "https:";
}

function webSocketUrlFromHttpBase(httpBaseUrl: string) {
  try {
    const url = new URL(httpBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function joinBasePath(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

function normalizedRuntimePayload(value: unknown): RuntimeConfigPayload {
  return value && typeof value === "object" ? { ...(value as RuntimeConfigPayload) } : {};
}

function runtimeServerOrigin(runtime: RuntimeConfigPayload) {
  return isEmbeddedAppOrigin()
    ? envServerOrigin || normalizeHttpUrl(runtime.serverOrigin) || DEFAULT_SERVER_ORIGIN
    : normalizeHttpUrl(runtime.serverOrigin) || envServerOrigin || normalizeHttpUrl(window.location.origin);
}

function buildRuntimeConfig(runtime: RuntimeConfigPayload) {
  const rawRtc = runtime.rtc || {};
  const serverOrigin = runtimeServerOrigin(runtime);
  const apiBaseUrl = envApiBaseUrl
    || normalizeHttpUrl(runtime.apiBaseUrl)
    || serverOrigin;
  const wsUrl = envWsUrl
    || normalizeWebSocketUrl(runtime.wsUrl)
    || webSocketUrlFromHttpBase(apiBaseUrl);

  return {
    app: {
      serverOrigin,
      apiBaseUrl,
      wsUrl
    },
    rtc: {
      relayOnly: envRelayOnly ?? (rawRtc.relayOnly !== false),
      turnUrls: envTurnUrls.length ? envTurnUrls : normalizedStringArray(rawRtc.turnUrls),
      turnUsername: envTurnUsername || String(rawRtc.turnUsername || "").trim(),
      turnCredential: envTurnCredential || String(rawRtc.turnCredential || "").trim(),
      callsEnabled: envCallsEnabled ?? Boolean(rawRtc.callsEnabled),
      callsUnavailableReason: envCallsUnavailableReason || String(rawRtc.callsUnavailableReason || "").trim()
    }
  };
}

function applyRuntimeConfig(runtime: RuntimeConfigPayload) {
  const normalized = buildRuntimeConfig(runtime);
  Object.assign(appRuntimeConfig, normalized.app);
  Object.assign(rtcRuntimeConfig, normalized.rtc);
  window.__QXP_RUNTIME__ = {
    ...normalizedRuntimePayload(window.__QXP_RUNTIME__),
    ...runtime,
    serverOrigin: normalized.app.serverOrigin,
    apiBaseUrl: normalized.app.apiBaseUrl,
    wsUrl: normalized.app.wsUrl,
    rtc: {
      ...(normalizedRuntimePayload(window.__QXP_RUNTIME__)?.rtc || {}),
      ...(runtime.rtc || {}),
      ...normalized.rtc
    }
  };
}

function extractRuntimeConfigFromHtml(html: string) {
  const match = String(html || "").match(RUNTIME_SCRIPT_RE);
  if (!match) return null;
  try {
    return normalizedRuntimePayload(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

async function fetchEmbeddedRuntimeConfig(serverOrigin: string) {
  try {
    const response = await fetch(serverOrigin, { cache: "no-store" });
    if (!response.ok) return null;
    return extractRuntimeConfigFromHtml(await response.text());
  } catch {
    return null;
  }
}

const initialRuntime = normalizedRuntimePayload(window.__QXP_RUNTIME__);
const initialConfig = buildRuntimeConfig(initialRuntime);

export const rtcRuntimeConfig = { ...initialConfig.rtc };

export const appRuntimeConfig = { ...initialConfig.app };

export async function initializeRuntimeConfig() {
  if (runtimeInitPromise) return runtimeInitPromise;

  runtimeInitPromise = (async () => {
    const injectedRuntime = normalizedRuntimePayload(window.__QXP_RUNTIME__);
    applyRuntimeConfig(injectedRuntime);
    if (!isEmbeddedAppOrigin()) return;

    const fetchedRuntime = await fetchEmbeddedRuntimeConfig(appRuntimeConfig.serverOrigin);
    if (!fetchedRuntime) return;

    applyRuntimeConfig({
      ...fetchedRuntime,
      ...injectedRuntime,
      rtc: {
        ...(fetchedRuntime.rtc || {}),
        ...(injectedRuntime.rtc || {})
      }
    });
  })();

  return runtimeInitPromise;
}

export function apiUrl(path: string) {
  return joinBasePath(appRuntimeConfig.apiBaseUrl, path);
}
