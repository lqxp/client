<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import AdminSettings from "@/components/AdminSettings.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import BadgeIcon from "@/components/BadgeIcon.vue";
import { badgeLabel as badgeLabelFor } from "@/config/badges";
import { useI18n, LOCALE_LABELS } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import { useUpdater } from "@/composables/useUpdater";
import { appRuntimeConfig, turnServerList } from "@/config/runtime";
import { onTorStatus, getCircuit, getGeo, getGeoIp, torStatus as fetchTorStatus, isTauriDesktopRuntime as isTorRuntime, type CircuitPath, type GeoInfo, type TorStatus } from "@/calls/tor";
import { getDiscordRpcStatus, setDiscordRpcEnabled, setDiscordRpcShowPlatform, type DiscordRpcStatus } from "@/calls/discordRpc";
import { fetchTorRelays, relayDetailUrl, type TorRelay } from "@/calls/torRelays";
import { countryCoord } from "@/calls/geo";
import WorldMap, { type MapPoint } from "@/components/WorldMap.vue";
import ImageCropModal from "@/components/ImageCropModal.vue";
import { isAnimatedImage } from "@/utils/animatedImage";

const i18n = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const { t, locale, availableLocales } = i18n;
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;
const phantom = inject<any>("phantom");
const { isTauri, triggerCheckUpdatesEvent } = useUpdater();

const props = defineProps({
  messenger: { type: Object, required: true },
  initialSection: { type: String, default: "profile" }
});

const draftName = ref(props.messenger.state.username || "");
const draftDescription = ref(props.messenger.state.profile?.description || "");
const draftPronouns = ref(props.messenger.state.profile?.pronouns || "");
const fileInputRef = ref(null);
const recoveryFileInputRef = ref(null);
const avatarInputRef = ref(null);
const bannerInputRef = ref(null);
const firstInputRef = ref(null);
const cameraPreviewRef = ref<HTMLVideoElement | null>(null);
const crop = ref<{ open: boolean; src: string; kind: "avatar" | "banner"; mimeType: string } | null>(null);
const activeSection = ref("profile");
const mobileSectionOpen = ref(false);
const settingsSearch = ref("");
const isMobileSettings = ref(false);
const lockPin = ref("");
const lockPinConfirm = ref("");
const duressPin = ref("");
const duressPinConfirm = ref("");
const lockPinLength = computed(() => Number(props.messenger.state.clientLockPinLength) || 6);
const lockPinPlaceholder = computed(() => "•".repeat(lockPinLength.value));
const lockPinLabel = computed(() => t('settings.security.pinDigits', { count: String(lockPinLength.value) }));
const autolockOptions = computed(() => props.messenger.clientLockAutolockTimeoutsMs || []);

// Phantom : signature du client via les recovery words.
const recoveryWordsInput = ref("");
const recoverySigned = computed(
  () =>
    Array.isArray(props.messenger.state.recoveryWords) &&
    props.messenger.state.recoveryWords.length === 12,
);
function importRecoveryWords() {
  if (props.messenger.setRecoveryWords?.(recoveryWordsInput.value)) {
    recoveryWordsInput.value = "";
    // Les recovery words déchiffrent le roster amis : on le recharge et on
    // relance un poll pour re-matérialiser amis/pending sans F5.
    phantom?.loadRoster?.().catch(() => {});
    phantom?.pollNow?.().catch(() => {});
  }
}

const donationAddresses = [
  { id: "usdc", network: "USDC (Solana)", address: "0x6D71F6134b2F338f66B603D4F92e2D22628892Dd" },
  { id: "sol", network: "SOL", address: "EkcWgkFjUhCL37UWtG1PAhb7opA4yFXV9q5GQ8HjzVW2" },
  { id: "btc", network: "BTC", address: "bc1qqfce3vm6rdsdlmxcqp5xm2ktga3dr73m5wa8de" },
  { id: "eth", network: "ETH", address: "0x6D71F6134b2F338f66B603D4F92e2D22628892Dd" },
  { id: "ltc", network: "LTC", address: "LWNmM8YVQzTZKNmHZsK7Fr3eYUyXrntrJw" }
];

async function copyDonationAddress(address: string) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = address;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    } catch {
      copied = false;
    }
  }

  if (copied) {
    props.messenger.showToast?.(t("settings.donation.copied"));
  }
}

const githubRepos = [
  { slug: "app", url: "https://github.com/lqxp/app", licenseBadge: "https://img.shields.io/github/license/lqxp/app" },
  { slug: "lqxp", url: "https://github.com/lqxp/lqxp", licenseBadge: "https://img.shields.io/github/license/lqxp/lqxp" },
  { slug: "client", url: "https://github.com/lqxp/client", licenseBadge: "https://img.shields.io/github/license/lqxp/client" }
];

const badgesLoaded = ref(false);

interface GithubContributor {
  login: string;
  html_url: string;
  avatar_url: string;
  contributions: number;
}

const contributorsLoading = ref(false);
const contributorsError = ref(false);
const topContributors = ref<GithubContributor[]>([]);

async function loadContributors() {
  if (contributorsLoading.value || topContributors.value.length) return;
  contributorsLoading.value = true;
  contributorsError.value = false;
  try {
    const totals = new Map<string, GithubContributor>();
    const results = await Promise.allSettled(
      githubRepos.map((repo) =>
        fetch(`https://api.github.com/repos/lqxp/${repo.slug}/contributors?per_page=100&anon=0`, {
          headers: { Accept: "application/vnd.github+json" }
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
      )
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const list = Array.isArray(result.value) ? result.value : [];
      for (const item of list) {
        const login = String(item?.login || "");
        if (!login || /\[bot\]$/i.test(login)) continue;
        const prev = totals.get(login) || {
          login,
          html_url: "",
          avatar_url: "",
          contributions: 0
        };
        prev.html_url = prev.html_url || String(item?.html_url || "");
        prev.avatar_url = prev.avatar_url || String(item?.avatar_url || "");
        prev.contributions += Number(item?.contributions || 0);
        totals.set(login, prev);
      }
    }

    topContributors.value = Array.from(totals.values())
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 3);

    if (!topContributors.value.length) contributorsError.value = true;
  } catch {
    contributorsError.value = true;
  } finally {
    contributorsLoading.value = false;
  }
}

async function requestContributors() {
  const confirmed = await dialog.showConfirm(
    t('settings.about.contributorsConfirm'),
    t('settings.about.topContributors'),
  );
  if (confirmed) loadContributors();
}

async function requestBadges() {
  const confirmed = await dialog.showConfirm(
    t('settings.about.badgesConfirm'),
    t('settings.about.licenses'),
  );
  if (confirmed) badgesLoaded.value = true;
}

const contributorRoles: Record<string, string> = {
  kisakay: "Creator And Maintainer",
  sqlu: "Co-Creator and Commitor"
};

function contributorRole(login: string): string {
  return contributorRoles[String(login || "").toLowerCase()] || "";
}

// Custom TURN server form state
const showAddTurn = ref(false);
const newTurnLabel = ref("");
const newTurnUrls = ref("");
const newTurnUsername = ref("");
const newTurnCredential = ref("");
const turnServerError = ref("");

// Tor connectivity (desktop only).
const torStatus = ref<TorStatus | null>(null);
const torError = ref("");
let unsubTorStatus: (() => void) | null = null;

// Discord Rich Presence (desktop only, driven by the Rust backend).
const discordRpcEnabled = ref(true);
const discordRpcShowPlatform = ref(true);
const discordRpcConnected = ref(false);
const discordRpcReady = ref(false);

async function loadDiscordRpc() {
  if (!isTorRuntime()) return;
  try {
    const s: DiscordRpcStatus = await getDiscordRpcStatus();
    discordRpcEnabled.value = s.enabled;
    discordRpcShowPlatform.value = s.show_platform;
    discordRpcConnected.value = s.connected;
    discordRpcReady.value = true;
  } catch {
    discordRpcReady.value = false;
  }
}

async function toggleDiscordRpcEnabled(enabled: boolean) {
  if (!isTorRuntime()) return;
  try {
    const s = await setDiscordRpcEnabled(enabled);
    discordRpcEnabled.value = s.enabled;
    await loadDiscordRpc();
  } catch {
    await loadDiscordRpc();
  }
}

async function toggleDiscordRpcShowPlatform(showPlatform: boolean) {
  if (!isTorRuntime()) return;
  try {
    const s = await setDiscordRpcShowPlatform(showPlatform);
    discordRpcShowPlatform.value = s.show_platform;
    await loadDiscordRpc();
  } catch {
    await loadDiscordRpc();
  }
}

/** Converts an ISO 3166-1 alpha-2 code to a regional-indicator flag emoji. */
function countryFlag(code: string): string {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🏳️";
  const offset = 0x1f1e6;
  return String.fromCodePoint(...[...c].map((ch) => offset + ch.charCodeAt(0) - 65));
}

function relayFlagLabel(flag: string): string {
  const key = `settings.tor.flags.${flag}`;
  const label = t(key);
  return label === key ? flag : label;
}

/**
 * Returns the full human-readable country name for an ISO 3166-1 alpha-2 code,
 * always in English (independent of the current UI locale, as requested). Uses
 * the native `Intl.DisplayNames` API so there's no bundle-heavy lookup table.
 */
function countryNameEnglish(code: string | null | undefined): string {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(c) ?? "";
  } catch {
    return c;
  }
}

/**
 * Masks an IP address down to only its first number/block for the "You" circuit
 * entry, so the client's own address is effectively unreadable. IPv4 keeps only
 * the first octet (e.g. "203.0.113.xxx" → "203.x.x.x"); IPv6 keeps only the
 * first hextet group (e.g. "2606:x:x:x:x:x:x:x").
 */
function maskIpFirstBlock(ip: string | null | undefined): string {
  const s = String(ip || "").trim();
  if (!s) return "";
  if (s.includes(":")) {
    const first = s.split(":").find((p) => p.length > 0);
    return first ? `${first}:x:x:x:x:x:x:x` : "x:x:x:x:x:x:x:x";
  }
  const firstOctet = s.split(".").find((p) => /^[0-9a-fA-FxX]+$/.test(p) && p !== "xxx");
  const head = firstOctet || "x";
  return `${head}.x.x.x`;
}

// Tor relay directory.
const relays = ref<TorRelay[]>([]);
const relaysLoading = ref(false);
const relaysError = ref("");
const relaySearch = ref("");

// Live-filter the relay directory by nickname, address, AS name/number, or
// country (name or code).
const filteredRelays = computed(() => {
  const q = relaySearch.value.trim().toLowerCase();
  if (!q) return relays.value;
  return relays.value.filter((r) =>
    [
      r.nickname,
      r.address,
      r.asName,
      r.asNumber,
      r.countryName,
      r.country,
    ]
      .map((s) => String(s || "").toLowerCase())
      .some((s) => s.includes(q)),
  );
});

// Live circuit (guard → middle → exit) shown like Tor Browser.
const circuit = ref<CircuitPath | null>(null);
const circuitLoading = ref(false);

// Client + server geolocation for the map endpoints (IP masked backend-side).
const geo = ref<GeoInfo | null>(null);

// Exact coordinates + country for circuit relay IPs (resolved lazily via the
// Rust geo-IP backend); keyed by IP and used as a higher-fidelity alternative
// to the country-centroid fallback and to Arti's built-in country code.
const relayGeo = ref<Record<string, { lat: number | null; lng: number | null; countryCode: string | null }>>({});

// Circuit hops geolocated by country, plus client (origin) and server (target).
const circuitPoints = computed<MapPoint[]>(() => {
  const pts: MapPoint[] = [];

  if (geo.value?.client?.latitude != null && geo.value?.client?.longitude != null) {
    pts.push({
      lat: geo.value.client.latitude,
      lng: geo.value.client.longitude,
      color: "#3fcf6f",
      label: ["You", geo.value.client.ip].filter(Boolean).join(" · "),
    });
  }

  for (const hop of circuit.value?.hops ?? []) {
    const exact = hop.ip ? relayGeo.value[hop.ip] : undefined;
    const coord =
      exact && exact.lat != null && exact.lng != null
        ? ([exact.lat, exact.lng] as [number, number])
        : countryCoord(hopCountryCode(hop));
    if (!coord) continue;
    const [lat, lng] = coord;
    const parts = [
      hop.nickname && hop.nickname !== "Unnamed" ? hop.nickname : hop.role,
      hop.ip,
    ].filter(Boolean);
    pts.push({
      lat,
      lng,
      role: hop.role,
      label: parts.join(" · "),
    });
  }

  if (geo.value?.server?.latitude != null && geo.value?.server?.longitude != null) {
    pts.push({
      lat: geo.value.server.latitude,
      lng: geo.value.server.longitude,
      color: "#f43f5e",
      label: ["qxch.at", geo.value.server.ip].filter(Boolean).join(" · "),
    });
  }

  // The QxChat server itself is hosted in Reykjavik (IP intentionally hidden).
  pts.push({
    lat: 64.1466,
    lng: -21.9426,
    color: "#f59e0b",
    label: "Our server",
  });

  return pts;
});

async function loadGeo() {
  if (!isTorRuntime()) return;
  try {
    geo.value = await getGeo();
  } catch {
    geo.value = null;
  }
}

