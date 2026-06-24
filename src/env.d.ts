/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QXP_SERVER_ORIGIN?: string;
  readonly VITE_QXP_API_BASE_URL?: string;
  readonly VITE_QXP_WS_URL?: string;
  readonly VITE_QXP_RELAY_ONLY?: string;
  readonly VITE_QXP_TURN_URLS?: string;
  readonly VITE_QXP_TURN_USERNAME?: string;
  readonly VITE_QXP_TURN_CREDENTIAL?: string;
  readonly VITE_QXP_CALLS_ENABLED?: string;
  readonly VITE_QXP_CALLS_UNAVAILABLE_REASON?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  const __APP_VERSION__: string;
}

interface QxpRtcRuntimeConfig {
  relayOnly?: boolean;
  turnUrls?: string[];
  turnUsername?: string;
  turnCredential?: string;
  callsEnabled?: boolean;
  callsUnavailableReason?: string;
}

interface QxpRuntimeConfig {
  serverOrigin?: string;
  apiBaseUrl?: string;
  wsUrl?: string;
  rtc?: QxpRtcRuntimeConfig;
}

declare global {
  interface Window {
    __QXP_RUNTIME__?: QxpRuntimeConfig;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

export {};
