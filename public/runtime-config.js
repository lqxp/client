window.__QXP_RUNTIME__ = {
  ...(window.__QXP_RUNTIME__ || {}),
  serverOrigin: window.__QXP_RUNTIME__?.serverOrigin || "https://qxch.at",
  apiBaseUrl: window.__QXP_RUNTIME__?.apiBaseUrl || "https://qxch.at",
  wsUrl: window.__QXP_RUNTIME__?.wsUrl || "wss://qxch.at/ws",
  rtc: {
    ...(window.__QXP_RUNTIME__?.rtc || {}),
    relayOnly: window.__QXP_RUNTIME__?.rtc?.relayOnly ?? true,
    turnUrls: window.__QXP_RUNTIME__?.rtc?.turnUrls?.length ? window.__QXP_RUNTIME__.rtc.turnUrls : [
      "turn:relay-01.qxch.at:3478?transport=udp",
      "turn:relay-01.qxch.at:3478?transport=tcp",
      "turns:relay-01.qxch.at:5349?transport=tcp"
    ],
    turnUsername: window.__QXP_RUNTIME__?.rtc?.turnUsername || "qxp-turn",
    turnCredential: window.__QXP_RUNTIME__?.rtc?.turnCredential || "ee74bf0f9bf21e74d98f2d85176c9b5cb85ffde977ec80e8",
    callsEnabled: window.__QXP_RUNTIME__?.rtc?.callsEnabled ?? true,
    callsUnavailableReason: window.__QXP_RUNTIME__?.rtc?.callsUnavailableReason || ""
  }
};