async function loadCircuit() {
  if (!isTorRuntime()) return;
  circuitLoading.value = true;
  try {
    circuit.value = await getCircuit();
    await loadRelayGeo(circuit.value);
  } catch {
    circuit.value = null;
  } finally {
    circuitLoading.value = false;
  }
}

async function loadRelayGeo(path: CircuitPath | null) {
  if (!path?.hops?.length) {
    relayGeo.value = {};
    return;
  }

  const entries = await Promise.all(
    path.hops.map(async (hop) => {
      if (!hop.ip) return null;
      try {
        const point = await getGeoIp(hop.ip);
        if (point) {
          return [
            hop.ip,
            {
              lat: point.latitude,
              lng: point.longitude,
              countryCode: point.countryCode ?? null,
            },
          ] as const;
        }
      } catch {
        // fall through to country centroid
      }
      return null;
    }),
  );

  const next: Record<string, { lat: number | null; lng: number | null; countryCode: string | null }> = {};
  for (const entry of entries) {
    if (entry) next[entry[0]] = entry[1];
  }
  relayGeo.value = next;
}

/** Resolved country code for a circuit hop: Tor first, then geo-IP fallback. */
function hopCountryCode(hop: CircuitPath["hops"][number]): string | null {
  return hop.country ?? (hop.ip ? relayGeo.value[hop.ip]?.countryCode ?? null : null);
}

const relaysConsent = ref(false);

async function loadRelays() {
  relaysLoading.value = true;
  relaysError.value = "";
  try {
    // fetchTorRelays falls back to a direct Onionoo fetch when Tor isn't
    // running, so the directory is always browseable.
    relays.value = await fetchTorRelays(100);
  } catch (err) {
    relaysError.value = err?.message || String(err);
  } finally {
    relaysLoading.value = false;
  }
}

async function requestRelays() {
  if (!relaysConsent.value) {
    const confirmed = await dialog.showConfirm(
      t('settings.tor.relaysConfirm'),
      t('settings.tor.relaysConfirmTitle'),
    );
    if (!confirmed) return;
    relaysConsent.value = true;
  }
  await loadRelays();
}

/** Tor is ready AND it's our embedded client (circuit view available). */
const torReady = computed(() => torStatus.value?.phase === "ready" && torStatus.value?.mode === "embedded");

/** True when a foreign Tor is being reused (transport works, no circuit view). */
const isExternalTor = computed(() => torStatus.value?.mode === "external");

let relaysAutoLoaded = false;

function maybeAutoLoadTorDirectory() {
  if (relaysAutoLoaded || relaysLoading.value || relays.value.length) return;
  if (activeSection.value !== "tor") return;
  if (!isTorRuntime() || !isOpen.value) return;
  if (!relaysConsent.value) return;
  relaysAutoLoaded = true;
  void loadRelays();
}

watch(activeSection, (section) => {
  if (section === "tor") {
    if (torReady.value) {
      loadCircuit();
      loadGeo();
    }
    maybeAutoLoadTorDirectory();
  }
});

// When Tor finishes bootstrapping and becomes ready, load the circuit and the
// relay directory automatically.
  watch(torReady, (ready) => {
    if (ready) {
      loadCircuit();
      loadGeo();
      maybeAutoLoadTorDirectory();
    }
  });

function addCustomTurnServer() {
  turnServerError.value = "";
  const urls = newTurnUrls.value
    .split(/[\s,;]+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const ok = props.messenger.addCustomTurnServer({
    label: newTurnLabel.value,
    urls,
    username: newTurnUsername.value,
    credential: newTurnCredential.value,
  });
  if (ok) {
    newTurnLabel.value = "";
    newTurnUrls.value = "";
    newTurnUsername.value = "";
    newTurnCredential.value = "";
  } else {
    turnServerError.value = t('settings.calls.turnInvalid');
  }
}

function autolockLabel(ms: number) {
  switch (Number(ms)) {
    case 60_000:
      return t('settings.security.autolockOneMinute');
    case 600_000:
      return t('settings.security.autolockTenMinutes');
    case 1_800_000:
      return t('settings.security.autolockThirtyMinutes');
    case 3_600_000:
      return t('settings.security.autolockOneHour');
    case 7_200_000:
      return t('settings.security.autolockTwoHours');
    case 18_000_000:
      return t('settings.security.autolockFiveHours');
    default:
      return `${Math.round(Number(ms) / 60000)} min`;
  }
}

watch(lockPinLength, (length) => {
  lockPin.value = lockPin.value.replace(/\D/g, "").slice(0, length);
  lockPinConfirm.value = lockPinConfirm.value.replace(/\D/g, "").slice(0, length);
});

watch(lockPin, (value) => {
  const clean = value.replace(/\D/g, "").slice(0, lockPinLength.value);
  if (clean !== value) lockPin.value = clean;
});

watch(lockPinConfirm, (value) => {
  const clean = value.replace(/\D/g, "").slice(0, lockPinLength.value);
  if (clean !== value) lockPinConfirm.value = clean;
});

const isOpen = computed(() => props.messenger.state.settingsOpen);

const nameChanged = computed(() => draftName.value.trim() !== String(props.messenger.state.username || "").trim());
const nameError = computed(() =>
  nameChanged.value ? String(props.messenger.validateUsername(draftName.value) || "") : ""
);
const nameValid = computed(() => !nameError.value);
const meAccent = computed(() => props.messenger.accentFor(props.messenger.state.username || "you"));
const meInitials = computed(() => initialsOf(props.messenger.state.username));
const profile = computed(() => props.messenger.myProfile.value);
const turnServers = computed(() => props.messenger.turnServers.value || turnServerList());
const selectedTurnInfo = computed(() => {
  const id = props.messenger.state.selectedTurnServerId;
  if (!id) return null;
  const srv = turnServers.value.find((s: TurnServerConfig) => s.id === id);
  if (!srv) return null;
  // Try i18n key first, fall back to server config hint
  const hintKey = `settings.calls.turnHints.${id}`;
  const i18nHint = t(hintKey);
  const hint = i18nHint !== hintKey ? i18nHint : (srv.hint || "");
  return {
    urls: (srv.urls || []).map((u: string) => formatTurnUrl(u)).join(" · "),
    hint
  };
});

function formatTurnUrl(url: string) {
  try {
    // turn:host:port?transport=udp  /  turns:host:port?transport=tcp  /  stun:host:port
    const m = url.match(/^(turn|turns|stun):([^:?]+)(?::(\d+))?(?:\?transport=(\w+))?$/);
    if (!m) return url;
    const [, proto, host, port, transport] = m;
    const protoLabel = proto === "turns" ? "TLS" : proto.toUpperCase();
    const addr = port ? `${host}:${port}` : host;
    const transportLabel = transport ? ` (${transport})` : "";
    return `${protoLabel} ${addr}${transportLabel}`;
  } catch {
    return url;
  }
}

function formatServerUrls(server: TurnServerConfig) {
  return (server.urls || []).map((u: string) => formatTurnUrl(u)).join(" · ");
}
const avatarSrc = computed(() => props.messenger.profileImageSrc(profile.value.avatar, "avatar"));
const bannerSrc = computed(() => props.messenger.profileImageSrc(profile.value.banner, "banner"));
const profileTextChanged = computed(() =>
  draftDescription.value.trim() !== String(profile.value.description || "").trim()
  || draftPronouns.value.trim() !== String(profile.value.pronouns || "").trim()
);

const hasUnsavedChanges = computed(() => nameChanged.value || profileTextChanged.value);
const connectionStatusLabel = computed(() => {
  if (props.messenger.state.connected && props.messenger.state.identified) {
    switch (props.messenger.state.status) {
      case "invisible":
        return t("sidebar.invisible");
      case "dnd":
        return t("sidebar.dnd");
      default:
        return t("sidebar.online");
    }
  }
  if (props.messenger.state.connected) return t("sidebar.connecting");
  return t("sidebar.offline");
});

const allSections = computed(() => [
  { id: "profile", label: t("settings.sections.profile") },
  { id: "ui", label: t("settings.sections.ui") },
  { id: "language", label: t("settings.sections.language") },
  { id: "security", label: t("settings.sections.security") },
  { id: "opsec", label: t("settings.sections.opsec") },
  { id: "notifications", label: t("settings.sections.notifications") },
  { id: "calls", label: t("settings.sections.calls") },
  { id: "tor", label: t("settings.sections.tor") },
  { id: "advanced", label: t("settings.sections.advanced") },
  { id: "phantom", label: t("settings.sections.phantom") },
  { id: "admin", label: t("settings.sections.admin") },
  { id: "backups", label: t("settings.sections.backups") },
  { id: "donation", label: t("settings.sections.donation") },
  { id: "about", label: t("settings.sections.about") }
]);
const sections = computed(() => allSections.value.filter((section) => {
  if (section.id === "admin") return props.messenger.state.admin;
  return true;
}));
const filteredSections = computed(() => {
  const query = settingsSearch.value.trim().toLowerCase();
  if (!query) return sections.value;
  return sections.value.filter((section) => section.label.toLowerCase().includes(query));
});
const statusOptions = computed(() => [
  { value: "online", label: t("sidebar.online") },
  { value: "invisible", label: t("sidebar.invisible") },
  { value: "dnd", label: t("sidebar.dnd") }
]);
const themeModeOptions = computed(() => [
  { value: "system", label: t("settings.ui.system") },
  { value: "dark", label: t("settings.ui.dark") },
  { value: "light", label: t("settings.ui.light") },
  { value: "adaptive", label: t("settings.ui.adaptive") }
]);
const accentOptions = computed(() => [
  { value: "blue", label: t("settings.ui.blue") },
  { value: "violet", label: t("settings.ui.violet") },
  { value: "emerald", label: t("settings.ui.emerald") },
  { value: "rose", label: t("settings.ui.rose") },
  { value: "amber", label: t("settings.ui.amber") }
]);
const messageStyleOptions = computed(() => [
  { value: "bubble", label: t("settings.ui.bubbles") },
  { value: "discord", label: t("settings.ui.discord") }
]);
const localeOptions = computed(() =>
  availableLocales.map((code) => ({ value: code, label: LOCALE_LABELS[code] || code }))
);
const pinLengthOptions = [4, 6, 8].map((length) => ({ value: length, label: String(length) }));
const autolockSelectOptions = computed(() =>
  autolockOptions.value.map((ms: number) => ({ value: ms, label: autolockLabel(ms) }))
);
const duressActionOptions = computed(() => [
  { value: "wipe", label: t("settings.opsec.actionWipe") },
  { value: "decoy", label: t("settings.opsec.actionDecoy") }
]);
const turnServerOptions = computed(() =>
  turnServers.value.map((server: TurnServerConfig) => ({ value: String(server.id), label: String(server.label) }))
);
function deviceOptions(devices: MediaDeviceInfo[], fallback: (index: number) => string) {
  return [
    { value: "", label: t("settings.calls.systemDefault") },
    ...devices.map((device: MediaDeviceInfo, index: number) => ({
      value: String(device.deviceId || ""),
      label: deviceLabel(device, fallback(index))
    }))
  ];
}
const microphoneOptions = computed(() => deviceOptions(microphones.value, (i) => `Microphone ${i + 1}`));
const speakerOptions = computed(() => deviceOptions(headphones.value, (i) => `Output ${i + 1}`));
const cameraOptions = computed(() =>
  deviceOptions(cameras.value, (i) => `${t("settings.calls.camera")} ${i + 1}`)
);
const acceptUnknownOptions = computed(() => [
  { value: "off", label: t("phantom.acceptUnknownOff") },
  { value: "filter", label: t("phantom.acceptUnknownFilter") },
  { value: "all", label: t("phantom.acceptUnknownAll") }
]);

const myBadges = computed<string[]>(() => props.messenger.badgesFor?.(props.messenger.state.username) || []);
const myBadgeNames = computed(() => myBadges.value.map((badge) => badgeLabelFor(t, badge)).join(", "));
const activeSectionLabel = computed(() => sections.value.find((section) => section.id === activeSection.value)?.label || "Settings");
watch(isOpen, async (v) => {
  if (v) {
    if (settingsHistoryDepth === 0) pushSettingsHistoryEntry();
    mobileSectionOpen.value = false;
    settingsSearch.value = "";
    draftName.value = props.messenger.state.username || "";
    draftDescription.value = props.messenger.state.profile?.description || "";
    draftPronouns.value = props.messenger.state.profile?.pronouns || "";
    if (sections.value.some((section) => section.id === props.initialSection)) {
      activeSection.value = props.initialSection;
    }
    if (activeSection.value === "calls") props.messenger.refreshAudioDevices();
    await nextTick();
    maybeAutoLoadTorDirectory();
  } else {
    releaseSettingsHistoryEntry();
  }
});

watch(activeSection, async (section) => {
  if (!isOpen.value) return;
  if (section === "calls") props.messenger.refreshAudioDevices();
  if (section !== "calls") {
    props.messenger.stopMicTest();
    stopCameraPreview();
  }
});

function close() {
  props.messenger.stopMicTest();
  stopCameraPreview();
  mobileSectionOpen.value = false;
  props.messenger.state.settingsOpen = false;
}

function selectSection(sectionId: string) {
  activeSection.value = sectionId;
  if (isMobileSettings.value) mobileSectionOpen.value = true;
}

function backToSettingsList() {
  props.messenger.stopMicTest();
  stopCameraPreview();
  mobileSectionOpen.value = false;
}

async function saveName() {
  if (!nameValid.value || !nameChanged.value) return;
  const saved = await props.messenger.changeUsername(draftName.value.trim());
  if (saved) draftName.value = props.messenger.state.username || "";
}

function saveProfileText() {
  if (!profileTextChanged.value) return;
  props.messenger.setProfileText({
    description: draftDescription.value,
    pronouns: draftPronouns.value
  });
}

/** Puts the three drafts back to what the account currently holds. */
function revertProfileDrafts() {
  draftName.value = props.messenger.state.username || "";
  draftDescription.value = props.messenger.state.profile?.description || "";
  draftPronouns.value = props.messenger.state.profile?.pronouns || "";
}

async function saveAll() {
  if (nameChanged.value && nameValid.value) await saveName();
  if (profileTextChanged.value) saveProfileText();
}

function onAvatarPicked(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  openCrop(file, "avatar");
}

function onBannerPicked(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  openCrop(file, "banner");
}

async function openCrop(file, kind: "avatar" | "banner") {
  if (!file) return;
  if (file.type && !String(file.type).startsWith("image/")) {
    props.messenger.state.lastError = t("crop.invalidImage");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  const limit = kind === "banner" ? 15 * 1024 * 1024 : 10 * 1024 * 1024;
  if (Number(file.size) > limit) {
    props.messenger.state.lastError = t("crop.tooLarge");
    props.messenger.showToast?.(props.messenger.state.lastError);
    return;
  }
  // Cropping draws the image onto a canvas, and a canvas only ever holds one
  // frame: running an animated GIF, APNG or WebP through it would silently
  // turn it into a still. There is no in-browser re-encoder for those, so the
  // file goes up untouched and the crop step is skipped rather than faked.
  if (await isAnimatedImage(file)) {
    props.messenger.showToast?.(t("crop.animatedKept"));
    props.messenger.setProfileImageFromFile(kind, file);
    return;
  }

  crop.value = {
    open: true,
    src: URL.createObjectURL(file),
    kind,
    mimeType: String(file.type || ""),
  };
}

function onCropCancel() {
  if (crop.value?.src) URL.revokeObjectURL(crop.value.src);
  crop.value = null;
}

function onCropConfirm(file: File) {
  const state = crop.value;
  crop.value = null;
  if (state?.src) URL.revokeObjectURL(state.src);
  if (state?.kind) props.messenger.setProfileImageFromFile(state.kind, file);
}

function onExport() { props.messenger.exportData(); }
function onImport() { fileInputRef.value?.click(); }
function onFilePicked(event) {
  const file = event.target.files?.[0];
  if (file) props.messenger.importData(file);
  event.target.value = "";
}
function onRecoveryFilePick() {
  recoveryFileInputRef.value?.click();
}
async function onRecoveryFilePicked(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    recoveryWordsInput.value = (await file.text()).trim();
    importRecoveryWords();
  } catch {
    /* ignore */
  }
}
async function onClear() {
  if (!await dialog.showConfirm("Clear all local data? This removes every conversation, message, and reaction from this browser. The remote server is not touched.")) return;
  props.messenger.clearAllData();
  close();
}

async function onLogout() {
  if (!await dialog.showConfirm(t('settings.security.logoutConfirm'))) return;
  props.messenger.logoutAccount();
  close();
}

async function onSaveDuressPin() {
  if (duressPin.value !== duressPinConfirm.value) {
    await dialog.showAlert(t('settings.security.pinMismatch'));
    return;
  }
  const ok = await props.messenger.setOpsecDuressPin(duressPin.value);
  if (ok) {
    duressPin.value = "";
    duressPinConfirm.value = "";
  }
}

async function onStartDecoySetup() {
  if (!await dialog.showConfirm(t('settings.opsec.decoySetupConfirm'))) return;
  await props.messenger.startOpsecDecoySetup();
}

async function onEnableClientLock() {
  if (lockPin.value !== lockPinConfirm.value) {
    await dialog.showAlert(t('settings.security.pinMismatch'));
    return;
  }
  const ok = await props.messenger.enableClientLock(lockPin.value);
  if (ok) {
    lockPin.value = "";
    lockPinConfirm.value = "";
  }
}

async function onDisableClientLock() {
  const pin = await dialog.showPrompt(t('settings.security.disableLockPrompt'));
  if (!pin) return;
  const unlocked = await props.messenger.verifyClientLockPin(pin);
  if (!unlocked) return;
  if (!await dialog.showConfirm(t('settings.security.disableLockConfirm'))) return;
  const disabled = await props.messenger.disableClientLock();
  if (disabled) await dialog.showAlert(t('settings.security.disableLockSuccess'));
  lockPin.value = "";
  lockPinConfirm.value = "";
}

async function onDeleteAccount() {
  const confirmed = await dialog.showConfirm(t('settings.profile.deleteAccountConfirm'));
  if (!confirmed) return;
  const password = await dialog.showPrompt(t('settings.profile.deleteAccountPrompt'));
  if (!password) return;
  props.messenger.deleteAccount(password)
    .then(() => {
      close();
    })
    .catch(async (err: unknown) => {
      await dialog.showAlert(err?.message || t('settings.profile.deleteAccountError'));
    });
}

function targetChecked(event: Event) {
  return Boolean((event.target as HTMLInputElement | null)?.checked);
}

function targetValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement | null)?.value || "";
}

