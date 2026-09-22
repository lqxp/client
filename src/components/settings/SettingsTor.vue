<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import type { useDialog } from "@/composables/useDialog";
import { onTorStatus, getCircuit, getGeo, getGeoIp, torStatus as fetchTorStatus, isTauriDesktopRuntime as isTorRuntime, type CircuitPath, type GeoInfo, type TorStatus } from "@/calls/tor";
import { relayDetailUrl } from "@/calls/torRelays";
import { countryCoord } from "@/calls/geo";
import WorldMap from "@/components/WorldMap.vue";
import type { MapPoint } from "@/components/worldMapTypes";
import { useTorDirectory } from "@/components/settings/torDirectory";

defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;
const { relays, loading: relaysLoading, error: relaysError, consent: relaysConsent, load: loadRelays, autoLoad } = useTorDirectory();

type HopGeo = { lat: number | null; lng: number | null; countryCode: string | null };

const torStatus = ref<TorStatus | null>(null);
const circuit = ref<CircuitPath | null>(null);
const geo = ref<GeoInfo | null>(null);
const relayGeo = ref<Record<string, HopGeo>>({});
const relaySearch = ref("");

const torReady = computed(() => torStatus.value?.phase === "ready" && torStatus.value?.mode === "embedded");
const isExternalTor = computed(() => torStatus.value?.mode === "external");

function countryFlag(code: string | null | undefined): string {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🏳️";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

function relayFlagLabel(flag: string): string {
  const key = `settings.tor.flags.${flag}`;
  const label = t(key);
  return label === key ? flag : label;
}

function countryNameEnglish(code: string | null | undefined): string {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(c) ?? "";
  } catch {
    return c;
  }
}

function maskIpFirstBlock(ip: string | null | undefined): string {
  const s = String(ip || "").trim();
  if (!s) return "";
  if (s.includes(":")) {
    const first = s.split(":").find((p) => p.length > 0);
    return first ? `${first}:x:x:x:x:x:x:x` : "x:x:x:x:x:x:x:x";
  }
  const firstOctet = s.split(".").find((p) => /^[0-9a-fA-FxX]+$/.test(p) && p !== "xxx");
  return `${firstOctet || "x"}.x.x.x`;
}

function hopCountryCode(hop: CircuitPath["hops"][number]): string | null {
  return hop.country ?? (hop.ip ? relayGeo.value[hop.ip]?.countryCode ?? null : null);
}

const filteredRelays = computed(() => {
  const q = relaySearch.value.trim().toLowerCase();
  if (!q) return relays.value;
  return relays.value.filter((r) =>
    [r.nickname, r.address, r.asName, r.asNumber, r.countryName, r.country]
      .map((s) => String(s || "").toLowerCase())
      .some((s) => s.includes(q)),
  );
});

const circuitPoints = computed<MapPoint[]>(() => {
  const pts: MapPoint[] = [];
  const client = geo.value?.client;
  if (client?.latitude != null && client?.longitude != null) {
    pts.push({
      lat: client.latitude,
      lng: client.longitude,
      color: "#3fcf6f",
      label: [t("settings.tor.role.you"), client.ip].filter(Boolean).join(" · "),
    });
  }

  for (const hop of circuit.value?.hops ?? []) {
    const exact = hop.ip ? relayGeo.value[hop.ip] : undefined;
    const coord = exact && exact.lat != null && exact.lng != null
      ? ([exact.lat, exact.lng] as [number, number])
      : countryCoord(hopCountryCode(hop));
    if (!coord) continue;
    const name = hop.nickname && hop.nickname !== "Unnamed" ? hop.nickname : t(`settings.tor.role.${hop.role}`);
    pts.push({ lat: coord[0], lng: coord[1], role: hop.role, label: [name, hop.ip].filter(Boolean).join(" · ") });
  }

  const server = geo.value?.server;
  if (server?.latitude != null && server?.longitude != null) {
    pts.push({
      lat: server.latitude,
      lng: server.longitude,
      color: "#f43f5e",
      label: ["qxch.at", server.ip].filter(Boolean).join(" · "),
    });
  }

  // Hosted in Reykjavik; the address stays hidden.
  pts.push({ lat: 64.1466, lng: -21.9426, color: "#f59e0b", label: t("settings.tor.ourServer") });
  return pts;
});

async function loadGeo() {
  try {
    geo.value = await getGeo();
  } catch {
    geo.value = null;
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
          return [hop.ip, { lat: point.latitude, lng: point.longitude, countryCode: point.countryCode ?? null }] as const;
        }
      } catch {
        // The country centroid stands in.
      }
      return null;
    }),
  );
  const next: Record<string, HopGeo> = {};
  for (const entry of entries) {
    if (entry) next[entry[0]] = entry[1];
  }
  relayGeo.value = next;
}

async function loadCircuit() {
  try {
    circuit.value = await getCircuit();
    await loadRelayGeo(circuit.value);
  } catch {
    circuit.value = null;
  }
}

async function requestRelays() {
  if (!relaysConsent.value) {
    const confirmed = await dialog.showConfirm(t("settings.tor.relaysConfirm"), t("settings.tor.relaysConfirmTitle"));
    if (!confirmed) return;
    relaysConsent.value = true;
  }
  await loadRelays();
}

watch(torReady, (ready) => {
  if (!ready) return;
  void loadCircuit();
  void loadGeo();
  autoLoad();
});

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  if (!isTorRuntime()) return;
  unsubscribe = onTorStatus((s) => {
    torStatus.value = s;
  });
  fetchTorStatus().then((s) => {
    torStatus.value = s;
  }).catch(() => {});
  autoLoad();
});

onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <section class="settings-page">
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
            {{ t('settings.tor.error', { error: torStatus.error }) }}
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
</template>

<style scoped>
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

/* The global mobile rule stretches every .settings-btn to full width. */
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
</style>
