window.__QXP_RUNTIME__ = {
  ...(window.__QXP_RUNTIME__ || {}),
  serverOrigin: window.__QXP_RUNTIME__?.serverOrigin || "https://qxch.at/app",
  apiBaseUrl: window.__QXP_RUNTIME__?.apiBaseUrl || "https://qxch.at",
  wsUrl: window.__QXP_RUNTIME__?.wsUrl || "wss://qxch.at/ws",
  rtc: {
    ...(window.__QXP_RUNTIME__?.rtc || {})
  }
};
