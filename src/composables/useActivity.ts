// QxChat-native rich activity ("Playing X") broadcast.
//
// Detection runs locally (Tauri `activity` plugin on desktop, call state
// everywhere) and the result is published inside our own profile, exactly
// like the custom status — so every client renders it without touching
// Discord. This channel is fully independent from the outbound Discord Rich
// Presence (`discord-rpc` plugin): both run at the same time, neither can
// disable the other.
//
// Privacy: nothing is broadcast while invisible, locked, logged out, in
// streamer mode, or when the user toggles sharing off (which clears the
// activity everywhere via an explicit null).

import { reactive, watch } from "vue";
import {
  fetchDetectableList,
  getDetectedActivity,
  isTauriDesktopRuntime,
  pushDetectableList,
  type UserActivity,
} from "@/calls/activity";
import { sameActivity } from "@/utils/activity";
import type { Messenger } from "./useMessenger";

const SHARING_STORAGE_KEY = "lqxp:activity-sharing";
const POLL_MS = 30_000;

export type Activity = ReturnType<typeof useActivity>;

function readSharing(): boolean {
  try {
    const raw = localStorage.getItem(SHARING_STORAGE_KEY);
    if (raw == null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

function activityDebug(...args: unknown[]) {
  try {
    if (localStorage.getItem("lqxp:activity-debug") === "1") {
      console.debug("[qxchat-activity]", ...args);
    }
  } catch {
    /* storage unavailable */
  }
}

export function useActivity(messenger: Messenger) {
  const state = reactive({
    sharingEnabled: readSharing(),
    /** Last detected/broadcast activity (settings preview). */
    current: null as UserActivity | null,
  });

  const desktop = isTauriDesktopRuntime();
  let timer: ReturnType<typeof setInterval> | null = null;
  let callStartedAt = 0;
  // `undefined` = never pushed: forces the first tick to converge the wire
  // state (including clearing a stale activity restored from storage).
  let lastPushed: UserActivity | null | undefined = undefined;

  function readCallActivity(): UserActivity | null {
    if (!messenger.state.inCall) return null;
    const room = String(messenger.state.callRoom || "").trim();
    const name = room ? String(messenger.displayRoomName?.(room) || room) : "Voice call";
    return { kind: "call", name: name || "Voice call", startedAt: callStartedAt || Date.now() };
  }

  async function tick() {
    try {
      const identified = Boolean(messenger.state.identified && String(messenger.state.authToken || "").trim());
      const locked = Boolean(messenger.state.clientLockLocked);
      if (!identified || locked) {
        activityDebug("skip: not broadcastable", { identified, locked });
        return;
      }
      const invisible = String(messenger.state.status || "") === "invisible";
      const streamer = Boolean(messenger.state.streamerMode);
      activityDebug("tick", {
        sharing: state.sharingEnabled,
        invisible,
        streamer,
        status: String(messenger.state.status || ""),
        desktop,
      });
      let next: UserActivity | null = null;
      if (state.sharingEnabled && !invisible && !streamer) {
        next = readCallActivity();
        if (!next && desktop) {
          try {
            next = await getDetectedActivity();
          } catch {
            next = null;
          }
        }
      }
      activityDebug("detected", next);
      state.current = next;
      if (sameActivity(lastPushed ?? null, next) && lastPushed !== undefined) {
        activityDebug("unchanged, skip push");
        return;
      }
      lastPushed = next;
      activityDebug("push", next);
      messenger.setProfileActivity?.(next);
    } catch {
      /* detection must never break the app */
    }
  }

  function setSharing(enabled: boolean) {
    state.sharingEnabled = Boolean(enabled);
    try {
      localStorage.setItem(SHARING_STORAGE_KEY, state.sharingEnabled ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    void tick();
  }

  watch(
    () => messenger.state.inCall,
    (inCall) => {
      if (inCall) callStartedAt = Date.now();
      void tick();
    },
  );
  watch(
    () => [messenger.state.identified, messenger.state.status, messenger.state.streamerMode],
    () => {
      void tick();
    },
  );

  // The detectable game list is served by our own server (which compacts the
  // official Discord feed, via our own server — never fetched directly. Pushed once
  // into the local plugin; the built-in table covers offline gaps.
  if (desktop) {
    void (async () => {
      try {
        const list = await fetchDetectableList();
        if (list) await pushDetectableList(list);
      } catch {
        /* offline: built-in table applies */
      }
    })();
  }

  if (!timer) {
    timer = setInterval(() => {
      void tick();
    }, POLL_MS);
    void tick();
  }

  return { state, setSharing, refresh: tick };
}
