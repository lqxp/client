window.__QXP_RUNTIME__ = {
  ...(window.__QXP_RUNTIME__ || {}),
  serverOrigin: window.__QXP_RUNTIME__?.serverOrigin || "https://qxch.at",
  apiBaseUrl: window.__QXP_RUNTIME__?.apiBaseUrl || "https://qxch.at",
  wsUrl: window.__QXP_RUNTIME__?.wsUrl || "wss://qxch.at/ws",
  rtc: {
    ...(window.__QXP_RUNTIME__?.rtc || {}),
    relayOnly: window.__QXP_RUNTIME__?.rtc?.relayOnly ?? true,
    turnUrls: window.__QXP_RUNTIME__?.rtc?.turnUrls?.length ? window.__QXP_RUNTIME__.rtc.turnUrls : [
      "turn:turn.qxp.kisakay.com:3478?transport=udp",
      "turn:turn.qxp.kisakay.com:3478?transport=tcp",
      "turns:turn.qxp.kisakay.com:5349?transport=tcp"
    ],
    turnUsername: window.__QXP_RUNTIME__?.rtc?.turnUsername || "qxp-turn",
    turnCredential: window.__QXP_RUNTIME__?.rtc?.turnCredential || "df64240e730e15fdfb75d6cff95367b95ed341bd98517544",
    callsEnabled: window.__QXP_RUNTIME__?.rtc?.callsEnabled ?? true,
    callsUnavailableReason: window.__QXP_RUNTIME__?.rtc?.callsUnavailableReason || ""
  }
};
