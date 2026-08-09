// Fallback runtime config — used when no TOML or env vars are available.
// The real config is injected at build time by scripts/sync-runtime-config.mjs
// from files/config.custom.toml and/or environment variables.
window.__QXP_RUNTIME__ = {
  ...(window.__QXP_RUNTIME__ || {}),
  serverOrigin: window.__QXP_RUNTIME__?.serverOrigin || "https://qxch.at",
  apiBaseUrl: window.__QXP_RUNTIME__?.apiBaseUrl || "https://qxch.at",
  wsUrl: window.__QXP_RUNTIME__?.wsUrl || "wss://qxch.at/ws",
  rtc: {
    ...(window.__QXP_RUNTIME__?.rtc || {}),
    relayOnly: window.__QXP_RUNTIME__?.rtc?.relayOnly ?? true,
    servers: window.__QXP_RUNTIME__?.rtc?.servers || window.__QXP_RUNTIME__?.rtc?.turnServers || [],
    defaultTurnServer: window.__QXP_RUNTIME__?.rtc?.defaultTurnServer || "",
    callsEnabled: window.__QXP_RUNTIME__?.rtc?.callsEnabled ?? true,
    callsUnavailableReason: window.__QXP_RUNTIME__?.rtc?.callsUnavailableReason || ""
  }
};
