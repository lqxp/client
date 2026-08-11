<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import BadgeIcon from "@/components/BadgeIcon.vue";
import { useI18n, LOCALE_LABELS } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import { appRuntimeConfig, rtcRuntimeConfig, turnServerList } from "@/config/runtime";

const i18n = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const { t, locale, availableLocales } = i18n;
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

const props = defineProps({
  messenger: { type: Object, required: true },
  initialSection: { type: String, default: "profile" }
});

const draftName = ref(props.messenger.state.username || "");
const draftDescription = ref(props.messenger.state.profile?.description || "");
const draftPronouns = ref(props.messenger.state.profile?.pronouns || "");
const fileInputRef = ref(null);
const avatarInputRef = ref(null);
const bannerInputRef = ref(null);
const firstInputRef = ref(null);
const cameraPreviewRef = ref<HTMLVideoElement | null>(null);
const activeSection = ref("profile");
const mobileSectionOpen = ref(false);
const settingsSearch = ref("");
const adminUserSearch = ref("");
const adminBadgeDrafts = ref<Record<string, string>>({});
const adminBadgeMenus = ref<Record<string, boolean>>({});
const adminCustomBadgeDrafts = ref<Record<string, string>>({});
const isMobileSettings = ref(false);
const lockPin = ref("");
const lockPinConfirm = ref("");
const duressPin = ref("");
const duressPinConfirm = ref("");
const lockPinLength = computed(() => Number(props.messenger.state.clientLockPinLength) || 6);
const lockPinPlaceholder = computed(() => "•".repeat(lockPinLength.value));
const lockPinLabel = computed(() => t('settings.security.pinDigits', { count: String(lockPinLength.value) }));
const autolockOptions = computed(() => props.messenger.clientLockAutolockTimeoutsMs || []);

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
const nameValid = computed(() => !props.messenger.validateUsername(draftName.value));
const meAccent = computed(() => props.messenger.accentFor(props.messenger.state.username || "you"));
const meInitials = computed(() => initialsOf(props.messenger.state.username));
const profile = computed(() => props.messenger.myProfile.value);
const turnServers = computed(() => turnServerList());
const selectedTurnInfo = computed(() => {
  const id = props.messenger.state.selectedTurnServerId;
  if (!id) return null;
  const srv = turnServers.value.find((s: any) => s.id === id);
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

function formatServerUrls(server: any) {
  return (server.urls || []).map((u: string) => formatTurnUrl(u)).join(" · ");
}
const avatarSrc = computed(() => props.messenger.profileImageSrc(profile.value.avatar, "avatar"));
const bannerSrc = computed(() => props.messenger.profileImageSrc(profile.value.banner, "banner"));
const profileTextChanged = computed(() =>
  draftDescription.value.trim() !== String(profile.value.description || "").trim()
  || draftPronouns.value.trim() !== String(profile.value.pronouns || "").trim()
);
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
  { id: "advanced", label: t("settings.sections.advanced") },
  { id: "admin", label: t("settings.sections.admin") },
  { id: "backups", label: t("settings.sections.backups") },
  { id: "about", label: t("settings.sections.about") }
]);
const sections = computed(() => allSections.value.filter((section) => section.id !== "admin" || props.messenger.state.admin));
const filteredSections = computed(() => {
  const query = settingsSearch.value.trim().toLowerCase();
  if (!query) return sections.value;
  return sections.value.filter((section) => section.label.toLowerCase().includes(query));
});
const activeSectionLabel = computed(() => sections.value.find((section) => section.id === activeSection.value)?.label || "Settings");
const adminUsers = computed(() => props.messenger.state.adminOverview?.users || []);
const filteredAdminUsers = computed(() => {
  const query = adminUserSearch.value.trim().toLowerCase();
  if (!query) return [];
  return adminUsers.value.filter((user: any) => String(user?.username || "").toLowerCase().includes(query));
});

const systemBadgeIds = new Set(["staff", "system"]);
const suggestedAdminBadges = [
  { id: "early", label: "Early QxChat User" },
  { id: "vip", label: "VIP" },
  { id: "mod", label: "Mod" },
  { id: "contributor", label: "Contributor" },
  { id: "artist", label: "Artist" },
  { id: "bug_hunter", label: "Bug Hunter" },
  { id: "bug_hunter_lvl_2", label: "Golden Bug Hunter" }
];

function adminBadgesFor(user: any): string[] {
  return Array.isArray(user?.badges) ? user.badges.map((badge) => String(badge || "").trim()).filter(Boolean) : [];
}

function customAdminBadgesFor(user: any): string[] {
  return adminBadgesFor(user).filter((badge) => !systemBadgeIds.has(badge));
}

function adminBadgeDraftFor(user: any): string[] {
  const key = String(user?.id || "");
  if (!key) return [];
  if (!(key in adminBadgeDrafts.value)) {
    adminBadgeDrafts.value[key] = customAdminBadgesFor(user).join(",");
  }
  return parseBadgeDraft(adminBadgeDrafts.value[key]);
}