function targetNumber(event: Event) {
  return Number((event.target as HTMLInputElement | HTMLSelectElement | null)?.value) || 0;
}

function onPollIntervalChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input) return;
  const raw = input.value.trim();
  if (raw === "") {
    phantom.setPollInterval(null);
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 3 || n > 40) {
    input.value = phantom.state.pollIntervalSeconds == null ? "" : String(phantom.state.pollIntervalSeconds);
    return;
  }
  phantom.setPollInterval(n);
}

const microphones = computed(() =>
  props.messenger.state.audioDevices.filter((device) => device.kind === "audioinput")
);
const headphones = computed(() =>
  props.messenger.state.audioDevices.filter((device) => device.kind === "audiooutput")
);
const cameras = computed(() =>
  props.messenger.state.audioDevices.filter((device) => device.kind === "videoinput")
);
const cameraPreviewActive = ref(false);
const cameraPreviewLoading = ref(false);
const cameraPreviewError = ref("");
let cameraPreviewStream: MediaStream | null = null;

function stopCameraPreview() {
  if (cameraPreviewStream) {
    for (const track of cameraPreviewStream.getTracks()) track.stop();
    cameraPreviewStream = null;
  }
  if (cameraPreviewRef.value) cameraPreviewRef.value.srcObject = null;
  cameraPreviewActive.value = false;
  cameraPreviewLoading.value = false;
}

async function startCameraPreview() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraPreviewError.value = t('settings.calls.cameraUnavailable');
    return;
  }
  stopCameraPreview();
  cameraPreviewError.value = "";
  cameraPreviewActive.value = true;
  cameraPreviewLoading.value = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: props.messenger.state.selectedVideoInputId
        ? { deviceId: { exact: props.messenger.state.selectedVideoInputId } }
        : true,
      audio: false
    });
    cameraPreviewStream = stream;
    await props.messenger.refreshAudioDevices();
    if (cameraPreviewRef.value) {
      cameraPreviewRef.value.srcObject = stream;
      await cameraPreviewRef.value.play().catch(() => { });
    }
  } catch (error) {
    cameraPreviewError.value = error instanceof Error ? error.message : t('settings.calls.cameraPreviewError');
    stopCameraPreview();
  } finally {
    cameraPreviewLoading.value = false;
  }
}

async function onVideoInputChanged(deviceId: string) {
  props.messenger.setVideoInput(deviceId);
  if (cameraPreviewActive.value) await startCameraPreview();
}

