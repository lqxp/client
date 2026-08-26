// Tor relay directory for the settings UI.
//
// Fetches live relay data from Tor Metrics' Onionoo API (the *official* Tor
// relay directory), which documents every relay with its addresses, country,
// AS/AS-name (data center, association, ISP, …), flags and fingerprint.
//
// The "details" link points to Relay Search (Tor Metrics), the official page
// that documents each relay in depth.

export interface TorRelay {
  fingerprint: string;
  nickname: string;
  /** First IPv4/IPv6 address with port. */
  address: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** Human-readable country name. */
  countryName: string;
  /** Autonomous System number (e.g. "AS24940"). */
  asNumber: string;
  /** Autonomous System name (data center / association / ISP). */
  asName: string;
  /** Relay flags (e.g. "Guard", "Exit", "Fast", "Stable"). */
  flags: string[];
  /** Whether the relay was running at time of the query. */
  running: boolean;
  /** Contact line published by the operator (often an association/organization). */
  contact: string;
  /** Consensus weight fraction (0–1). */
  consensusWeightFraction: number;
}

/** The Rust backend returns these fields (serde camelCase). */
interface BackendRelay {
  fingerprint: string;
  nickname: string;
  address: string;
  country: string;
  countryName: string;
  asNumber: string;
  asName: string;
  flags: string[];
  running: boolean;
  contact: string;
  consensusWeightFraction: number;
}

const ONIONOO_DETAILS = "https://onionoo.torproject.org/details";

function firstAddress(orAddresses: string[] | undefined): string {
  const list = Array.isArray(orAddresses) ? orAddresses : [];
  const v4 = list.find((a) => /\d+\.\d+\.\d+\.\d+/.test(a));
  const v6 = list.find((a) => a.includes(":"));
  return v4 || v6 || "";
}

/** Maps Onionoo relay documents into the UI shape (and drops non-relays). */
export function mapRelay(raw: any): TorRelay {
  return {
    fingerprint: String(raw.fingerprint || ""),
    nickname: String(raw.nickname || "Unnamed"),
    address: firstAddress(raw.or_addresses),
    country: String(raw.country || ""),
    countryName: String(raw.country_name || ""),
    asNumber: String(raw.as || ""),
    asName: String(raw.as_name || ""),
    flags: Array.isArray(raw.flags) ? raw.flags : [],
    running: Boolean(raw.running),
    contact: String(raw.contact || ""),
    consensusWeightFraction:
      typeof raw.consensus_weight_fraction === "number"
        ? raw.consensus_weight_fraction
        : 0,
  };
}

function normalizeBackendRelay(r: BackendRelay): TorRelay {
  return {
    fingerprint: String(r.fingerprint || ""),
    nickname: String(r.nickname || "Unnamed"),
    address: String(r.address || ""),
    country: String(r.country || ""),
    countryName: String(r.countryName || ""),
    asNumber: String(r.asNumber || ""),
    asName: String(r.asName || ""),
    flags: Array.isArray(r.flags) ? r.flags : [],
    running: Boolean(r.running),
    contact: String(r.contact || ""),
    consensusWeightFraction: Number(r.consensusWeightFraction) || 0,
  };
}

/** Returns the official Relay Search detail URL for a fingerprint. */
export function relayDetailUrl(fingerprint: string): string {
  return `https://metrics.torproject.org/rs.html#details/${encodeURIComponent(
    fingerprint,
  )}`;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

/**
 * Loads currently-running relays.
 *
 * On the desktop Tauri build this prefers the Rust plugin
 * (`plugin:tor|relays`), which tunnels the Onionoo request through the local
 * Tor SOCKS5 proxy (no DNS leak). If Tor isn't running it falls back to a
 * direct fetch of the public Onionoo API, so the relay directory is still
 * browseable regardless of Tor state.
 */
export async function fetchTorRelays(
  limit = 100,
  signal?: AbortSignal,
): Promise<TorRelay[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const relays = await invoke<BackendRelay[]>("plugin:tor|relays", { limit });
      return relays.map(normalizeBackendRelay).filter((r) => r.fingerprint);
    } catch {
      // Tor not running (or relay fetch unavailable) → direct Onionoo fetch.
    }
  }

  return fetchTorRelaysDirect(limit, signal);
}

async function fetchTorRelaysDirect(
  limit: number,
  signal?: AbortSignal,
): Promise<TorRelay[]> {
  const url = `${ONIONOO_DETAILS}?fields=fingerprint,nickname,or_addresses,country,country_name,as,as_name,flags,running,contact,consensus_weight_fraction&running=true&order=-consensus_weight&limit=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const finalSignal = signal ?? controller.signal;

  try {
    const res = await fetch(url, { signal: finalSignal, cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Onionoo HTTP ${res.status}`);
    }
    const data = await res.json();
    const relays = Array.isArray(data?.relays) ? data.relays : [];
    return relays.map(mapRelay).filter((r) => r.fingerprint);
  } finally {
    clearTimeout(timer);
  }
}