function setAdminBadgeDraft(user: any, badges: string[]) {
  const key = String(user?.id || "");
  if (!key) return;
  adminBadgeDrafts.value[key] = parseBadgeDraft(badges.join(",")).join(",");
}

function parseBadgeDraft(value: string) {
  return [...new Set(String(value || "")
    .split(/[\s,]+/)
    .map((badge) => badge.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean))];
}

function adminBadgeSelected(user: any, badge: string) {
  return adminBadgeDraftFor(user).includes(badge);
}

function toggleAdminBadge(user: any, badge: string) {
  const current = new Set(adminBadgeDraftFor(user));
  if (current.has(badge)) current.delete(badge);
  else current.add(badge);
  setAdminBadgeDraft(user, [...current]);
}

function customBadgeDraftFor(user: any) {
  return adminCustomBadgeDrafts.value[String(user?.id || "")] || "";
}

function setCustomBadgeDraft(user: any, value: string) {
  const key = String(user?.id || "");
  if (!key) return;
  adminCustomBadgeDrafts.value[key] = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
}

function addCustomAdminBadge(user: any) {
  const key = String(user?.id || "");
  const badge = customBadgeDraftFor(user).trim();
  if (!key || !badge) return;
  setAdminBadgeDraft(user, [...adminBadgeDraftFor(user), badge]);
  adminCustomBadgeDrafts.value[key] = "";
}

function removeAdminBadge(user: any, badge: string) {
  setAdminBadgeDraft(user, adminBadgeDraftFor(user).filter((item) => item !== badge));
}

function adminBadgeMenuOpen(user: any) {
  return Boolean(adminBadgeMenus.value[String(user?.id || "")]);
}

function toggleAdminBadgeMenu(user: any) {
  const key = String(user?.id || "");
  if (!key) return;
  adminBadgeMenus.value[key] = !adminBadgeMenus.value[key];
}

function adminBadgesChanged(user: any) {
  return adminBadgeDraftFor(user).join(",") !== customAdminBadgesFor(user).join(",");
}

async function saveAdminBadges(user: any) {
  const userId = String(user?.id || "");
  if (!userId || !adminBadgesChanged(user)) return;
  const badges = adminBadgeDraftFor(user);
  const saved = await props.messenger.setAdminUserBadges?.(userId, badges);
  if (saved) {
    adminBadgeDrafts.value[userId] = badges.join(",");
    adminBadgeMenus.value[userId] = false;
  }
}

async function deleteAdminUser(user: any) {
  const userId = String(user?.id || "");
  const username = String(user?.username || userId);
  if (!userId || userId === String(props.messenger.state.userId || "")) return;
  if (!await dialog.showConfirm(t('settings.admin.deleteConfirm', { username }))) return;
  await props.messenger.deleteAdminUser?.(userId);
}

watch(isOpen, async (v) => {
  if (v) {
    mobileSectionOpen.value = false;
    settingsSearch.value = "";
    adminUserSearch.value = "";
    draftName.value = props.messenger.state.username || "";
    draftDescription.value = props.messenger.state.profile?.description || "";
    draftPronouns.value = props.messenger.state.profile?.pronouns || "";
    if (sections.value.some((section) => section.id === props.initialSection)) {
      activeSection.value = props.initialSection;
    }
    if (activeSection.value === "calls") props.messenger.refreshAudioDevices();
    await nextTick();
  }
});