const runtimePlatform = computed(() => {
  const messengerPlatform = String(props.messenger.platformsForUser?.(props.messenger.state.username || "")?.[0] || "").trim();
  if (messengerPlatform) return messengerPlatform;
  const ua = String(navigator.userAgent || "").toLowerCase();
  if (ua.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "web";
});

const browserLanguage = computed(() => navigator.language || "-");

const selectedTurnServer = computed(() => {
  const id = props.messenger.state.selectedTurnServerId;
  if (!id) return null;
  return turnServers.value.find((s: TurnServerConfig) => s.id === id) || null;
});

const runtimeDetails = computed(() => {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  const turn = selectedTurnServer.value;
  const turnUrls = Array.isArray(turn?.urls) ? turn.urls : [];
  return {
    appVersion: __APP_VERSION__,
    platform: props.messenger.platformLabel(runtimePlatform.value),
    os: uaData?.platform || navigator.platform || "unknown",
    mobile: uaData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    secureContext: window.isSecureContext,
    online: navigator.onLine,
    language: navigator.language || "unknown",
    timezone,
    userAgent: navigator.userAgent,
    serverOrigin: appRuntimeConfig.serverOrigin,
    apiBaseUrl: appRuntimeConfig.apiBaseUrl,
    wsUrl: appRuntimeConfig.wsUrl,
    turnUser: turn?.username || "-",
    turnHost: turnUrls[0] || "-",
    turnRemote: Boolean(turn?.urls?.some((url: string) => /^turn|turns:/i.test(url))),
    turnSecure: turnUrls.some((url: string) => String(url).trim().toLowerCase().startsWith("turns:")),
    turnPassword: turn?.credential || "-"
  };
});

function deviceLabel(device, fallback) {
  return device.label || fallback;
}

function initialsOf(name) {
  const trimmed = String(name || "?").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s\-_]+/).slice(0, 2);
  if (parts.length === 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

function onKey(event) {
  if (!isOpen.value) return;
  if (event.key !== "Escape") return;
  // Let the global confirm/prompt dialog consume Escape first — otherwise
  // dismissing a logout/delete confirmation would also close Settings.
  try {
    if (dialog?.dialogState?.open) return;
  } catch {
    /* ignore */
  }
  if (isMobileSettings.value && mobileSectionOpen.value) backToSettingsList();
  else close();
}

function syncMobileSettings() {
  isMobileSettings.value = window.matchMedia("(max-width: 820px)").matches;
}

// --- System back gesture / history -----------------------------------------
// While the panel is open it owns one history entry. The Android system back
// (WryActivity routes back presses into WebView history) then pops it:
// section open -> back to the list, else close the panel. Button exits route
// through close()/the watcher, which consume the entry via history.back().
let settingsHistoryDepth = 0;
let consumingOwnHistoryState = false;

function pushSettingsHistoryEntry() {
  try {
    history.pushState({ lqxpSettings: true }, "");
    settingsHistoryDepth += 1;
  } catch {
    /* history unavailable */
  }
}

function releaseSettingsHistoryEntry() {
  if (settingsHistoryDepth <= 0) return;
  settingsHistoryDepth -= 1;
  consumingOwnHistoryState = true;
  try {
    history.back();
  } catch {
    consumingOwnHistoryState = false;
  }
}

function onSettingsPopState() {
  if (consumingOwnHistoryState) {
    consumingOwnHistoryState = false;
    return;
  }
  if (settingsHistoryDepth > 0) settingsHistoryDepth -= 1;
  if (!isOpen.value) return;
  try {
    // Mirror Escape: a confirm/prompt dialog eats the back press first.
    if (dialog?.dialogState?.open) {
      pushSettingsHistoryEntry();
      return;
    }
  } catch {
    /* ignore */
  }
  if (isMobileSettings.value && mobileSectionOpen.value) {
    backToSettingsList();
    // Panel stays open — re-arm an entry so the next back still targets it.
    pushSettingsHistoryEntry();
  } else {
    close();
  }
}

// --- Swipe-down to exit (mobile) --------------------------------------------
// Dragging the sticky header downward exits: the section header goes back to
// the list, the list header closes the panel — matching the on-screen
// chevron/close semantics, with a live follow transform.
const settingsPanelRef = ref<HTMLElement | null>(null);
const SWIPE_EXIT_THRESHOLD = 90;
const SWIPE_MAX_SHIFT = 160;
let swipeArmed = false;
let swipeKind: "panel" | "section" | null = null;
let swipeStartX = 0;
let swipeStartY = 0;

function clearSwipeTransform() {
  const panel = settingsPanelRef.value;
  if (!panel || !panel.style.transform) return;
  panel.style.transition = "transform 180ms ease";
  panel.style.transform = "";
  window.setTimeout(() => {
    if (settingsPanelRef.value === panel) panel.style.transition = "";
  }, 200);
}

function slidePanelOffScreen() {
  const panel = settingsPanelRef.value;
  if (!panel) return;
  panel.style.transition = "transform 240ms cubic-bezier(0.16, 0.8, 0.2, 1), opacity 200ms ease";
  panel.style.transform = "translateY(100%)";
  panel.style.opacity = "0";
}

function onSettingsTouchStart(event: TouchEvent) {
  if (!isMobileSettings.value) return;
  const el = event.target as HTMLElement | null;
  const kind = el?.closest?.(".settings__main-head")
    ? "section"
    : el?.closest?.(".settings__side-head")
      ? "panel"
      : null;
  if (!kind) return;
  swipeArmed = true;
  swipeKind = kind;
  swipeStartX = event.touches[0]?.clientX ?? 0;
  swipeStartY = event.touches[0]?.clientY ?? 0;
  const panel = settingsPanelRef.value;
  if (panel) panel.style.transition = "";
}

function onSettingsTouchMove(event: TouchEvent) {
  if (!swipeArmed) return;
  const dy = (event.touches[0]?.clientY ?? 0) - swipeStartY;
  const dx = (event.touches[0]?.clientX ?? 0) - swipeStartX;
  const panel = settingsPanelRef.value;
  if (!panel) return;
  if (dy <= 0 || dy <= Math.abs(dx)) {
    if (panel.style.transform) panel.style.transform = "translateY(0px)";
    return;
  }
  panel.style.transform = `translateY(${Math.min(dy, SWIPE_MAX_SHIFT)}px)`;
}

function onSettingsTouchEnd(event: TouchEvent) {
  if (!swipeArmed) return;
  swipeArmed = false;
  const dy = (event.changedTouches[0]?.clientY ?? 0) - swipeStartY;
  const dx = (event.changedTouches[0]?.clientX ?? 0) - swipeStartX;
  const kind = swipeKind;
  swipeKind = null;
  if (!(dy > SWIPE_EXIT_THRESHOLD && dy > Math.abs(dx))) {
    clearSwipeTransform();
    return;
  }
  // Commit: keep the panel sliding down instead of springing back.
  slidePanelOffScreen();
  if (kind === "section") backToSettingsList();
  else close();
}

function onSettingsTouchCancel() {
  swipeArmed = false;
  swipeKind = null;
  clearSwipeTransform();
}

onMounted(() => {
  syncMobileSettings();
  window.addEventListener("resize", syncMobileSettings, { passive: true });
  window.addEventListener("popstate", onSettingsPopState);
  document.addEventListener("keydown", onKey);

  // Keep the Tor status in sync with the backend (bootstrap → ready | stopped),
  // and seed it immediately so a Tor that was already auto-started at boot is
  // reflected without waiting for the next event.
  if (isTorRuntime()) {
    unsubTorStatus = onTorStatus((s) => {
      torStatus.value = s;
    });
    fetchTorStatus().then((s) => {
      torStatus.value = s;
    }).catch(() => {});
    loadDiscordRpc().catch(() => {});
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", syncMobileSettings);
  window.removeEventListener("popstate", onSettingsPopState);
  document.removeEventListener("keydown", onKey);
  releaseSettingsHistoryEntry();
  stopCameraPreview();
  unsubTorStatus?.();
});
</script>

<template>
  <Transition name="settings">
    <div v-if="isOpen" ref="settingsPanelRef" class="settings" :class="{ 'settings--section-open': mobileSectionOpen }" role="dialog"
    aria-modal="true" aria-labelledby="settings-title" @touchstart="onSettingsTouchStart" @touchmove="onSettingsTouchMove"
    @touchend="onSettingsTouchEnd" @touchcancel="onSettingsTouchCancel">
    <aside class="settings__side">
      <header class="settings__side-head">
        <h2 id="settings-title">{{ t('settings.title') }}</h2>
        <button class="icon-btn settings__close" type="button" :aria-label="t('settings.close')" @click="close">
          <svg viewBox="0 0 24 24">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <button class="settings__card" type="button" @click="activeSection = 'profile'">
        <span v-if="avatarSrc" class="side-user__avatar">
          <img :src="avatarSrc" alt="" />
        </span>
        <span v-else class="avatar avatar--md" :class="`avatar--${meAccent}`">{{ meInitials }}</span>
        <span class="settings__card-identity">
          <span class="settings__card-name">
            <strong>@{{ messenger.state.username || "anonymous" }}</strong>
            <span v-if="myBadges.length" class="settings__card-badges" :aria-label="myBadgeNames">
              <BadgeIcon v-for="badge in myBadges.slice(0, 3)" :key="badge" :badge="badge" />
              <small v-if="myBadges.length > 3" class="settings__card-badges-more">+{{ myBadges.length - 3 }}</small>
            </span>
          </span>
          <small>{{ connectionStatusLabel }}</small>
        </span>
      </button>

      <nav class="settings__nav" aria-label="Settings sections">
        <button v-for="section in filteredSections" :key="section.id" type="button" class="settings__nav-item"
          :class="{ 'is-active': activeSection === section.id }" @click="selectSection(section.id)">
          <svg v-if="section.id === 'profile'" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          <svg v-else-if="section.id === 'ui'" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
          </svg>
          <svg v-else-if="section.id === 'language'" viewBox="0 0 24 24">
            <path d="M4 5h9" />
            <path d="M8.5 5c0 6-2.5 10-5.5 12" />
            <path d="M6 11c1.5 2 3.5 3.5 6 4.5" />
            <path d="M14 15h6" />
            <path d="m17 5 4 10" />
            <path d="m13 15 4-10" />
          </svg>
          <svg v-else-if="section.id === 'security'" viewBox="0 0 24 24">
            <rect x="5" y="10" width="14" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <path d="M12 14v2.5" />
          </svg>
          <svg v-else-if='section.id === "opsec"' viewBox="0 0 24 24">
            <path d="M14 18a2 2 0 0 0-4 0" />
            <path d="m19 11-2.11-6.657a2 2 0 0 0-2.752-1.148l-1.276.61A2 2 0 0 1 12 4H8.5a2 2 0 0 0-1.925 1.456L5 11" />
            <path d="M2 11h20" />
            <circle cx="17" cy="18" r="3" />
            <circle cx="7" cy="18" r="3" />
          </svg>
          <svg v-else-if="section.id === 'notifications'" viewBox="0 0 24 24">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
            <path d="M10 21h4" />
          </svg>
          <svg v-else-if="section.id === 'calls'" viewBox="0 0 24 24">
            <path
              d="M7.6 10.8a14.5 14.5 0 0 0 5.6 5.6l1.9-1.9a1.5 1.5 0 0 1 1.5-.37c1.03.34 2.1.52 3.2.52.83 0 1.5.67 1.5 1.5v3.05c0 .83-.67 1.5-1.5 1.5C10.45 20.7 3.3 13.55 3.3 4.2c0-.83.67-1.5 1.5-1.5h3.05c.83 0 1.5.67 1.5 1.5 0 1.1.18 2.17.52 3.2.17.53.03 1.1-.37 1.5l-1.9 1.9Z" />
          </svg>
          <svg v-else-if="section.id === 'advanced'" viewBox="0 0 24 24">
            <path d="M4 7h5" />
            <path d="M15 7h5" />
            <circle cx="12" cy="7" r="3" />
            <path d="M4 17h8" />
            <path d="M18 17h2" />
            <circle cx="15" cy="17" r="3" />
            <path d="M12 10v4" />
          </svg>
          <img v-else-if="section.id === 'tor'" class="settings__nav-icon-img"
            src="/icons/tor.svg" alt="" aria-hidden="true" />
          <svg v-else-if="section.id === 'admin'" viewBox="0 0 24 24">
            <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
            <path
              d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2 2 0 0 1-4 0v-.1a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-1.98.36l-.05.05a2 2 0 0 1-2.83-2.83l.05-.05A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.1H3a2 2 0 0 1 0-4h.1A1.8 1.8 0 0 0 4.75 8.8a1.8 1.8 0 0 0-.36-1.98l-.05-.05A2 2 0 0 1 7.17 3.94l.05.05a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 10.3 2.7V2.6a2 2 0 0 1 4 0v.1a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.05-.05a2 2 0 0 1 2.83 2.83l-.05.05a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.1h.1a2 2 0 0 1 0 4h-.1A1.8 1.8 0 0 0 19.4 15Z" />
          </svg>
          <svg v-else-if="section.id === 'backups'" viewBox="0 0 24 24">
            <path d="M12 3v12" />
            <path d="m6 9 6-6 6 6" />
            <path d="M5 21h14" />
          </svg>
          <svg v-else-if="section.id === 'donation'" viewBox="0 0 24 24" style="fill: currentColor; stroke: none;">
            <path d="M12 21s-7.5-4.7-9.8-9.2C.4 8.6 2.7 5 6.5 5c2.2 0 3.9 1.2 5.5 3.2C13.6 6.2 15.3 5 17.5 5c3.8 0 6.1 3.6 4.3 6.8C19.5 16.3 12 21 12 21Z" />
          </svg>
          <svg v-else-if="section.id === 'phantom'" viewBox="0 0 24 24">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M16 11h6" />
          </svg>
          <svg v-else viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span>{{ section.label }}</span>
          <svg class="settings__chevron" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </nav>

      <div class="settings__disconnect">
        <button v-if="messenger.state.authToken" type="button" class="settings__disconnect-btn"
          @click="onLogout">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M9 12h12" />
            <path d="m17 8 4 4-4 4" />
            <path d="M9 4h-4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          </svg>
          {{ t('settings.security.logout') }}
        </button>
      </div>
    </aside>

    <main class="settings__main">
      <header class="settings__main-head">
        <button class="icon-btn settings__back" type="button" :aria-label="t('settings.back')"
          @click="backToSettingsList">
          <svg viewBox="0 0 24 24">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h3>{{ activeSectionLabel }}</h3>
      </header>

      <section v-if="activeSection === 'profile'" class="settings-page">
        <div class="settings-profile">
          <div class="settings-profile__banner" :class="{ 'has-image': bannerSrc }">
            <img v-if="bannerSrc" :src="bannerSrc" alt="" />
          </div>

          <span v-if="avatarSrc" class="settings-profile__avatar-image">
            <img :src="avatarSrc" alt="" />
          </span>
          <span v-else class="avatar settings-profile__avatar"
            :class="`avatar--${meAccent}`">{{ meInitial }}</span>

          <!-- One row, fixed shape: the two pickers always sit in the same
               place, and each removal appears beside the picture it clears
               rather than shifting the row around. -->
          <div class="settings-profile__actions">
            <div class="settings-profile__pair">
              <button type="button" class="settings-profile__pick" @click="avatarInputRef?.click()">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h3l1.4-2h7.2L17 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span>{{ t('settings.profile.profileImage') }}</span>
              </button>
              <button v-if="profile.avatar" type="button" class="settings-profile__clear"
                :aria-label="t('settings.profile.clearImage')" :title="t('settings.profile.clearImage')"
                @click="messenger.clearProfileImage('avatar')">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="settings-profile__pair">
              <button type="button" class="settings-profile__pick" @click="bannerInputRef?.click()">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 5h18v14H3z" />
                  <path d="m3 15 5-4 4 3 3-2 6 4" />
                </svg>
                <span>{{ t('settings.profile.banner') }}</span>
              </button>
              <button v-if="profile.banner" type="button" class="settings-profile__clear"
                :aria-label="t('settings.profile.clearBanner')" :title="t('settings.profile.clearBanner')"
                @click="messenger.clearProfileImage('banner')">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <input ref="avatarInputRef" type="file"
            accept="image/png,image/apng,image/gif,image/jpeg,image/webp,.apng,.webp" style="display: none"
            @change="onAvatarPicked" />
          <input ref="bannerInputRef" type="file"
            accept="image/png,image/apng,image/gif,image/jpeg,image/webp,.apng,.webp" style="display: none"
            @change="onBannerPicked" />
        </div>

        <p class="settings-note">
          {{ t('settings.profile.noteImages') }}
        </p>

        <div class="settings-group">
          <label class="settings-field" for="profile-display-name">
            <span class="settings-field__icon">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
            </span>
            <span class="settings-field__body">
              <span class="settings-field__label">{{ t('settings.profile.displayName') }}</span>
              <span class="settings-field__hint">{{ t('settings.profile.displayNameHint') }}</span>
            </span>
          </label>
          <div class="settings-inline">
            <input id="profile-display-name" ref="firstInputRef" v-model="draftName" type="text" maxlength="32" autocomplete="off"
              spellcheck="false" placeholder="@echo" class="settings-input"
              :aria-invalid="nameError ? 'true' : undefined"
              :aria-describedby="nameError ? 'profile-display-name-error' : undefined"
              @keydown.enter.prevent="saveName" />
          </div>
          <p v-if="nameError" id="profile-display-name-error" class="settings-note settings-note--error"
            role="alert">{{ nameError }}</p>
        </div>

        <div class="settings-group">
          <label class="settings-field">
            <span class="settings-field__icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2v4" />
                <path d="M12 18v4" />
                <path d="m4.93 4.93 2.83 2.83" />
                <path d="m16.24 16.24 2.83 2.83" />
                <path d="M2 12h4" />
                <path d="M18 12h4" />
                <path d="m4.93 19.07 2.83-2.83" />
                <path d="m16.24 7.76 2.83-2.83" />
              </svg>
            </span>
            <span class="settings-field__body">
              <span class="settings-field__label">{{ t('settings.profile.status') }}</span>
              <span class="settings-field__hint">{{ t('settings.profile.statusHint') }}</span>
            </span>
          </label>
          <div class="settings-select settings-select--offset">
            <SelectMenu :aria-label="t('settings.profile.status')" :model-value="messenger.state.status" :options="statusOptions"
              @update:model-value="messenger.setPresenceStatus(String($event))" />
          </div>
        </div>


        <div class="settings-group">
          <label class="settings-field" for="profile-description">
            <span class="settings-field__icon">
              <svg viewBox="0 0 24 24">
                <path d="M4 6h16" />
                <path d="M4 12h13" />
                <path d="M4 18h9" />
              </svg>
            </span>
            <span class="settings-field__body">
              <span class="settings-field__label">{{ t('settings.profile.description') }}</span>
              <span class="settings-field__hint">{{ draftDescription.length }}/{{
                messenger.MAX_PROFILE_DESCRIPTION_LENGTH }}</span>
            </span>
          </label>
          <div class="settings-inline">
            <textarea id="profile-description" v-model="draftDescription" class="settings-input settings-textarea"
              :maxlength="messenger.MAX_PROFILE_DESCRIPTION_LENGTH" spellcheck="true" rows="4"
              :placeholder="t('settings.profile.descriptionPlaceholder')"></textarea>
          </div>
        </div>

        <div class="settings-group">
          <label class="settings-field" for="profile-pronouns">
            <span class="settings-field__icon">
              <svg viewBox="0 0 24 24">
                <path d="M5 7h14" />
                <path d="M8 7v10" />
                <path d="M16 7v10" />
                <path d="M4 17h16" />
              </svg>
            </span>
            <span class="settings-field__body">
              <span class="settings-field__label">{{ t('settings.profile.pronouns') }}</span>
              <span class="settings-field__hint">{{ draftPronouns.length }}/{{ messenger.MAX_PROFILE_PRONOUNS_LENGTH
              }}</span>
            </span>
          </label>
          <div class="settings-inline">
            <input id="profile-pronouns" v-model="draftPronouns" type="text" :maxlength="messenger.MAX_PROFILE_PRONOUNS_LENGTH"
              autocomplete="off" spellcheck="false" :placeholder="t('settings.profile.pronounsPlaceholder')"
              class="settings-input" @keydown.enter.prevent="saveProfileText" />
          </div>
        </div>

        <div class="settings-group settings-group--danger">
          <h4>{{ t('settings.profile.dangerZone') }}</h4>
          <p class="settings-note">{{ t('settings.profile.deleteAccountNote') }}</p>
          <div class="settings-actions">
            <button type="button" class="btn settings-btn settings-btn--danger" @click="onDeleteAccount">
              {{ t('settings.profile.deleteAccount') }}
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="activeSection === 'ui'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.ui.theme') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.ui.themeLabel') }}</span>
            <SelectMenu :aria-label="t('settings.ui.themeLabel')" :model-value="messenger.state.themeMode" :options="themeModeOptions"
              @update:model-value="messenger.setThemeMode(String($event))" />
          </div>
          <p class="settings-note">{{ t('settings.ui.adaptiveNote') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.ui.colors') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.ui.accentColor') }}</span>
            <SelectMenu :aria-label="t('settings.ui.accentColor')" :model-value="messenger.state.appAccent" :options="accentOptions"
              @update:model-value="messenger.setAppAccent(String($event))" />
          </div>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.ui.messages') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.ui.messageShape') }}</span>
            <SelectMenu :aria-label="t('settings.ui.messageShape')" :model-value="messenger.state.messageStyle" :options="messageStyleOptions"
              @update:model-value="messenger.setMessageStyle(String($event))" />
          </div>
          <label class="settings-check">
            <span>{{ t('settings.ui.groupMembersByRole') }}</span>
            <span class="toggle" :class="{ 'is-on': messenger.state.groupMembersByRole }">
              <input type="checkbox" :checked="messenger.state.groupMembersByRole"
                @change="messenger.setGroupMembersByRole(($event.target as HTMLInputElement).checked)" />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </span>
          </label>
          <p class="settings-note">{{ t('settings.ui.groupMembersByRoleNote') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.ui.search') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.ui.spotlightSearch') }}</span>
            <span class="toggle" :class="{ 'is-on': messenger.state.spotlightSearchEnabled }">
              <input type="checkbox" :checked="messenger.state.spotlightSearchEnabled"
                @change="messenger.setSpotlightSearchEnabled(($event.target as HTMLInputElement).checked)" />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </span>
          </label>
          <p class="settings-note">{{ t('settings.ui.spotlightSearchNote') }}</p>
        </div>
      </section>

      <section v-else-if="activeSection === 'language'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.language.title') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.language.appLanguage') }}</span>
            <SelectMenu :aria-label="t('settings.language.appLanguage')" :model-value="locale" :options="localeOptions"
              @update:model-value="locale = String($event)" />
          </div>
          <dl class="settings-kv settings-kv--language">
            <div>
              <dt>{{ t('settings.language.currentLanguage') }}</dt>
              <dd>{{ LOCALE_LABELS[locale] || locale }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.language.browserLanguage') }}</dt>
              <dd>{{ browserLanguage }}</dd>
            </div>
          </dl>
          <p class="settings-note">{{ t('settings.language.note') }}</p>
        </div>
      </section>

      <section v-else-if="activeSection === 'security'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.security.account') }}</h4>
          <dl class="settings-kv">
            <div>
              <dt>{{ t('settings.security.userId') }}</dt>
              <dd>{{ messenger.state.userId || "-" }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.security.username') }}</dt>
              <dd>{{ messenger.state.username || "-" }}</dd>
            </div>
          </dl>
          <div class="settings-actions">
            <button type="button" class="btn settings-btn" @click="messenger.downloadRecoveryWords">
              {{ t('settings.security.downloadRecovery') }}
            </button>
            <button type="button" class="btn settings-btn settings-btn--danger" @click="onLogout">
              {{ t('settings.security.logout') }}
            </button>
          </div>
          <p class="settings-note">
            {{ t('settings.security.recoveryNote') }}
          </p>
        </div>

        <div class="settings-group">
          <h4>{{ t("settings.security.recoveryTitle") }}</h4>
          <p v-if="recoverySigned" class="settings-note recovery-signed">
            {{ t("settings.security.recoverySigned") }}
          </p>
          <p v-else class="settings-note recovery-unsigned">
            {{ t("settings.security.recoveryNotSigned") }}
          </p>
          <p class="settings-note">{{ t("settings.security.recoveryHint") }}</p>
          <div class="settings-inline">
            <textarea
              id="security-recovery-words"
              v-model="recoveryWordsInput"
              class="settings-input settings-textarea"
              rows="3"
              :aria-label="t('settings.security.recoveryTitle')"
              :placeholder="t('settings.security.recoveryPlaceholder')"
              autocomplete="off"
              spellcheck="false"
            ></textarea>
          </div>
          <div class="settings-actions">
            <button
              type="button"
              class="btn settings-btn"
              :disabled="!recoveryWordsInput.trim()"
              @click="importRecoveryWords"
            >
              {{ t("settings.security.recoveryImport") }}
            </button>
            <button type="button" class="btn settings-btn" @click="onRecoveryFilePick">
              {{ t("settings.security.recoveryImportFile") }}
            </button>
            <input
              ref="recoveryFileInputRef"
              type="file"
              accept=".txt,text/plain"
              style="display: none"
              @change="onRecoveryFilePicked"
            />
          </div>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.security.clientLock') }}</h4>
          <div v-if="!messenger.state.clientLockEnabled" class="settings-lock-form">
            <div class="settings-select">
              <span>{{ lockPinLabel }}</span>
              <SelectMenu :aria-label="lockPinLabel" :model-value="messenger.state.clientLockPinLength" :options="pinLengthOptions"
                @update:model-value="messenger.state.clientLockPinLength = Number($event)" />
            </div>
            <div class="settings-inline settings-inline--lock">
              <input v-model="lockPin" class="settings-input settings-input--pin" inputmode="numeric" pattern="[0-9]*"
                autocomplete="new-password" :maxlength="messenger.state.clientLockPinLength"
                :placeholder="lockPinPlaceholder" />
              <input v-model="lockPinConfirm" class="settings-input settings-input--pin" inputmode="numeric"
                pattern="[0-9]*" autocomplete="new-password" :maxlength="messenger.state.clientLockPinLength"
                :placeholder="lockPinPlaceholder" />
              <button type="button" class="btn btn--primary settings-btn" :disabled="messenger.state.clientLockLoading"
                @click="onEnableClientLock">
                {{ messenger.state.clientLockLoading ? t('settings.security.encrypting') :
                  t('settings.security.enableLock') }}
              </button>
            </div>
            <div v-if="messenger.state.clientLockLoading" class="settings-progress" role="progressbar"
              :aria-valuenow="messenger.state.clientLockProgress" aria-valuemin="0" aria-valuemax="100">
              <span :style="{ width: `${messenger.state.clientLockProgress || 8}%` }"></span>
            </div>
            <p v-if="messenger.state.clientLockLoading" class="settings-note">
              {{ t('settings.security.encryptingNote') }}
            </p>
          </div>

          <div v-else>
            <label class="settings-check">
              <span>{{ t('settings.security.autolockEnabled') }}</span>
              <input type="checkbox" :checked="messenger.state.clientLockAutolockEnabled"
                @change="messenger.setClientLockAutolockEnabled(targetChecked($event))" />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
            <div class="settings-select">
              <span>{{ t('settings.security.autolockThreshold') }}</span>
              <SelectMenu :aria-label="t('settings.security.autolockThreshold')" :model-value="messenger.state.clientLockAutolockTimeoutMs" :options="autolockSelectOptions"
                :disabled="!messenger.state.clientLockAutolockEnabled"
                @update:model-value="messenger.setClientLockAutolockTimeoutMs(Number($event))" />
            </div>
            <div class="settings-actions">
              <button type="button" class="btn settings-btn" :disabled="messenger.state.clientLockLoading"
                @click="messenger.lockClient">
                {{ t('settings.security.lockNow') }}
              </button>
              <button type="button" class="btn settings-btn settings-btn--danger" @click="onDisableClientLock">
                {{ t('settings.security.disableLock') }}
              </button>
            </div>
          </div>
          <p class="settings-note">
            {{ t('settings.security.clientLockNote') }}
          </p>
        </div>
      </section>

      <section v-else-if="activeSection === 'opsec'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.opsec.lockScreenPrivacyTitle') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.opsec.hideLockIdentity') }}</span>
            <input type="checkbox" :checked="messenger.state.opsecHideLockIdentity"
              @change="messenger.setOpsecHideLockIdentity(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">{{ t('settings.opsec.hideLockIdentityNote') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.opsec.duressTitle') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.opsec.duressAction') }}</span>
            <SelectMenu :aria-label="t('settings.opsec.duressAction')" :model-value="messenger.state.opsecDuressAction" :options="duressActionOptions"
              @update:model-value="messenger.setOpsecDuressAction(String($event))" />
          </div>
          <div class="settings-inline settings-inline--lock">
            <input v-model="duressPin" class="settings-input settings-input--pin settings-input--duress"
              inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
              :maxlength="messenger.state.clientLockPinLength" :placeholder="t('settings.opsec.duressPin')" />
            <input v-model="duressPinConfirm" class="settings-input settings-input--pin settings-input--duress"
              inputmode="numeric" pattern="[0-9]*" autocomplete="new-password"
              :maxlength="messenger.state.clientLockPinLength" :placeholder="t('settings.opsec.confirmDuressPin')" />
            <button type="button" class="btn btn--primary settings-btn"
              :disabled="!messenger.state.clientLockEnabled || messenger.state.clientLockLocked"
              @click="onSaveDuressPin">
              {{ t('settings.opsec.saveDuressPin') }}
            </button>
          </div>
          <div class="settings-actions" v-if="messenger.state.opsecDuressEnabled">
            <button type="button" class="btn settings-btn settings-btn--danger" @click="messenger.clearOpsecDuressPin">
              {{ t('settings.opsec.disableDuressPin') }}
            </button>
          </div>
          <p class="settings-note" v-if="!messenger.state.clientLockEnabled">{{ t('settings.opsec.requiresLock') }}</p>
          <p class="settings-note">{{ t('settings.opsec.duressNote') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.opsec.decoyTitle') }}</h4>
          <div class="settings-actions">
            <button type="button" class="btn settings-btn"
              :disabled="!messenger.state.clientLockEnabled || messenger.state.clientLockLocked"
              @click="onStartDecoySetup">
              {{ t('settings.opsec.configureDecoy') }}
            </button>
          </div>
          <p class="settings-note" v-if="messenger.state.opsecDecoyConfigured">{{ t('settings.opsec.decoyConfigured') }}
          </p>
          <p class="settings-note">{{ t('settings.opsec.decoyNote') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.opsec.ramOnlyTitle') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.opsec.ramOnlyEnabled') }}</span>
            <input type="checkbox" :checked="messenger.state.opsecRamOnlyEnabled"
              @change="messenger.setOpsecRamOnlyEnabled(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">{{ t('settings.opsec.ramOnlyNote') }}</p>
        </div>
      </section>

      <section v-else-if="activeSection === 'notifications'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.notifications.messages') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.notifications.messageSound') }}</span>
            <input type="checkbox" :checked="messenger.state.messageSoundEnabled"
              @change="messenger.setMessageSoundEnabled(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <label class="settings-check">
            <span>{{ t('settings.notifications.backgroundNotifs') }}</span>
            <input type="checkbox" :checked="messenger.state.androidNotificationsEnabled"
              @change="messenger.setAndroidNotificationsEnabled(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">{{ t('settings.notifications.permission', {
            status:
              messenger.notificationPermission()
          }) }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.notifications.sounds') }}</h4>
          <div class="sound-list">
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundMessage') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('message')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.message }">
                <input type="checkbox" :checked="messenger.state.soundFlags.message"
                  @change="messenger.setSoundEnabled('message', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundJoin') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('join')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.join }">
                <input type="checkbox" :checked="messenger.state.soundFlags.join"
                  @change="messenger.setSoundEnabled('join', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundLeave') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('leave')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.leave }">
                <input type="checkbox" :checked="messenger.state.soundFlags.leave"
                  @change="messenger.setSoundEnabled('leave', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundMute') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('mute')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.mute }">
                <input type="checkbox" :checked="messenger.state.soundFlags.mute"
                  @change="messenger.setSoundEnabled('mute', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundUnmute') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('unmute')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.unmute }">
                <input type="checkbox" :checked="messenger.state.soundFlags.unmute"
                  @change="messenger.setSoundEnabled('unmute', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundDeafen') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('deafen')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.deafen }">
                <input type="checkbox" :checked="messenger.state.soundFlags.deafen"
                  @change="messenger.setSoundEnabled('deafen', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundUndeafen') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('undeafen')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.undeafen }">
                <input type="checkbox" :checked="messenger.state.soundFlags.undeafen"
                  @change="messenger.setSoundEnabled('undeafen', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundCameraOn') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('cameraOn')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.cameraOn }">
                <input type="checkbox" :checked="messenger.state.soundFlags.cameraOn"
                  @change="messenger.setSoundEnabled('cameraOn', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundCameraOff') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('cameraOff')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.cameraOff }">
                <input type="checkbox" :checked="messenger.state.soundFlags.cameraOff"
                  @change="messenger.setSoundEnabled('cameraOff', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundScreenOn') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('screenOn')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.screenOn }">
                <input type="checkbox" :checked="messenger.state.soundFlags.screenOn"
                  @change="messenger.setSoundEnabled('screenOn', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
            <div class="sound-row">
              <div class="sound-row__info">
                <span class="sound-row__label">{{ t('settings.notifications.soundScreenOff') }}</span>
                <button type="button" class="sound-row__preview" @click="messenger.previewSound('screenOff')">{{
                  t('settings.notifications.previewSound') }}</button>
              </div>
              <label class="toggle" :class="{ 'is-on': messenger.state.soundFlags.screenOff }">
                <input type="checkbox" :checked="messenger.state.soundFlags.screenOff"
                  @change="messenger.setSoundEnabled('screenOff', targetChecked($event))" />
                <span class="toggle__track"><span class="toggle__thumb"></span></span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="activeSection === 'calls'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.calls.calling') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.calls.enableCalls') }}</span>
            <input type="checkbox" checked disabled />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <label class="settings-check">
            <span>{{ t('settings.calls.playCallingSounds') }}</span>
            <input type="checkbox" checked disabled />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
        </div>

        <div v-if="turnServers.length >= 1" class="settings-group">
          <h4>{{ t('settings.calls.turnServer') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.calls.relayServer') }}</span>
            <SelectMenu :aria-label="t('settings.calls.relayServer')" :model-value="messenger.state.selectedTurnServerId" :options="turnServerOptions"
              @update:model-value="messenger.setSelectedTurnServer(String($event))" />
          </div>
          <div v-if="selectedTurnInfo" class="turn-server-detail">
            <span class="turn-server-detail__urls">{{ selectedTurnInfo.urls }}</span>
            <small v-if="selectedTurnInfo.hint" class="turn-server-detail__hint">{{ selectedTurnInfo.hint }}</small>
          </div>

          <div v-if="messenger.state.customTurnServers?.length" class="custom-turn-list">
            <div v-for="srv in messenger.state.customTurnServers" :key="srv.id" class="custom-turn-row">
              <div class="custom-turn-row__info">
                <strong>{{ srv.label }}</strong>
                <small>{{ srv.urls.join(' · ') }}</small>
              </div>
              <button type="button" class="icon-btn" :aria-label="t('settings.calls.removeTurnServer')"
                @click="messenger.removeCustomTurnServer(srv.id)">
                <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <button type="button" class="btn settings-btn" @click="showAddTurn = !showAddTurn">
            {{ showAddTurn ? t('settings.calls.hideAddTurn') : t('settings.calls.showAddTurn') }}
          </button>

          <template v-if="showAddTurn">
            <div class="turn-form-field">
              <label class="settings-field">
                <span class="settings-field__body">
                  <span class="settings-field__label">{{ t('settings.calls.turnLabel') }}</span>
                </span>
              </label>
              <input v-model="newTurnLabel" type="text" class="settings-input" placeholder="My TURN" />
            </div>

            <div class="turn-form-field">
              <label class="settings-field">
                <span class="settings-field__body">
                  <span class="settings-field__label">{{ t('settings.calls.turnUrls') }}</span>
                </span>
              </label>
              <input v-model="newTurnUrls" type="text" class="settings-input"
                placeholder="turn:host:3478?transport=udp, turns:host:5349?transport=tcp" />
            </div>

            <div class="turn-form-field">
              <label class="settings-field">
                <span class="settings-field__body">
                  <span class="settings-field__label">{{ t('settings.calls.turnUsername') }}</span>
                </span>
              </label>
              <input v-model="newTurnUsername" type="text" class="settings-input" autocomplete="off" />
            </div>

            <div class="turn-form-field">
              <label class="settings-field">
                <span class="settings-field__body">
                  <span class="settings-field__label">{{ t('settings.calls.turnCredential') }}</span>
                </span>
              </label>
              <input v-model="newTurnCredential" type="password" class="settings-input" autocomplete="new-password" />
            </div>

            <p v-if="turnServerError" class="settings-note settings-note--error">{{ turnServerError }}</p>
            <button type="button" class="btn settings-btn turn-form-submit"
              :disabled="!newTurnUrls.trim() || !newTurnLabel.trim()" @click="addCustomTurnServer">
              {{ t('settings.calls.addTurnServer') }}
            </button>
          </template>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.calls.devices') }}</h4>
          <div class="settings-select">
            <span>{{ t('settings.calls.microphone') }}</span>
            <SelectMenu :aria-label="t('settings.calls.microphone')" :model-value="messenger.state.selectedAudioInputId" :options="microphoneOptions"
              @update:model-value="messenger.setAudioInput(String($event))" />
          </div>

          <div class="settings-select">
            <span>{{ t('settings.calls.speakers') }}</span>
            <SelectMenu :aria-label="t('settings.calls.speakers')" :model-value="messenger.state.selectedAudioOutputId" :options="speakerOptions"
              @update:model-value="messenger.setAudioOutput(String($event))" />
          </div>

          <div class="settings-select">
            <span>{{ t('settings.calls.camera') }}</span>
            <SelectMenu :aria-label="t('settings.calls.camera')" :model-value="messenger.state.selectedVideoInputId" :options="cameraOptions"
              @update:model-value="onVideoInputChanged(String($event))" />
          </div>

          <div class="settings-camera-preview">
            <video ref="cameraPreviewRef" autoplay muted playsinline></video>
            <div v-if="!cameraPreviewActive && !cameraPreviewError" class="settings-camera-preview__empty">
              {{ t('settings.calls.cameraPreview') }}
            </div>
            <div v-if="cameraPreviewError" class="settings-camera-preview__error">{{ cameraPreviewError }}</div>
          </div>

          <div class="settings-camera-actions">
            <button type="button" class="btn settings-btn" :class="{ 'icon-btn--active': cameraPreviewActive }"
              :disabled="cameraPreviewLoading" @click="cameraPreviewActive ? stopCameraPreview() : startCameraPreview()">
              {{ cameraPreviewLoading ? t('settings.calls.startingCamera') : cameraPreviewActive ?
                t('settings.calls.stopCameraPreview') : t('settings.calls.startCameraPreview') }}
            </button>
            <button type="button" class="btn settings-btn" :disabled="messenger.state.audioDevicesLoading"
              @click="messenger.unlockAudioDevices">
              {{ messenger.state.audioDevicesLoading ? t('settings.calls.checkingDevices') :
                t('settings.calls.allowDevices') }}
            </button>
          </div>

          <p class="settings-note" v-if="messenger.state.audioDevicesPermission !== 'granted'">
            {{ t('settings.calls.devicesNote') }}
          </p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.calls.advanced') }}</h4>
          <label class="settings-range">
            <span>{{ t('settings.calls.micThreshold') }}</span>
            <small>{{ t('settings.calls.micThresholdHint') }}</small>
            <div class="settings-meter" :class="{ 'is-active': messenger.state.micTestActive }">
              <span class="settings-meter__bar" :style="{ width: `${messenger.state.micTestLevel}%` }"></span>
              <span class="settings-meter__threshold"
                :style="{ left: `${messenger.state.microphoneThreshold}%` }"></span>
            </div>
            <input type="range" min="0" max="100" step="1" :value="messenger.state.microphoneThreshold"
              @input="messenger.setMicrophoneThreshold(targetValue($event))" />
            <strong>{{ messenger.state.microphoneThreshold }}</strong>
          </label>
          <button type="button" class="btn settings-btn" :class="{ 'icon-btn--active': messenger.state.micTestActive }"
            :disabled="messenger.state.micTestLoading" @click="messenger.startMicTest">
            {{ messenger.state.micTestLoading ? t('settings.calls.startingMic') : messenger.state.micTestActive ?
              t('settings.calls.stopListening') : t('settings.calls.testMic') }}
          </button>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.calls.screenShare') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.calls.shareScreenAudio') }}</span>
            <input type="checkbox" :checked="messenger.state.shareScreenAudio"
              @change="messenger.setShareScreenAudio(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">
            {{ t('settings.calls.shareScreenAudioNote') }}
          </p>
        </div>
      </section>

      <section v-else-if="activeSection === 'tor'" class="settings-page">
        <!-- Desktop Web: the option only works on the Tauri desktop build. -->
        <div v-if="!isTorRuntime()" class="tor-only-desktop">
          <img class="tor-only-desktop__icon" src="/icons/tor.svg" alt="" aria-hidden="true" />
          <h4 class="tor-only-desktop__title">{{ t('settings.tor.title') }}</h4>
          <p class="tor-only-desktop__copy">{{ t('settings.tor.desktopOnly') }}</p>
          <a class="btn btn--primary tor-only-desktop__cta"
            href="https://qxch.at/download" target="_blank" rel="noopener noreferrer">
            {{ t('settings.tor.downloadDesktop') }}
          </a>
        </div>

        <template v-else>
          <div class="settings-group">
            <h4>{{ t('settings.tor.title') }}</h4>
            <label class="settings-check settings-check--readonly" :aria-disabled="true">
              <span>{{ t('settings.tor.enabled') }}</span>
              <input type="checkbox" :checked="messenger.state.torEnabled" disabled />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
            <p class="settings-note">{{ t('settings.tor.enabledNote') }}</p>
            <p class="settings-note settings-note--pro">{{ t('settings.tor.trayNote') }}</p>

            <p v-if="torStatus" class="settings-note">
              <template v-if="torStatus.phase === 'bootstrapping'">
                {{ t('settings.tor.bootstrapping') }}
              </template>
              <template v-else-if="torStatus.phase === 'error'">
                {{ t('settings.tor.error', { error: torStatus.error || torError }) }}
              </template>
              <template v-else-if="torStatus.running">
                {{ t('settings.tor.running', { port: String(torStatus.port) }) }}
              </template>
              <template v-else>
                {{ t('settings.tor.stopped') }}
              </template>
            </p>
            <p v-if="isExternalTor" class="settings-note settings-note--warn">
              {{ t('settings.tor.externalNote') }}
            </p>
            <p v-if="torError && torStatus?.phase !== 'error'" class="settings-note" style="color: var(--red)">
              {{ t('settings.tor.error', { error: torError }) }}
            </p>
          </div>

          <div v-if="circuit?.hops?.length" class="settings-group">
            <h4>{{ t('settings.tor.circuit') }}</h4>
            <p class="settings-note tor-circuit-note">{{ t('settings.tor.circuitNote') }}</p>

            <WorldMap v-if="circuitPoints.length" :points="circuitPoints" connect />

            <div class="tor-circuit">
              <div v-if="geo?.client" class="tor-circuit__hop tor-circuit__hop--you">
                <div class="tor-circuit__role">{{ t('settings.tor.role.you') }}</div>
                <div class="tor-circuit__ident">
                  <span v-if="geo.client.countryCode" class="tor-circuit__flag" :title="countryNameEnglish(geo.client.countryCode)">{{ countryFlag(geo.client.countryCode) }}</span>
                  <span class="tor-circuit__ip">{{ maskIpFirstBlock(geo.client.ip) || '-' }}</span>
                </div>
              </div>
              <div v-if="geo?.client" class="tor-circuit__arrow">→</div>

              <template v-for="(hop, i) in circuit.hops" :key="i">
                <div class="tor-circuit__hop">
                  <div class="tor-circuit__role">{{ t(`settings.tor.role.${hop.role}`) }}</div>
                  <div class="tor-circuit__ident">
                    <span v-if="hopCountryCode(hop)" class="tor-circuit__flag" :title="countryNameEnglish(hopCountryCode(hop))">{{ countryFlag(hopCountryCode(hop)) }}</span>
                    <span v-if="hop.nickname && hop.nickname !== 'Unnamed'" class="tor-circuit__nick">{{ hop.nickname }}</span>
                    <span class="tor-circuit__ip">{{ hop.ip || '-' }}</span>
                  </div>
                </div>
                <div v-if="i < circuit.hops.length - 1" class="tor-circuit__arrow">→</div>
              </template>
            </div>
          </div>

        </template>

        <div class="settings-group">
          <h4>{{ t('settings.tor.relays') }}</h4>
          <p class="settings-note">{{ t('settings.tor.relaysNote') }}</p>

          <div class="tor-relay-toolbar" :class="{ 'tor-relay-toolbar--disabled': !isTorRuntime() }">
            <input
              v-model="relaySearch"
              class="settings-input tor-relay-search"
              type="search"
              :placeholder="t('settings.tor.searchPlaceholder')"
              :aria-label="t('settings.tor.searchPlaceholder')"
              :disabled="!isTorRuntime()"
            />
            <button type="button" class="btn settings-btn" :disabled="!isTorRuntime() || relaysLoading"
              @click="requestRelays">
              {{ relaysLoading ? t('settings.tor.loading') : t('settings.tor.refresh') }}
            </button>
          </div>
          <p v-if="!isTorRuntime()" class="settings-note tor-relay-desktop-only">
            {{ t('settings.tor.relaysDesktopOnly') }}
          </p>
          <p v-if="relays.length" class="settings-note tor-relay-count">
            {{ t('settings.tor.resultsCount', { shown: String(filteredRelays.length), total: String(relays.length) }) }}
          </p>

          <p v-if="relaysError" class="settings-note" style="color: var(--red)">
            {{ t('settings.tor.relaysError', { error: relaysError }) }}
          </p>

          <ul v-if="filteredRelays.length" class="tor-relay-list">
            <li v-for="relay in filteredRelays" :key="relay.fingerprint" class="tor-relay">
              <div class="tor-relay__head">
                <span class="tor-relay__flag" :title="relay.countryName">{{ countryFlag(relay.country) }}</span>
                <strong class="tor-relay__nickname">{{ relay.nickname }}</strong>
                <span class="tor-relay__flags">
                  <span v-for="flag in relay.flags" :key="flag" class="tor-relay__flag-tag">{{ relayFlagLabel(flag) }}</span>
                </span>
              </div>
              <div class="tor-relay__meta">
                <span class="tor-relay__address">{{ relay.address || '-' }}</span>
                <span v-if="relay.asName" class="tor-relay__as">{{ relay.asName }}</span>
              </div>
              <a class="tor-relay__link" :href="relayDetailUrl(relay.fingerprint)"
                target="_blank" rel="noopener noreferrer">
                {{ t('settings.tor.details') }}
              </a>
            </li>
          </ul>
          <p v-else-if="!relaysLoading && relays.length" class="settings-note">
            {{ t('settings.tor.noSearchResults') }}
          </p>
        </div>
      </section>

      <section v-else-if="activeSection === 'advanced'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.advanced.connection') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.advanced.autoReconnect') }}</span>
            <input type="checkbox" :checked="messenger.state.autoReconnectEnabled"
              @change="messenger.setAutoReconnectEnabled(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <label class="settings-check">
            <span>{{ t('settings.advanced.serverClears') }}</span>
            <input type="checkbox" v-model="messenger.state.serverClearsLocalMessages"
              @change="messenger.setServerClearsLocalMessages(messenger.state.serverClearsLocalMessages)" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">
            {{ t('settings.advanced.serverClearsNote') }}
          </p>
          <label class="settings-check">
            <span>{{ t('settings.advanced.serverDefaultRoom') }}</span>
            <input type="checkbox" :checked="messenger.state.allowServerDefaultRoom"
              @change="messenger.setAllowServerDefaultRoom(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.advanced.uploads') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.advanced.autoArchive') }}</span>
            <input type="checkbox" :checked="messenger.state.autoArchiveUploads"
              @change="messenger.setAutoArchiveUploads(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">
            {{ t('settings.advanced.autoArchiveNote') }}
          </p>
          <label class="settings-check">
            <span>{{ t('settings.advanced.renameUploads') }}</span>
            <input type="checkbox" :checked="messenger.state.renameUploadsRandomly"
              @change="messenger.setRenameUploadsRandomly(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">
            {{ t('settings.advanced.renameUploadsNote') }}
          </p>
          <label class="settings-check">
            <span>{{ t('settings.advanced.stripExif') }}</span>
            <input type="checkbox" :checked="messenger.state.stripImageExif"
              @change="messenger.setStripImageExif(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">
            {{ t('settings.advanced.stripExifNote') }}
          </p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.privacy.title') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.privacy.deleteOnLeave') }}</span>
            <input type="checkbox" :checked="messenger.state.deleteMessagesOnLeave"
              @change="messenger.setDeleteMessagesOnLeave(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <label class="settings-check">
            <span>{{ t('settings.privacy.streamerMode') }}</span>
            <input type="checkbox" :checked="messenger.state.streamerMode"
              @change="messenger.setStreamerMode(targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <p class="settings-note">
            {{ t('settings.privacy.streamerNote') }}
          </p>
          <label class="settings-check">
            <span>{{ t('settings.advanced.disableTypingSend') }}</span>
            <input type="checkbox" :checked="!messenger.state.typingIndicatorsEnabled"
              @change="messenger.setTypingIndicatorsEnabled(!targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
        </div>

        <div v-if="isTorRuntime()" class="settings-group">
          <h4>{{ t('settings.advanced.discordRpc.title') }}</h4>
          <template v-if="discordRpcReady">
            <label class="settings-check">
              <span>{{ t('settings.advanced.discordRpc.enabled') }}</span>
              <input type="checkbox" :checked="discordRpcEnabled"
                @change="toggleDiscordRpcEnabled(targetChecked($event))" />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
            <p class="settings-note">
              {{ t('settings.advanced.discordRpc.enabledNote') }}
            </p>
            <label class="settings-check">
              <span>{{ t('settings.advanced.discordRpc.showPlatform') }}</span>
              <input type="checkbox" :checked="discordRpcShowPlatform"
                @change="toggleDiscordRpcShowPlatform(targetChecked($event))" />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </label>
            <p class="settings-note">
              {{ t('settings.advanced.discordRpc.showPlatformNote') }}
            </p>
            <p class="settings-note">
              {{ discordRpcConnected
                ? t('settings.advanced.discordRpc.connected')
                : t('settings.advanced.discordRpc.disconnected') }}
            </p>
          </template>
          <p v-else class="settings-note">
            {{ t('settings.advanced.discordRpc.unavailable') }}
          </p>
        </div>
      </section>

      <section v-else-if="activeSection === 'admin'" class="settings-page">
        <AdminSettings :messenger="messenger" />
      </section>

      <section v-else-if="activeSection === 'phantom'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t("phantom.requests") }}</h4>
          <div class="settings-select">
            <span>{{ t("phantom.acceptUnknown") }}</span>
            <SelectMenu :aria-label="t('phantom.acceptUnknown')" :model-value="phantom.state.acceptUnknown" :options="acceptUnknownOptions"
              @update:model-value="phantom.setAcceptUnknown(String($event))" />
          </div>
          <p class="settings-note">{{ t("phantom.usernameWarning") }}</p>
        </div>
        <div class="settings-group">
          <h4>{{ t("phantom.blocked") }}</h4>
          <p v-if="!phantom.state.blockList.length" class="settings-note">{{ t("phantom.noBlocked") }}</p>
          <div v-else class="phantom-blocked-list">
            <div v-for="fp in phantom.state.blockList" :key="fp" class="phantom-blocked-row">
              <code>{{ fp }}</code>
              <button type="button" class="btn settings-btn" @click="phantom.unblockUser(fp)">{{ t("phantom.unblock") }}</button>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <h4>{{ t("phantom.polling") }}</h4>
          <label class="settings-check">
            <span>{{ t("phantom.pollingToggle") }}</span>
            <span class="toggle" :class="{ 'is-on': phantom.state.pollingEnabled }">
              <input type="checkbox" :checked="phantom.state.pollingEnabled"
                @change="phantom.setPollingEnabled(($event.target as HTMLInputElement).checked)" />
              <span class="toggle__track"><span class="toggle__thumb"></span></span>
            </span>
          </label>
          <p class="settings-note settings-note--danger">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <span>{{ t("phantom.pollUniformityNote") }}</span>
          </p>
          <label class="settings-select">
            <span>{{ t("phantom.pollInterval") }}</span>
            <input class="settings-input" type="number" min="3" max="40" step="1" inputmode="numeric"
              :value="phantom.state.pollIntervalSeconds ?? ''" :placeholder="t('phantom.pollIntervalAuto')"
              :disabled="!phantom.state.pollingEnabled" @change="onPollIntervalChange" />
          </label>
          <p class="settings-note">{{ t("phantom.pollIntervalHint") }}</p>
          <p v-if="!phantom.state.pollingEnabled" class="settings-note">{{ t("phantom.pollingNote") }}</p>
        </div>
      </section>
      <section v-else-if="activeSection === 'backups'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.backups.title') }}</h4>
          <p class="settings-note">{{ t('settings.backups.note') }}</p>
          <div class="settings-actions">
            <button type="button" class="btn settings-btn" @click="onExport">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12" />
                <path d="m6 9 6-6 6 6" />
                <path d="M5 21h14" />
              </svg>
              {{ t('settings.backups.export') }}
            </button>
            <button type="button" class="btn settings-btn" @click="onImport">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 21V9" />
                <path d="m6 15 6 6 6-6" />
                <path d="M5 3h14" />
              </svg>
              {{ t('settings.backups.import') }}
            </button>
            <button type="button" class="btn settings-btn settings-btn--danger" @click="onClear">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="m5 6 1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
              </svg>
              {{ t('settings.backups.clear') }}
            </button>
          </div>
        </div>
        <input ref="fileInputRef" type="file" accept="application/json,.json" style="display: none"
          @change="onFilePicked" />
      </section>

      <section v-else-if="activeSection === 'donation'" class="settings-page">
        <div class="settings-group">
          <div class="donation-hero">
            <svg class="donation-hero__heart" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21s-7.5-4.7-9.8-9.2C.4 8.6 2.7 5 6.5 5c2.2 0 3.9 1.2 5.5 3.2C13.6 6.2 15.3 5 17.5 5c3.8 0 6.1 3.6 4.3 6.8C19.5 16.3 12 21 12 21Z" />
            </svg>
            <h4>{{ t('settings.donation.title') }}</h4>
            <p class="settings-note">{{ t('settings.donation.subtitle') }}</p>
          </div>
        </div>
        <div class="settings-group">
          <ul class="donation-list">
            <li v-for="item in donationAddresses" :key="item.id" class="donation-row">
              <div class="donation-row__meta">
                <strong class="donation-row__network">{{ item.network }}</strong>
                <code class="donation-row__address">{{ item.address }}</code>
              </div>
              <button type="button" class="btn settings-btn donation-row__copy" @click="copyDonationAddress(item.address)">
                {{ t('settings.donation.copy') }}
              </button>
            </li>
          </ul>
          <p class="settings-note">{{ t('settings.donation.note') }}</p>
        </div>
      </section>

      <section v-else class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.about.licenses') }}</h4>
          <div class="about-hero">
          <svg class="about-hero__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v18" />
            <path d="m19 8 3 8a5 5 0 0 1-6 0zV7" />
            <path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" />
            <path d="m5 8 3 8a5 5 0 0 1-6 0zV7" />
            <path d="M7 21h10" />
          </svg>
          </div>
          <div v-if="badgesLoaded" class="about-badges">
            <a v-for="repo in githubRepos" :key="repo.slug" :href="repo.url" target="_blank" rel="noopener noreferrer" class="about-badge-link">
              <img :src="repo.licenseBadge" :alt="`${repo.slug} license`" loading="lazy" referrerpolicy="no-referrer" />
            </a>
          </div>
          <div v-else class="about-badges-cta">
            <button type="button" class="btn settings-btn" @click="requestBadges">
              {{ t('settings.about.loadBadges') }}
            </button>
          </div>
          <p class="about-quote">{{ t('settings.about.quote') }}</p>
          <p class="about-quote__author">- {{ t('settings.about.quoteAuthor') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.about.topContributors') }}</h4>
          <template v-if="topContributors.length">
            <ul class="about-contributors">
              <li v-for="contributor in topContributors" :key="contributor.login" class="about-contributor">
                <a :href="contributor.html_url" target="_blank" rel="noopener noreferrer" class="about-contributor__link">
                  <img class="about-contributor__avatar" :src="contributor.avatar_url" :alt="contributor.login" loading="lazy" referrerpolicy="no-referrer" />
                  <span class="about-contributor__meta">
                    <span class="about-contributor__name-row">
                      <strong class="about-contributor__name">{{ contributor.login }}</strong>
                      <span v-if="contributorRole(contributor.login)" class="about-contributor__role">{{ contributorRole(contributor.login) }}</span>
                    </span>
                    <small class="about-contributor__count">{{ contributor.contributions }} {{ t('settings.about.commits') }}</small>
                  </span>
                </a>
              </li>
            </ul>
          </template>
          <template v-else>
            <p v-if="contributorsError" class="settings-note">{{ t('settings.about.contributorsError') }}</p>
            <button type="button" class="btn settings-btn" :disabled="contributorsLoading" @click="requestContributors">
              {{ contributorsLoading ? t('settings.about.loading') : t('settings.about.loadContributors') }}
            </button>
          </template>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.about.overview') }}</h4>
          <dl class="settings-kv">
            <div>
              <dt>{{ t('settings.about.userId') }}</dt>
              <dd>{{ messenger.state.userId || "-" }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.status') }}</dt>
              <dd>{{ connectionStatusLabel }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.joinedRooms') }}</dt>
              <dd>{{ messenger.state.joinedRooms.length }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.savedRooms') }}</dt>
              <dd>{{ messenger.state.rooms.length }}</dd>
            </div>
          </dl>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.about.developer') }}</h4>
          <dl class="settings-kv">
            <div>
              <dt>{{ t('settings.about.appVersion') }}</dt>
              <dd>{{ runtimeDetails.appVersion }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.platform') }}</dt>
              <dd>{{ runtimeDetails.platform }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.os') }}</dt>
              <dd>{{ runtimeDetails.os }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.mobile') }}</dt>
              <dd>{{ runtimeDetails.mobile ? t('settings.about.yes') : t('settings.about.no') }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.secureContext') }}</dt>
              <dd>{{ runtimeDetails.secureContext ? t('settings.about.yes') : t('settings.about.no') }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.online') }}</dt>
              <dd>{{ runtimeDetails.online ? t('settings.about.yes') : t('settings.about.no') }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.language') }}</dt>
              <dd>{{ runtimeDetails.language }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.timezone') }}</dt>
              <dd>{{ runtimeDetails.timezone }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.serverOrigin') }}</dt>
              <dd>{{ runtimeDetails.serverOrigin }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.apiBaseUrl') }}</dt>
              <dd>{{ runtimeDetails.apiBaseUrl }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.wsUrl') }}</dt>
              <dd>{{ runtimeDetails.wsUrl }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.turnUser') }}</dt>
              <dd>{{ runtimeDetails.turnUser }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.turnHost') }}</dt>
              <dd>{{ runtimeDetails.turnHost }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.turnRemote') }}</dt>
              <dd>{{ runtimeDetails.turnRemote ? t('settings.about.yes') : t('settings.about.no') }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.turnSecure') }}</dt>
              <dd>{{ runtimeDetails.turnSecure ? t('settings.about.yes') : t('settings.about.no') }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.turnPassword') }}</dt>
              <dd>{{ runtimeDetails.turnPassword }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.about.userAgent') }}</dt>
              <dd>{{ runtimeDetails.userAgent }}</dd>
            </div>
          </dl>

          <div v-if="isTauri" style="display: flex; justify-content: center; margin-top: 16px;">
            <button
              type="button"
              class="settings-btn settings-btn--secondary"
              style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 20px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 10px;"
              @click="triggerCheckUpdatesEvent"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {{ t('updater.checkUpdates') }}
            </button>
          </div>
        </div>
      </section>
    </main>

    <Transition name="save-bar">
      <div v-if="isOpen && activeSection === 'profile' && hasUnsavedChanges" class="settings-save-bar">
        <span class="settings-save-bar__hint">{{ t('settings.profile.unsavedChanges') }}</span>
        <button type="button" class="settings-save-bar__revert" @click="revertProfileDrafts">
          {{ t('settings.profile.revert') }}
        </button>
        <button type="button" class="settings-save-bar__btn" :disabled="nameChanged && !nameValid" @click="saveAll">
          {{ t('settings.profile.save') }}
        </button>
      </div>
    </Transition>
    </div>
  </Transition>

  <ImageCropModal
    :open="crop?.open || false"
    :src="crop?.src || ''"
    :title="crop?.kind === 'banner' ? t('crop.titleBanner') : t('crop.titleAvatar')"
    :aspect="crop?.kind === 'banner' ? 21 / 9 : 1"
    :mime-type="crop?.mimeType || 'image/png'"
    :max-width="crop?.kind === 'banner' ? 2560 : 2048"
    :max-height="crop?.kind === 'banner' ? 1097 : 2048"
    @cancel="onCropCancel"
    @confirm="onCropConfirm"
  />
</template>

<style scoped>
@media (max-width: 820px) {
  .settings.settings-enter-active,
  .settings.settings-leave-active {
    transition: opacity 200ms ease, transform 240ms cubic-bezier(0.16, 0.8, 0.2, 1);
  }

  .settings.settings-enter-from,
  .settings.settings-leave-to {
    opacity: 0;
    transform: translateY(100%);
  }
}

:global(.app.app--desktop-titlebar) .settings.settings-enter-active,
:global(.app.app--desktop-titlebar) .settings.settings-leave-active,
:global(.app.is-tauri) .settings.settings-enter-active,
:global(.app.is-tauri) .settings.settings-leave-active,
:global(.app.is-web-titlebar) .settings.settings-enter-active,
:global(.app.is-web-titlebar) .settings.settings-leave-active {
  transition: none !important;
  transform: none !important;
}

.turn-server-detail {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--color-bg-input, rgba(255,255,255,0.04));
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.turn-server-detail__urls {
  font-size: 12px;
  color: var(--color-text-dim, #888);
  font-family: monospace;
  word-break: break-all;
}

.turn-server-detail__hint {
  font-size: 11px;
  color: var(--color-text-dim, #999);
  line-height: 1.4;
}

.custom-turn-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.custom-turn-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-input, rgba(255,255,255,0.04));
}

.custom-turn-row__info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.custom-turn-row__info strong {
  font-size: 13px;
  color: var(--color-text, #e5e5e5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-turn-row__info small {
  font-size: 11px;
  color: var(--color-text-dim, #888);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-turn-row .icon-btn {
  flex: none;
  width: 28px;
  height: 28px;
}

.turn-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
}

.turn-form-field:first-of-type {
  margin-top: 16px;
}

.turn-form-field .settings-field {
  min-height: 0;
  gap: 0;
}

.turn-form-submit {
  margin-top: 16px;
}

.settings-note--error {
  color: var(--red, #ff6b70);
}

/* ---- Tor connectivity ---- */
.tor-only-desktop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
  padding: 40px 24px;
}

.tor-only-desktop__icon {
  width: 96px;
  height: 96px;
  object-fit: contain;
}

.tor-only-desktop__title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--text, #f4f4f5);
}

.tor-only-desktop__copy {
  max-width: 420px;
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--muted, #8a8a90);
}

.tor-only-desktop__cta {
  margin-top: 8px;
  text-decoration: none;
}

.tor-relay-toolbar {
  display: flex;
  gap: 8px;
  margin: 16px 0 0;
}

.tor-relay-search {
  flex: 1;
  min-width: 0;
}

/* On phone, the global mobile styles force every `.settings-btn` to `width:
   100%`, which makes the refresh button hijack the whole toolbar row. Keep it
   compact so it sits beside the search input instead. */
@media (max-width: 640px) {
  .tor-relay-toolbar .settings-btn {
    width: auto;
    flex: 0 0 auto;
    white-space: nowrap;
  }
}

.tor-relay-toolbar--disabled .settings-input,
.tor-relay-toolbar--disabled .settings-btn {
  opacity: 0.45;
  cursor: not-allowed;
}

.tor-relay-desktop-only {
  margin-top: 10px;
}

.tor-relay-count {
  margin-top: 8px;
}

.tor-relay-list {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 46vh;
  overflow-y: auto;
}

.tor-circuit {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  margin-top: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.tor-circuit-note {
  margin-bottom: 14px;
}
.tor-circuit__hop {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface, #2c2c2e) 70%, transparent);
  border: 1px solid var(--line, rgba(255, 255, 255, 0.04));
  min-width: 0;
  flex: none;
}
.tor-circuit__role {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent, #2090ea);
}
.tor-circuit__ip {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--text, #f4f4f5);
}
.tor-circuit__ident {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.tor-circuit__flag {
  font-size: 14px;
  line-height: 1;
}
.tor-circuit__nick {
  font-size: 11px;
  color: var(--muted, #8a8a90);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tor-circuit__arrow {
  color: var(--muted, #8a8a90);
  flex: none;
}

.tor-relay {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.04));
  border-radius: 12px;
  background: var(--surface-2, #3a3a3d);
}

.tor-relay__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tor-relay__flag {
  font-size: 16px;
  line-height: 1;
  flex: none;
}

.tor-relay__nickname {
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #f4f4f5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tor-relay__flags {
  display: flex;
  gap: 4px;
  flex: none;
  margin-left: auto;
}

.tor-relay__flag-tag {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #2090ea) 16%, transparent);
  color: var(--accent, #2090ea);
}

.tor-relay__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  color: var(--muted, #8a8a90);
}

.tor-relay__address {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.tor-relay__as {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tor-relay__link {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent, #2090ea);
  text-decoration: none;
  align-self: flex-start;
}

.tor-relay__link:hover {
  text-decoration: underline;
}

.phantom-blocked-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.phantom-blocked-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.phantom-blocked-row code {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.donation-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 8px 0 4px;
}

.donation-hero__heart {
  width: 46px;
  height: 46px;
  fill: var(--accent, #2090ea);
  flex: none;
}

.donation-hero h4 {
  margin: 0;
}

.donation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.donation-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.06));
  background: var(--surface-2, #2c2c2e);
}

.donation-row__meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.donation-row__network {
  font-size: 13px;
  font-weight: 700;
  color: var(--text, #f4f4f5);
}

.donation-row__address {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted, #8a8a90);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.donation-row__copy {
  flex: none;
}

@media (max-width: 640px) {
  .donation-row {
    flex-direction: column;
    align-items: stretch;
  }
}

.about-hero {
  display: flex;
  justify-content: center;
  padding: 12px 0 4px;
}

.about-hero__icon {
  width: 46px;
  height: 46px;
  color: var(--muted, #8a8a90);
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.about-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: center;
}

.about-badges-cta {
  display: flex;
  justify-content: center;
}

.about-hero + .settings-group {
  border-top: 0;
}

.about-quote {
  padding-top: 32px;
  margin: 0;
  font-style: italic;
  line-height: 1.65;
  color: var(--muted, #8a8a90);
  white-space: pre-line;
}

.about-quote__author {
  margin: 10px 0 0;
  font-style: italic;
  font-weight: 600;
  color: var(--text, #f4f4f5);
  text-align: right;
}

.about-badge-link {
  display: inline-flex;
  height: 20px;
  line-height: 0;
}

.about-badge-link img {
  height: 20px;
  display: block;
}

.about-contributors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.about-contributor__link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--line, rgba(255, 255, 255, 0.06));
  background: var(--surface-2, #2c2c2e);
  text-decoration: none;
}

.about-contributor__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface, #1b1b1d);
  flex: none;
}

.about-contributor__meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-contributor__name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #f4f4f5);
}

.about-contributor__name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.about-contributor__role {
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent, #2090ea) 16%, transparent);
  color: var(--accent, #2090ea);
  white-space: nowrap;
}

.about-contributor__count {
  font-size: 12px;
  color: var(--muted, #8a8a90);
}

.about-contributor__link:hover {
  border-color: var(--line-strong, rgba(255, 255, 255, 0.12));
}

.recovery-signed {
  color: var(--green) !important;
}

.recovery-unsigned {
  color: var(--red) !important;
  font-weight: 600;
}

/* Barre flottante « Modifications repérées [Sauvegarder] » */
.settings-save-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 240;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: calc(100vw - 32px);
  padding: 10px 12px 10px 18px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface, #1d2129) 94%, transparent);
  border: 1px solid var(--line-strong);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}

.settings-save-bar__hint {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}

/* The quiet way out, beside the primary action rather than competing with it. */
.settings-save-bar__revert {
  flex: none;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 140ms ease-out, color 140ms ease-out,
    transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.settings-save-bar__revert:hover {
  background: color-mix(in srgb, var(--text) 9%, transparent);
  color: var(--text);
}

.settings-save-bar__revert:active {
  transform: scale(.96);
}

.settings-save-bar__btn {
  flex: none;
  padding: 8px 16px;
  border-radius: 999px;
  border: 0;
  background: var(--accent, #2090ea);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 140ms ease-out, transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.settings-save-bar__btn:active:not(:disabled) {
  transform: scale(.96);
}

.settings-save-bar__btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {

  .settings-save-bar__revert,
  .settings-save-bar__btn {
    transition-duration: .01ms;
  }

  .settings-save-bar__revert:active,
  .settings-save-bar__btn:active:not(:disabled) {
    transform: none;
  }
}

.settings-save-bar__btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #2090ea) 85%, black 15%);
}

.settings-save-bar__btn:active:not(:disabled) {
  transform: scale(0.97);
}

.settings-save-bar__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.save-bar-enter-active,
.save-bar-leave-active {
  transition: opacity 160ms ease, transform 200ms cubic-bezier(0.16, 0.8, 0.2, 1);
}

.save-bar-enter-from,
.save-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
</style>