watch(activeSection, async (section) => {
  if (!isOpen.value) return;
  if (section === "calls") props.messenger.refreshAudioDevices();
  if (section === "admin") props.messenger.loadAdminOverview();
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
  await props.messenger.changeUsername(draftName.value.trim());
  draftName.value = props.messenger.state.username || "";
}

function saveProfileText() {
  if (!profileTextChanged.value) return;
  props.messenger.setProfileText({
    description: draftDescription.value,
    pronouns: draftPronouns.value
  });
}

function onAvatarPicked(event) {
  const file = event.target.files?.[0];
  if (file) props.messenger.setProfileImageFromFile("avatar", file);
  event.target.value = "";
}

function onBannerPicked(event) {
  const file = event.target.files?.[0];
  if (file) props.messenger.setProfileImageFromFile("banner", file);
  event.target.value = "";
}

function onExport() { props.messenger.exportData(); }
function onImport() { fileInputRef.value?.click(); }
function onFilePicked(event) {
  const file = event.target.files?.[0];
  if (file) props.messenger.importData(file);
  event.target.value = "";
}
async function onClear() {
  if (!await dialog.showConfirm("Clear all local data? This removes every conversation, message, and reaction from this browser. The remote server is not touched.")) return;
  props.messenger.clearAllData();
  close();
}

function onLogout() {
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
    .catch(async (err: any) => {
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

const browserLanguage = computed(() => navigator.language || "—");

const runtimeDetails = computed(() => {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
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
    turnUser: rtcRuntimeConfig.turnUsername || "—",
    turnHost: rtcRuntimeConfig.turnUrls[0] || "—",
    turnRemote: rtcRuntimeConfig.relayOnly,
    turnSecure: rtcRuntimeConfig.turnUrls.some((url) => String(url).trim().toLowerCase().startsWith("turns:")),
    turnPassword: rtcRuntimeConfig.turnCredential || "—"
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
  if (isMobileSettings.value && mobileSectionOpen.value) backToSettingsList();
  else close();
}

function syncMobileSettings() {
  isMobileSettings.value = window.matchMedia("(max-width: 820px)").matches;
}

onMounted(() => {
  syncMobileSettings();
  window.addEventListener("resize", syncMobileSettings, { passive: true });
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", syncMobileSettings);
  document.removeEventListener("keydown", onKey);
  stopCameraPreview();
});
</script>

<template>
  <div v-if="isOpen" class="settings" :class="{ 'settings--section-open': mobileSectionOpen }" role="dialog"
    aria-modal="true" aria-labelledby="settings-title">
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
        <span>
          <strong>@{{ messenger.state.username || "anonymous" }}</strong>
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
          @click="messenger.logoutAccount(); close()">
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
          <span v-else class="avatar settings-profile__avatar" :class="`avatar--${meAccent}`">{{ meInitials }}</span>
          <div class="settings-profile__actions">
            <button type="button" class="btn settings-profile__photo" @click="avatarInputRef?.click()">{{
              t('settings.profile.profileImage') }}</button>
            <button type="button" class="btn settings-profile__photo" @click="bannerInputRef?.click()">{{
              t('settings.profile.banner') }}</button>
            <button v-if="profile.avatar" type="button" class="btn settings-profile__photo"
              @click="messenger.clearProfileImage('avatar')">{{ t('settings.profile.clearImage') }}</button>
            <button v-if="profile.banner" type="button" class="btn settings-profile__photo"
              @click="messenger.clearProfileImage('banner')">{{ t('settings.profile.clearBanner') }}</button>
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
          <label class="settings-field">
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
            <input ref="firstInputRef" v-model="draftName" type="text" maxlength="32" autocomplete="off"
              spellcheck="false" placeholder="@echo" class="settings-input" @keydown.enter.prevent="saveName" />
            <button type="button" class="btn btn--primary settings-btn" :disabled="!nameValid || !nameChanged"
              @click="saveName">{{ t('settings.profile.save') }}</button>
          </div>
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
          <label class="settings-select settings-select--offset">
            <span class="sr-only">Status</span>
            <select :value="messenger.state.status" @change="messenger.setPresenceStatus(targetValue($event))">
              <option value="online">{{ t('sidebar.online') }}</option>
              <option value="invisible">{{ t('sidebar.invisible') }}</option>
              <option value="dnd">{{ t('sidebar.dnd') }}</option>
            </select>
          </label>
        </div>


        <div class="settings-group">
          <label class="settings-field">
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
          <textarea v-model="draftDescription" class="settings-input settings-textarea"
            :maxlength="messenger.MAX_PROFILE_DESCRIPTION_LENGTH" spellcheck="true" rows="4"
            :placeholder="t('settings.profile.descriptionPlaceholder')"></textarea>
        </div>

        <div class="settings-group">
          <label class="settings-field">
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
            <input v-model="draftPronouns" type="text" :maxlength="messenger.MAX_PROFILE_PRONOUNS_LENGTH"
              autocomplete="off" spellcheck="false" :placeholder="t('settings.profile.pronounsPlaceholder')"
              class="settings-input" @keydown.enter.prevent="saveProfileText" />
            <button type="button" class="btn btn--primary settings-btn" :disabled="!profileTextChanged"
              @click="saveProfileText">{{ t('settings.profile.save') }}</button>
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
          <label class="settings-select">
            <span>{{ t('settings.ui.themeLabel') }}</span>
            <select :value="messenger.state.themeMode" @change="messenger.setThemeMode(targetValue($event))">
              <option value="system">{{ t('settings.ui.system') }}</option>
              <option value="dark">{{ t('settings.ui.dark') }}</option>
              <option value="light">{{ t('settings.ui.light') }}</option>
              <option value="adaptive">{{ t('settings.ui.adaptive') }}</option>
            </select>
          </label>
          <p class="settings-note">{{ t('settings.ui.adaptiveNote') }}</p>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.ui.colors') }}</h4>
          <label class="settings-select">
            <span>{{ t('settings.ui.accentColor') }}</span>
            <select :value="messenger.state.appAccent" @change="messenger.setAppAccent(targetValue($event))">
              <option value="blue">{{ t('settings.ui.blue') }}</option>
              <option value="violet">{{ t('settings.ui.violet') }}</option>
              <option value="emerald">{{ t('settings.ui.emerald') }}</option>
              <option value="rose">{{ t('settings.ui.rose') }}</option>
              <option value="amber">{{ t('settings.ui.amber') }}</option>
            </select>
          </label>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.ui.messages') }}</h4>
          <label class="settings-select">
            <span>{{ t('settings.ui.messageShape') }}</span>
            <select :value="messenger.state.messageStyle" @change="messenger.setMessageStyle(targetValue($event))">
              <option value="bubble">{{ t('settings.ui.bubbles') }}</option>
              <option value="discord">{{ t('settings.ui.discord') }}</option>
            </select>
          </label>
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
          <label class="settings-select">
            <span>{{ t('settings.language.appLanguage') }}</span>
            <select v-model="locale">
              <option v-for="localeCode in availableLocales" :key="localeCode" :value="localeCode">
                {{ LOCALE_LABELS[localeCode] || localeCode }}
              </option>
            </select>
          </label>
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
              <dd>{{ messenger.state.userId || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.security.username') }}</dt>
              <dd>{{ messenger.state.username || "—" }}</dd>
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
          <h4>{{ t('settings.security.clientLock') }}</h4>
          <div v-if="!messenger.state.clientLockEnabled" class="settings-lock-form">
            <label class="settings-select">
              <span>{{ lockPinLabel }}</span>
              <select v-model.number="messenger.state.clientLockPinLength">
                <option :value="4">4</option>
                <option :value="6">6</option>
                <option :value="8">8</option>
              </select>
            </label>
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
            <label class="settings-select">
              <span>{{ t('settings.security.autolockThreshold') }}</span>
              <select :value="messenger.state.clientLockAutolockTimeoutMs"
                :disabled="!messenger.state.clientLockAutolockEnabled"
                @change="messenger.setClientLockAutolockTimeoutMs(targetNumber($event))">
                <option v-for="ms in autolockOptions" :key="ms" :value="ms">
                  {{ autolockLabel(ms) }}
                </option>
              </select>
            </label>
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
          <label class="settings-select">
            <span>{{ t('settings.opsec.duressAction') }}</span>
            <select :value="messenger.state.opsecDuressAction"
              @change="messenger.setOpsecDuressAction(targetValue($event))">
              <option value="wipe">{{ t('settings.opsec.actionWipe') }}</option>
              <option value="decoy">{{ t('settings.opsec.actionDecoy') }}</option>
            </select>
          </label>
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
          <label class="settings-select">
            <span>{{ t('settings.calls.relayServer') }}</span>
            <select
              :value="messenger.state.selectedTurnServerId"
              @change="messenger.setSelectedTurnServer(targetValue($event))"
            >
              <option v-for="srv in turnServers" :key="srv.id" :value="srv.id">
                {{ srv.label }}
              </option>
            </select>
          </label>
          <div v-if="selectedTurnInfo" class="turn-server-detail">
            <span class="turn-server-detail__urls">{{ selectedTurnInfo.urls }}</span>
            <small v-if="selectedTurnInfo.hint" class="turn-server-detail__hint">{{ selectedTurnInfo.hint }}</small>
          </div>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.calls.devices') }}</h4>
          <label class="settings-select">
            <span>{{ t('settings.calls.microphone') }}</span>
            <select :value="messenger.state.selectedAudioInputId"
              @change="messenger.setAudioInput(targetValue($event))">
              <option value="">{{ t('settings.calls.systemDefault') }}</option>
              <option v-for="(device, index) in microphones" :key="device.deviceId || `mic-${index}`"
                :value="device.deviceId">
                {{ deviceLabel(device, `Microphone ${Number(index) + 1}`) }}
              </option>
            </select>
          </label>

          <label class="settings-select">
            <span>{{ t('settings.calls.speakers') }}</span>
            <select :value="messenger.state.selectedAudioOutputId"
              @change="messenger.setAudioOutput(targetValue($event))">
              <option value="">{{ t('settings.calls.systemDefault') }}</option>
              <option v-for="(device, index) in headphones" :key="device.deviceId || `speaker-${index}`"
                :value="device.deviceId">
                {{ deviceLabel(device, `Output ${Number(index) + 1}`) }}
              </option>
            </select>
          </label>

          <label class="settings-select">
            <span>{{ t('settings.calls.camera') }}</span>
            <select :value="messenger.state.selectedVideoInputId" @change="onVideoInputChanged(targetValue($event))">
              <option value="">{{ t('settings.calls.systemDefault') }}</option>
              <option v-for="(device, index) in cameras" :key="device.deviceId || `camera-${index}`"
                :value="device.deviceId">
                {{ deviceLabel(device, `${t('settings.calls.camera')} ${Number(index) + 1}`) }}
              </option>
            </select>
          </label>

          <div class="settings-camera-preview">
            <video ref="cameraPreviewRef" autoplay muted playsinline></video>
            <div v-if="!cameraPreviewActive && !cameraPreviewError" class="settings-camera-preview__empty">
              {{ t('settings.calls.cameraPreview') }}
            </div>
            <div v-if="cameraPreviewError" class="settings-camera-preview__error">{{ cameraPreviewError }}</div>
          </div>
          <button type="button" class="btn settings-btn" :class="{ 'icon-btn--active': cameraPreviewActive }"
            :disabled="cameraPreviewLoading" @click="cameraPreviewActive ? stopCameraPreview() : startCameraPreview()">
            {{ cameraPreviewLoading ? t('settings.calls.startingCamera') : cameraPreviewActive ?
              t('settings.calls.stopCameraPreview') : t('settings.calls.startCameraPreview') }}
          </button>

          <p class="settings-note" v-if="messenger.state.audioDevicesPermission !== 'granted'">
            {{ t('settings.calls.devicesNote') }}
          </p>
          <button type="button" class="btn settings-btn" :disabled="messenger.state.audioDevicesLoading"
            @click="messenger.unlockAudioDevices">
            {{ messenger.state.audioDevicesLoading ? t('settings.calls.checkingDevices') :
              t('settings.calls.allowDevices') }}
          </button>
        </div>

        <div class="settings-group">
          <h4>{{ t('settings.calls.advanced') }}</h4>
          <label class="settings-range">
            <span>{{ t('settings.calls.micThreshold') }}</span>
            <small>{{ t('settings.calls.micThresholdHint') }}</small>
            <div class="settings-meter">
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
      </section>

      <section v-else-if="activeSection === 'admin'" class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.admin.title') }}</h4>
          <button type="button" class="btn settings-btn" :disabled="messenger.state.adminLoading"
            @click="messenger.loadAdminOverview">
            {{ messenger.state.adminLoading ? t('settings.admin.loading') : t('settings.admin.refresh') }}
          </button>
          <dl class="settings-kv" v-if="messenger.state.adminOverview">
            <div>
              <dt>{{ t('settings.admin.online') }}</dt>
              <dd>{{ messenger.state.adminOverview.onlineCount }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.admin.users') }}</dt>
              <dd>{{ messenger.state.adminOverview.users?.length || 0 }}</dd>
            </div>
            <div>
              <dt>{{ t('settings.admin.rooms') }}</dt>
              <dd>{{ messenger.state.adminOverview.rooms?.length || 0 }}</dd>
            </div>
          </dl>
        </div>

        <div class="settings-group" v-if="messenger.state.adminOverview?.features">
          <h4>{{ t('settings.admin.features') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.admin.registrations') }}</span>
            <input type="checkbox" :checked="messenger.state.adminOverview.features.registerEnabled"
              @change="messenger.setAdminFeature('registerEnabled', targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <label class="settings-check">
            <span>{{ t('settings.admin.calls') }}</span>
            <input type="checkbox" :checked="messenger.state.adminOverview.features.callsEnabled"
              @change="messenger.setAdminFeature('callsEnabled', targetChecked($event))" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
        </div>

        <div class="settings-group" v-if="messenger.state.adminOverview?.users?.length">
          <h4>{{ t('settings.admin.users') }}</h4>
          <input v-model="adminUserSearch" class="settings-input admin-user-search" type="search" autocomplete="off"
            spellcheck="false" :placeholder="t('settings.admin.searchUsers')" />
          <p v-if="!adminUserSearch.trim()" class="settings-note">{{ t('settings.admin.searchUsersNote') }}</p>
          <p v-else-if="!filteredAdminUsers.length" class="settings-note">{{ t('settings.admin.noUsersFound') }}</p>
          <div v-if="filteredAdminUsers.length" class="admin-list">
            <div v-for="user in filteredAdminUsers" :key="user.id" class="admin-row admin-row--user">
              <div class="admin-row__identity">
                <strong>{{ user.username }}</strong>
                <small>
                  {{ user.id }}
                  <template v-if="user.admin"> · admin</template>
                  <template v-if="user.banned"> · {{ t('settings.admin.banned') }}</template>
                  <template v-else-if="user.disabled"> · {{ t('settings.admin.disabled') }}</template>
                  <template v-else> · {{ messenger.presenceStatusLabel(user.status) }}</template>
                </small>
              </div>
              <div class="admin-row__controls">
                <div class="admin-badge-editor">
                  <span>{{ t('settings.admin.badges') }}</span>
                  <button type="button" class="admin-badge-menu-button" @click="toggleAdminBadgeMenu(user)">
                    <span v-if="adminBadgeDraftFor(user).length" class="admin-badge-selection">
                      <span v-for="badge in adminBadgeDraftFor(user)" :key="`${user.id}-draft-${badge}`">{{ badge
                        }}</span>
                    </span>
                    <span v-else class="admin-badge-placeholder">{{ t('settings.admin.badgesPlaceholder') }}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <div v-if="adminBadgeMenuOpen(user)" class="admin-badge-menu">
                    <button v-for="badge in suggestedAdminBadges" :key="`${user.id}-option-${badge.id}`" type="button"
                      class="admin-badge-option" :class="{ 'is-selected': adminBadgeSelected(user, badge.id) }"
                      @click="toggleAdminBadge(user, badge.id)">


                      <BadgeIcon v-if="badge.id === 'early'" badge="early" class="admin-badge-option__icon" />
                      <svg v-if="badge.id === 'bug_hunter'" class="admin-badge-option__icon" viewBox="0 0 24 24"
                        aria-hidden="true">
                        <path
                          d="m16.5822 2.63812s7.6721 5.23623 4.7567 12.58868c-2.9154 7.3525-8.7142 5.313-6.5469 3.1648 2.1674-2.1482-2.5573-3.6059-5.58143-6.3935l7.36523-9.35998"
                          fill="#3ba55c" />
                        <path
                          d="m16.1155 9.83717c-1.6175 2.05873-3.9 3.08803-5.6646 2.71723l-6.15684 7.8447c-.10362.1324-.23231.243-.37871.3256-.1464.0825-.30764.1354-.47451.1556-.16686.0202-.33606.0073-.49793-.038-.16187-.0452-.31322-.122-.44541-.2258-.13374-.1032-.2457-.2319-.32942-.3786s-.13754-.3086-.15834-.4762c-.02081-.1677-.00819-.3378.03712-.5005s.12242-.3149.22687-.4476l6.12492-7.832c-.81197-1.62394-.36443-4.11099 1.27869-6.18886 2.03946-2.58295 5.11476-3.54836 6.89856-2.15459 1.7837 1.39377 1.5664 4.61607-.4604 7.19902z"
                          fill="#b4e1cd" />
                      </svg>


                      <svg v-if="badge.id === 'bug_hunter_lvl_2'" class="admin-badge-option__icon" viewBox="0 0 24 24"
                        aria-hidden="true">
                        <mask id="bug-hunter-lvl2-mask" height="19" maskUnits="userSpaceOnUse" width="16" x="2" y="2">
                          <path
                            d="m16.1438 9.84735c-1.6048 2.04975-3.9088 3.08265-5.7044 2.70125l-6.14926 7.8813c-.44491.572-1.22351.6356-1.79554.1907-.57203-.445-.63558-1.2235-.25423-1.7956l6.1493-7.8177c-.82626-1.60486-.38135-4.09954 1.28707-6.21286 2.04976-2.57413 5.11646-3.52751 6.91196-2.19278 1.7956 1.33473 1.5413 4.6239-.4449 7.24569z"
                            fill="#ffd56c" />
                        </mask>
                        <path
                          d="m16.5888 2.60168s7.6906 5.25949 4.7351 12.63232c-2.9555 7.3728-8.7235 5.323-6.5307 3.1461s-2.5582-3.591-5.57726-6.4194z"
                          fill="#ffeac0" />
                        <path
                          d="m16.1438 9.84735c-1.6048 2.04975-3.9088 3.08265-5.7044 2.70125l-6.14926 7.8813c-.44491.572-1.22351.6356-1.79554.1907-.57203-.445-.63558-1.2235-.25423-1.7956l6.1493-7.8177c-.82626-1.60486-.38135-4.09954 1.28707-6.21286 2.04976-2.57413 5.11646-3.52751 6.91196-2.19278 1.7956 1.33473 1.5413 4.6239-.4449 7.24569z"
                          fill="#ffd56c" />
                        <g fill="#fff" mask="url(#bug-hunter-lvl2-mask)">
                          <path d="m13.0389-1.26782.7405.09754-3.1567 23.96118-.74043-.0976z" />
                          <path d="m14.2822-1.51801 1.6226.21377-3.1566 23.96114-1.6226-.2137z" />
                        </g>
                      </svg>
                      <svg v-else-if="badge.id === 'mod'" class="admin-badge-option__icon" viewBox="0 0 24 24"
                        aria-hidden="true">
                        <path
                          d="m17.2719 3h-9.54383c-.14912 1.9386-1.78947 3.42982-3.72807 3.42982v.89474c0 4.39914 2.08772 8.50004 5.74123 11.40794l2.75877 2.1622 2.7588-2.1622c3.6535-2.8334 5.7412-7.0088 5.7412-11.40794v-.89474c-1.9386 0-3.5044-1.49122-3.7281-3.42982zm-6.4868 12.8991c-2.23685-1.7895-3.57896-4.3245-3.57896-7.08331v-.52193c1.19298 0 2.23684-.89474 2.3114-2.08772h2.98246v11.10966z"
                          fill="#FC964B" />
                      </svg>
                      <svg v-else-if="badge.id === 'vip'" class="admin-badge-option__icon" viewBox="0 0 24 24"
                        fill="none" aria-hidden="true">
                        <path d="M4 6C4 4.89543 4.89543 4 6 4H18C19.1046 4 20 4.89543 20 6V10.4H4V6Z" fill="#E4D9EA" />
                        <path d="M4 18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V13.6H4V18Z"
                          fill="#0E60EF" />
                        <path d="M4 10.4H20V13.6H4V10.4Z" fill="#F0B14B" />
                        <path
                          d="M15.7333 12C15.7333 14.0619 14.0619 15.7333 12 15.7333C9.93813 15.7333 8.26666 14.0619 8.26666 12C8.26666 9.93813 9.93813 8.26666 12 8.26666C14.0619 8.26666 15.7333 9.93813 15.7333 12Z"
                          fill="#0F182D" />
                        <path
                          d="M13.6 12C13.6 12.8837 12.8837 13.6 12 13.6C11.1164 13.6 10.4 12.8837 10.4 12C10.4 11.1164 11.1164 10.4 12 10.4C12.8837 10.4 13.6 11.1164 13.6 12Z"
                          fill="#E4D9EA" />
                      </svg>
                      <svg v-else-if="badge.id === 'contributor'" class="admin-badge-option__icon" viewBox="0 0 24 24"
                        aria-hidden="true">
                        <g fill="#5865f2">
                          <path
                            d="m16.6033 9.15179-2.4908 1.66051c-.249.2491-.6642.1661-.7472 0-.2491-.2491-.6642-.4151-.9133-.4982-.6642-.166-1.2454 0-1.7435.2491l-.83027.5812-4.64945 2.9889c-.99631.6642-2.2417.4152-2.9059-.6642-.66421-1.0793-.24908-2.2417.74723-2.8228l5.31365-3.65318c1.49447-.83026 3.23804-1.24539 4.89854-.83026 1.4114.24907 2.6568.99631 3.4871 2.15867.249.16605.249.66421-.1661.83026z" />
                          <path
                            d="m22 11.6425c0 .7473-.4152 1.4115-.9963 1.7436l-5.4797 3.5701c-.9964.6642-2.2417.9963-3.4041.9963-.4982 0-.9963 0-1.4114-.166-1.41148-.2491-2.49081-1.1624-3.48712-2.1587-.16606-.1661-.16606-.6642.16605-.7473l2.49077-1.6605c.2491-.249.6642-.166.7472 0 .2491.2491.4982.4152.9133.4982.6642.166 1.2454 0 1.7436-.2491l1.2453-.7472 3.7362-2.4908.4982-.41513c.9963-.6642 2.2417-.41512 2.9059.66423.166.4151.3321.7472.3321 1.1623z" />
                        </g>
                      </svg>
                      <svg v-else-if="badge.id === 'artist'" class="admin-badge-option__icon" viewBox="0 0 24 24"
                        aria-hidden="true">
                        <g fill="#fbb848">
                          <path
                            d="m21.5912 6.84349-7.8694 5.16551c-.1351.088-.2444.2103-.317.3543l-1.1997 2.4056c-.0174.0399-.0461.0739-.0825.0977-.0364.0239-.079.0366-.1226.0366s-.0862-.0127-.1226-.0366c-.0364-.0238-.0651-.0578-.0825-.0977l-1.1997-2.4056c-.0726-.144-.1819-.2663-.317-.3543l-7.86944-5.16551c-.03957-.04698-.09618-.07632-.15738-.08157-.0612-.00524-.12198.01404-.16896.0536-.04698.03957-.07633.09618-.08157.15738-.00525.0612.01403.12198.0536.16896l3.28825 6.39624c.01598.0335.02385.0703.02297.1074s-.01049.0734-.02804.1061c-.01756.0327-.04257.0608-.07301.082-.03043.0212-.06544.035-.10219.0402h-1.97668c-.04881-.0005-.0965.0146-.13617.043-.03967.0285-.06926.0688-.08449.1152s-.0153.0964-.00022.1428c.01509.0464.04455.0869.08413.1154l8.8142 6.3155c.0403.0275.088.0422.1368.0422s.0965-.0147.1368-.0422l8.8142-6.3155c.0396-.0285.069-.069.0841-.1154s.015-.0964-.0002-.1428-.0448-.0867-.0845-.1152c-.0396-.0284-.0873-.0435-.1362-.043h-1.9766c-.0389-.0015-.0769-.0126-.1105-.0323-.0335-.0197-.0617-.0474-.082-.0806s-.0321-.071-.0343-.1098c-.0022-.0389.0052-.0777.0216-.113l3.3132-6.39624c.0395-.04698.0588-.10776.0536-.16896-.0053-.0612-.0346-.11781-.0816-.15738-.047-.03956-.1078-.05884-.169-.0536-.0612.00525-.1178.03459-.1574.08157z" />
                          <path
                            d="m12.1741 2.10696.8081 1.64723c.0143.02721.0346.05084.0594.06913.0247.01829.0533.03078.0835.03654l1.8213.26107c.0356.00524.0691.02036.0966.04366s.0479.05383.0589.08814.0122.07102.0034.10595c-.0089.03494-.0273.06671-.0532.0917l-1.3178 1.28049c-.0213.02203-.0373.04854-.047.07758s-.0127.05988-.009.09025l.3108 1.80885c.0069.03487.0036.07096-.0094.10404-.013.03307-.0351.06174-.0639.08264-.0287.0209-.0628.03315-.0983.03532-.0354.00217-.0708-.00584-.1019-.02309l-1.6285-.85159c-.0265-.01527-.0565-.02331-.0871-.02331-.0305 0-.0605.00804-.087.02331l-1.6286.85159c-.031.01725-.0664.02526-.1019.02309-.0354-.00217-.0695-.01442-.0983-.03532-.0287-.0209-.0509-.04957-.0639-.08264-.0129-.03308-.0162-.06917-.0094-.10404l.3108-1.80885c.0038-.03037.0008-.06121-.0089-.09025s-.0258-.05555-.047-.07758l-1.31781-1.28049c-.02595-.02499-.04438-.05676-.05318-.0917-.00881-.03493-.00764-.07164.00336-.10595s.03141-.06484.05889-.08814c.02749-.0233.06095-.03842.0966-.04366l1.82124-.25485c.0303-.00576.0588-.01825.0836-.03654.0247-.01829.045-.04192.0594-.06913l.8081-1.64723c.015-.03321.0392-.06147.0696-.08149.0305-.02003.066-.03101.1025-.03166.0364-.00065.0723.00905.1035.02798.0311.01893.0563.0463.0725.07895z" />
                        </g>
                      </svg>
                      <span>{{ badge.label }}</span>
                      <small>{{ badge.id }}</small>
                    </button>
                    <div v-if="adminBadgeDraftFor(user).length" class="admin-badge-current">
                      <span v-for="badge in adminBadgeDraftFor(user)" :key="`${user.id}-remove-${badge}`">
                        {{ badge }}
                        <button type="button" @click="removeAdminBadge(user, badge)">×</button>
                      </span>
                    </div>
                    <div class="admin-badge-custom">
                      <input class="settings-input" type="text" :value="customBadgeDraftFor(user)" maxlength="32"
                        placeholder="custom_badge" @input="setCustomBadgeDraft(user, targetValue($event))"
                        @keydown.enter.prevent="addCustomAdminBadge(user)" />
                      <button type="button" class="btn settings-btn" :disabled="!customBadgeDraftFor(user)"
                        @click="addCustomAdminBadge(user)">
                        Add
                      </button>
                    </div>
                  </div>
                </div>
                <div class="settings-actions settings-actions--wrap">
                  <button type="button" class="btn settings-btn" :disabled="!adminBadgesChanged(user)"
                    @click="saveAdminBadges(user)">
                    {{ t('settings.admin.saveBadges') }}
                  </button>
                  <button type="button" class="btn settings-btn" :class="{ 'settings-btn--danger': !user.disabled }"
                    @click="messenger.setAdminUserDisabled(user.id, !user.disabled)">
                    {{ user.disabled ? t('settings.admin.enable') : t('settings.admin.disable') }}
                  </button>
                  <button type="button" class="btn settings-btn" :class="{ 'settings-btn--danger': !user.banned }"
                    @click="messenger.setAdminUserBanned(user.id, !user.banned)">
                    {{ user.banned ? t('settings.admin.pardon') : t('settings.admin.ban') }}
                  </button>
                  <button type="button" class="btn settings-btn settings-btn--danger"
                    :disabled="user.id === messenger.state.userId" @click="deleteAdminUser(user)">
                    {{ t('settings.admin.delete') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-group" v-if="messenger.state.adminOverview?.rooms?.length">
          <h4>{{ t('settings.admin.rooms') }}</h4>
          <div class="admin-list">
            <div v-for="room in messenger.state.adminOverview.rooms" :key="room.roomId" class="admin-row">
              <div>
                <strong>{{ messenger.displayRoomName(room.roomId) }}</strong>
                <small>
                  {{ room.messageCount }} messages · {{ room.onlineCount || 0 }} online · {{ room.voiceCount || 0 }}
                  voice
                  <template v-if="room.active"> · active</template>
                </small>
              </div>
            </div>
          </div>
          <p class="settings-note">{{ t('settings.admin.roomsNote') }}</p>
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

      <section v-else class="settings-page">
        <div class="settings-group">
          <h4>{{ t('settings.about.title') }}</h4>
          <dl class="settings-kv">
            <div>
              <dt>{{ t('settings.about.userId') }}</dt>
              <dd>{{ messenger.state.userId || "—" }}</dd>
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
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
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
</style>
