<script setup lang="ts">
import Avatar from "@/components/Avatar.vue";
import { initialsOf } from "@/utils/initials";
import type { Phantom } from "@/composables/usePhantom";
import Icon from "@/components/Icon.vue";
import { errorMessage, type Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, onMounted, onBeforeUnmount, ref, watch } from "vue";
import AdminSettings from "@/components/AdminSettings.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import BadgeIcon from "@/components/BadgeIcon.vue";
import { badgeLabel as badgeLabelFor } from "@/config/badges";
import { useI18n, LOCALE_LABELS } from "@/composables/useI18n";
import { useDialog } from "@/composables/useDialog";
import { useUpdater } from "@/composables/useUpdater";
import { appRuntimeConfig, TurnServerConfig, turnServerList } from "@/config/runtime";
import SettingsTor from "@/components/settings/SettingsTor.vue";
import ColorPicker from "@/components/ColorPicker.vue";
import SettingsCalls from "@/components/settings/SettingsCalls.vue";
import SettingsNotifications from "@/components/settings/SettingsNotifications.vue";
import SettingsSecurity from "@/components/settings/SettingsSecurity.vue";
import SettingsAdvanced from "@/components/settings/SettingsAdvanced.vue";
import SettingsOpsec from "@/components/settings/SettingsOpsec.vue";
import ImageCropModal from "@/components/ImageCropModal.vue";
import { isAnimatedImage } from "@/utils/animatedImage";
import { takePickedFile } from "@/utils/pickedFile";
import { binaryFingerprint, interfaceFingerprint } from "@/utils/buildFingerprint";
import { decodeTheme, encodeTheme, setCustomTheme, setCustomThemeEnabled, useCustomTheme, type CustomTheme } from "@/composables/useCustomTheme";

const i18n = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const { t, locale, availableLocales } = i18n;
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;
const phantom = inject<Phantom>("phantom")!;
const { isTauri, triggerCheckUpdatesEvent } = useUpdater();

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true },
  initialSection: { type: String, default: "profile" }
});

const draftName = ref(props.messenger.state.username || "");
const draftDescription = ref(props.messenger.state.profile?.description || "");
const draftPronouns = ref(props.messenger.state.profile?.pronouns || "");
const draftStatus = ref(props.messenger.state.profile?.customStatus || "");
const draftLinks = ref((props.messenger.state.profile?.links || []).map((link) => ({ ...link })));
const linksKey = (links: { label: string; url: string }[]) =>
  JSON.stringify(links.map((link) => [link.label.trim(), link.url.trim()]).filter(([, url]) => url));
const fileInputRef = ref<HTMLInputElement | null>(null);
const avatarInputRef = ref<HTMLInputElement | null>(null);
const bannerInputRef = ref<HTMLInputElement | null>(null);
const firstInputRef = ref<HTMLInputElement | null>(null);
const crop = ref<{ open: boolean; src: string; kind: "avatar" | "banner"; mimeType: string } | null>(null);
const activeSection = ref("profile");
const mobileSectionOpen = ref(false);
const settingsSearch = ref("");
const isMobileSettings = ref(false);

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
/** Avatars that have arrived; each one fades in on its own load. */
const loadedAvatars = ref(new Set<string>());

function markAvatarLoaded(login: string) {
  loadedAvatars.value.add(login);
}

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

const isOpen = computed(() => props.messenger.state.settingsOpen);

const customTheme = useCustomTheme();
const themeCodeInput = ref("");
const rememberTheme = () => !props.messenger.state.opsecRamOnlyEnabled;

const THEME_PRESETS: CustomTheme[] = [
  { accent: "#2090ea", tint: "#2090ea" },
  { accent: "#8b5cf6", tint: "#c084fc" },
  { accent: "#10b981", tint: "#34d399" },
  { accent: "#f43f5e", tint: "#fb7185" },
  { accent: "#f59e0b", tint: "#fbbf24" },
  { accent: "#64748b", tint: "#94a3b8" },
];
const THEME_SWATCHES = ["#2090ea", "#0ea5e9", "#14b8a6", "#10b981", "#84cc16", "#f59e0b", "#f97316", "#f43f5e", "#ec4899", "#8b5cf6", "#6366f1", "#64748b"];
const THEME_FIELDS = ["accent", "tint"] as const;
const themeEditing = ref<"" | "accent" | "tint">("");

function onThemeToggle(event: Event) {
  const enabled = event.target instanceof HTMLInputElement && event.target.checked;
  if (enabled && !customTheme.theme) applyTheme({ ...THEME_PRESETS[0] });
  else setCustomThemeEnabled(enabled, rememberTheme());
}

function defaultAccent() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : "#2090ea";
}

function themeValue(field: "accent" | "tint") {
  const theme = customTheme.enabled ? customTheme.theme : null;
  if (field === "accent") return theme?.accent || customTheme.theme?.accent || defaultAccent();
  return theme?.tint || theme?.accent || defaultAccent();
}

const themePreviewStyle = computed(() => ({
  "--preview-accent": themeValue("accent"),
  "--preview-tint": themeValue("tint"),
}));

function applyTheme(theme: CustomTheme) {
  setCustomTheme(theme, rememberTheme());
}

function updateCustomTheme(patch: Partial<CustomTheme>) {
  setCustomTheme({ accent: themeValue("accent"), tint: customTheme.theme?.tint || "", ...patch }, rememberTheme(), false);
}

async function copyThemeCode() {
  if (!customTheme.theme) return;
  try {
    await navigator.clipboard.writeText(encodeTheme(customTheme.theme));
    props.messenger.showToast?.(t("settings.theme.copied"));
  } catch {
    props.messenger.showToast?.(t("errors.clipboardFailed"));
  }
}

function importThemeCode() {
  const theme = decodeTheme(themeCodeInput.value);
  if (!theme) {
    props.messenger.showToast?.(t("settings.theme.invalidCode"), { error: true });
    return;
  }
  setCustomTheme(theme, rememberTheme());
  themeCodeInput.value = "";
  props.messenger.showToast?.(t("settings.theme.imported"));
}

const fingerprints = ref<{ app: string; ui: string } | null>(null);
let fingerprintsLoading = false;

async function loadFingerprints() {
  if (fingerprintsLoading || fingerprints.value) return;
  fingerprintsLoading = true;
  const [app, ui] = await Promise.all([binaryFingerprint(), interfaceFingerprint()]);
  fingerprints.value = { app, ui };
  fingerprintsLoading = false;
}

function groupHex(value: string) {
  return value.match(/.{1,4}/g)?.join(" ") || value;
}

async function copyFingerprint(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    props.messenger.showToast?.(t("settings.about.fingerprintCopied"));
  } catch {
    props.messenger.showToast?.(t("errors.clipboardFailed"));
  }
}

watch([activeSection, isOpen], ([section, open]) => {
  if (open && section === "about") void loadFingerprints();
}, { immediate: true });

const nameChanged = computed(() => draftName.value.trim() !== String(props.messenger.state.username || "").trim());
const nameError = computed(() =>
  nameChanged.value ? String(props.messenger.validateUsername(draftName.value) || "") : ""
);
const nameValid = computed(() => !nameError.value);
const meAccent = computed(() => props.messenger.accentFor(props.messenger.state.username || "you"));
const meInitials = computed(() => initialsOf(props.messenger.state.username));
const profile = computed(() => props.messenger.myProfile.value);
const turnServers = computed(() => props.messenger.turnServers.value || turnServerList());
const avatarSrc = computed(() => props.messenger.profileImageSrc(profile.value.avatar, "avatar"));
const bannerSrc = computed(() => props.messenger.profileImageSrc(profile.value.banner, "banner"));
const profileTextChanged = computed(() =>
  draftDescription.value.trim() !== String(profile.value.description || "").trim()
  || draftPronouns.value.trim() !== String(profile.value.pronouns || "").trim()
  || draftStatus.value.trim() !== String(profile.value.customStatus || "").trim()
  || linksKey(draftLinks.value) !== linksKey(profile.value.links || [])
);
const invalidLinks = computed(() => draftLinks.value.some((link) => link.url.trim() && !/^https:\/\/\S{3,}$/.test(link.url.trim())));

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
const acceptUnknownOptions = computed(() => [
  { value: "off", label: t("phantom.acceptUnknownOff") },
  { value: "filter", label: t("phantom.acceptUnknownFilter") },
  { value: "all", label: t("phantom.acceptUnknownAll") }
]);

const myBadges = computed<string[]>(() => props.messenger.badgesFor?.(props.messenger.state.username) || []);
const myBadgeNames = computed(() => myBadges.value.map((badge) => badgeLabelFor(t, badge)).join(", "));
const activeSectionLabel = computed(() => sections.value.find((section) => section.id === activeSection.value)?.label || "Settings");
watch(isOpen, (v) => {
  if (v) {
    if (settingsHistoryDepth === 0) pushSettingsHistoryEntry();
    mobileSectionOpen.value = false;
    settingsSearch.value = "";
    draftName.value = props.messenger.state.username || "";
    draftDescription.value = props.messenger.state.profile?.description || "";
    draftPronouns.value = props.messenger.state.profile?.pronouns || "";
    draftStatus.value = props.messenger.state.profile?.customStatus || "";
    draftLinks.value = (props.messenger.state.profile?.links || []).map((link) => ({ ...link }));
    if (sections.value.some((section) => section.id === props.initialSection)) {
      activeSection.value = props.initialSection;
    }
  } else {
    releaseSettingsHistoryEntry();
  }
});

function close() {
  mobileSectionOpen.value = false;
  props.messenger.state.settingsOpen = false;
}

function selectSection(sectionId: string) {
  activeSection.value = sectionId;
  if (isMobileSettings.value) mobileSectionOpen.value = true;
}

function backToSettingsList() {
  mobileSectionOpen.value = false;
}

async function saveName() {
  if (!nameValid.value || !nameChanged.value) return;
  const saved = await props.messenger.changeUsername(draftName.value.trim());
  if (saved) draftName.value = props.messenger.state.username || "";
}

function saveProfileText() {
  if (!profileTextChanged.value || invalidLinks.value) return;
  props.messenger.setProfileText({
    description: draftDescription.value,
    pronouns: draftPronouns.value
  });
  props.messenger.setProfileExtras({
    customStatus: draftStatus.value,
    links: draftLinks.value.filter((link) => link.url.trim()),
  });
}

/** Puts the three drafts back to what the account currently holds. */
function revertProfileDrafts() {
  draftName.value = props.messenger.state.username || "";
  draftDescription.value = props.messenger.state.profile?.description || "";
  draftPronouns.value = props.messenger.state.profile?.pronouns || "";
  draftStatus.value = props.messenger.state.profile?.customStatus || "";
  draftLinks.value = (props.messenger.state.profile?.links || []).map((link) => ({ ...link }));
}

async function saveAll() {
  if (nameChanged.value && nameValid.value) await saveName();
  if (profileTextChanged.value) saveProfileText();
}

function onAvatarPicked(event: Event) {
  const file = takePickedFile(event);
  if (file) openCrop(file, "avatar");
}

function onBannerPicked(event: Event) {
  const file = takePickedFile(event);
  if (file) openCrop(file, "banner");
}

async function openCrop(file: File, kind: "avatar" | "banner") {
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
function onFilePicked(event: Event) {
  const file = takePickedFile(event);
  if (file) props.messenger.importData(file);
}
async function onClear() {
  if (!await dialog.showConfirm(t('dialog.clearDataConfirm'), "", { danger: true, confirmLabel: t('dialog.clear') })) return;
  props.messenger.clearAllData();
  close();
}

async function onLogout() {
  if (!await dialog.showConfirm(t('settings.security.logoutConfirm'))) return;
  props.messenger.logoutAccount();
  close();
}

async function onDeleteAccount() {
  const confirmed = await dialog.showConfirm(t('settings.profile.deleteAccountConfirm'), "", {
    danger: true,
    confirmLabel: t('settings.profile.deleteAccount'),
  });
  if (!confirmed) return;
  const password = await dialog.showPrompt(t('settings.profile.deleteAccountPrompt'));
  if (!password) return;
  props.messenger.deleteAccount(password)
    .then(() => {
      close();
    })
    .catch(async (err: unknown) => {
      await dialog.showAlert(errorMessage(err) || t('settings.profile.deleteAccountError'));
    });
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

function onKey(event: KeyboardEvent) {
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
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", syncMobileSettings);
  window.removeEventListener("popstate", onSettingsPopState);
  document.removeEventListener("keydown", onKey);
  releaseSettingsHistoryEntry();
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
          <Icon name="close" viewBox="0 0 24 24" />
        </button>
      </header>

      <button class="settings__card" type="button" @click="activeSection = 'profile'">
        <Avatar :name="messenger.state.username" :src="avatarSrc" :accent="meAccent" size="md" />
        <span class="settings__card-identity">
          <span class="settings__card-name">
            <strong>@{{ messenger.state.username || t('labels.anonymous') }}</strong>
            <span v-if="myBadges.length" class="settings__card-badges" :aria-label="myBadgeNames">
              <BadgeIcon v-for="badge in myBadges.slice(0, 3)" :key="badge" :badge="badge" />
              <small v-if="myBadges.length > 3" class="settings__card-badges-more">+{{ myBadges.length - 3 }}</small>
            </span>
          </span>
          <small>{{ connectionStatusLabel }}</small>
        </span>
      </button>

      <nav class="settings__nav" :aria-label="t('settings.sectionsNav')">
        <button v-for="section in filteredSections" :key="section.id" type="button" class="settings__nav-item"
          :class="{ 'is-active': activeSection === section.id }" @click="selectSection(section.id)">
          <Icon name="user" v-if="section.id === 'profile'" viewBox="0 0 24 24" />
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
          <Icon name="phone" v-else-if="section.id === 'calls'" viewBox="0 0 24 24" />
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
          <Icon name="upload" v-else-if="section.id === 'backups'" viewBox="0 0 24 24" />
          <Icon name="heart" v-else-if="section.id === 'donation'" viewBox="0 0 24 24" style="fill: currentColor; stroke: none;" />
          <Icon name="user-plus" v-else-if="section.id === 'phantom'" viewBox="0 0 24 24" />
          <svg v-else viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span>{{ section.label }}</span>
          <Icon name="chevron-right" class="settings__chevron" viewBox="0 0 24 24" />
        </button>
      </nav>

      <div class="settings__disconnect">
        <button v-if="messenger.state.authToken" type="button" class="settings__disconnect-btn"
          @click="onLogout">
          <Icon name="sign-out" viewBox="0 0 24 24" width="18" height="18" />
          {{ t('settings.security.logout') }}
        </button>
      </div>
    </aside>

    <main class="settings__main">
      <header class="settings__main-head">
        <button class="icon-btn settings__back" type="button" :aria-label="t('settings.back')"
          @click="backToSettingsList">
          <Icon name="chevron-left" viewBox="0 0 24 24" />
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
            :class="`avatar--${meAccent}`">{{ meInitials }}</span>

          <!-- One row, fixed shape: the two pickers always sit in the same
               place, and each removal appears beside the picture it clears
               rather than shifting the row around. -->
          <div class="settings-profile__actions">
            <div class="settings-profile__pair">
              <button type="button" class="settings-profile__pick" @click="avatarInputRef?.click()">
                <Icon name="camera" viewBox="0 0 24 24" aria-hidden="true" />
                <span>{{ t('settings.profile.profileImage') }}</span>
              </button>
              <button v-if="profile.avatar" type="button" class="settings-profile__clear"
                :aria-label="t('settings.profile.clearImage')" :title="t('settings.profile.clearImage')"
                @click="messenger.clearProfileImage('avatar')">
                <Icon name="close" viewBox="0 0 24 24" aria-hidden="true" />
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
                <Icon name="close" viewBox="0 0 24 24" aria-hidden="true" />
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
              <Icon name="user" viewBox="0 0 24 24" />
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

        <div class="settings-group">
          <h4>{{ t('settings.profile.richTitle') }}</h4>
          <label class="settings-field" for="profile-status">
            <span>{{ t('settings.profile.customStatus') }}</span>
          </label>
          <div class="settings-inline">
            <input id="profile-status" v-model="draftStatus" type="text" maxlength="60" autocomplete="off"
              :placeholder="t('settings.profile.customStatusPlaceholder')" class="settings-input" />
          </div>
          <span class="settings-field profile-links__title">{{ t('settings.profile.links') }}</span>
          <TransitionGroup tag="div" name="profile-link" class="profile-links">
            <div v-for="(link, index) in draftLinks" :key="index" class="profile-links__row">
              <input v-model="link.label" type="text" maxlength="32" class="settings-input profile-links__label"
                :placeholder="t('settings.profile.linkLabel')" :aria-label="t('settings.profile.linkLabel')" />
              <input v-model="link.url" type="url" maxlength="200" class="settings-input profile-links__url"
                :class="{ 'is-invalid': link.url.trim() && !/^https:\/\/\S{3,}$/.test(link.url.trim()) }"
                placeholder="https://" :aria-label="t('settings.profile.linkUrl')" spellcheck="false" />
              <button type="button" class="icon-btn" :aria-label="t('settings.profile.removeLink')" @click="draftLinks.splice(index, 1)">
                <Icon name="close" viewBox="0 0 24 24" />
              </button>
            </div>
          </TransitionGroup>
          <button v-if="draftLinks.length < 4" type="button" class="btn settings-btn" @click="draftLinks.push({ label: '', url: '' })">
            {{ t('settings.profile.addLink') }}
          </button>
          <p class="settings-note">{{ invalidLinks ? t('settings.profile.linkInvalid') : t('settings.profile.linksNote') }}</p>
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
        <div class="settings-group theme-studio">
          <h4>{{ t('settings.theme.title') }}</h4>
          <label class="settings-check">
            <span>{{ t('settings.theme.enable') }}</span>
            <input type="checkbox" :checked="Boolean(customTheme.theme) && customTheme.enabled" @change="onThemeToggle" />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </label>
          <Transition name="theme-disclose">
          <div v-if="customTheme.theme && customTheme.enabled" class="theme-studio__body">
          <div class="theme-preview" :style="themePreviewStyle" aria-hidden="true">
            <span class="theme-preview__bubble theme-preview__bubble--in">{{ t('settings.theme.previewIn') }}</span>
            <span class="theme-preview__bubble theme-preview__bubble--out">{{ t('settings.theme.previewOut') }}</span>
            <span class="theme-preview__chip">{{ t('settings.theme.previewChip') }}</span>
          </div>
          <div class="theme-presets" role="group" :aria-label="t('settings.theme.presets')">
            <button v-for="(preset, index) in THEME_PRESETS" :key="index" type="button" class="theme-preset"
              :class="{ 'is-active': customTheme.theme?.accent === preset.accent && customTheme.theme?.tint === preset.tint }"
              :aria-label="t('settings.theme.preset', { n: String(index + 1) })"
              @click="applyTheme({ ...preset })">
              <span :style="{ background: preset.accent }"></span>
              <span :style="{ background: preset.tint }"></span>
            </button>
          </div>
          <div v-for="field in THEME_FIELDS" :key="field" class="theme-field">
            <button type="button" class="theme-field__row" :aria-expanded="themeEditing === field"
              @click="themeEditing = themeEditing === field ? '' : field">
              <span>{{ t(`settings.theme.${field}`) }}</span>
              <span class="theme-field__value">
                <code>{{ themeValue(field) }}</code>
                <span class="theme-field__swatch" :style="{ background: themeValue(field) }"></span>
              </span>
            </button>
            <Transition name="theme-disclose">
              <div v-if="themeEditing === field" class="theme-field__picker">
                <ColorPicker :model-value="themeValue(field)" :swatches="THEME_SWATCHES"
                  @update:model-value="updateCustomTheme({ [field]: $event })" />
              </div>
            </Transition>
          </div>
          <div class="theme-share">
            <button type="button" class="btn settings-btn" :disabled="!customTheme.theme" @click="copyThemeCode">
              {{ t('settings.theme.copyCode') }}
            </button>
            <button type="button" class="btn settings-btn" :disabled="!customTheme.theme" @click="setCustomTheme(null, rememberTheme())">
              {{ t('settings.theme.reset') }}
            </button>
          </div>
          <div class="settings-inline theme-import">
            <input v-model="themeCodeInput" type="text" class="settings-input" spellcheck="false" autocomplete="off"
              :placeholder="t('settings.theme.codePlaceholder')" @keydown.enter.prevent="importThemeCode" />
            <button type="button" class="btn settings-btn" :disabled="!themeCodeInput.trim()" @click="importThemeCode">
              {{ t('settings.theme.import') }}
            </button>
          </div>
          <p class="settings-note">{{ t('settings.theme.note') }}</p>
          </div>
          </Transition>
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

      <SettingsSecurity v-else-if="activeSection === 'security'" :messenger="messenger" @logout="onLogout" />

      <SettingsOpsec v-else-if="activeSection === 'opsec'" :messenger="messenger" />

      <SettingsNotifications v-else-if="activeSection === 'notifications'" :messenger="messenger" />

      <SettingsCalls v-else-if="activeSection === 'calls'" :messenger="messenger"
        :active="isOpen && (!isMobileSettings || mobileSectionOpen)" />

      <SettingsTor v-else-if="activeSection === 'tor'" :messenger="messenger" />

      <SettingsAdvanced v-else-if="activeSection === 'advanced'" :messenger="messenger" />

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
              <Icon name="upload" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round" />
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
            <Icon name="heart" class="donation-hero__heart" viewBox="0 0 24 24" aria-hidden="true" />
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

      <section v-else class="settings-page settings-page--about">
        <div class="settings-group">
          <h4>{{ t('settings.about.integrity') }}</h4>
          <p class="settings-note">{{ t('settings.about.integrityNote') }}</p>
          <template v-for="entry in [
            { key: 'app', label: t('settings.about.appFingerprint'), value: fingerprints?.app || '' },
            { key: 'ui', label: t('settings.about.uiFingerprint'), value: fingerprints?.ui || '' }
          ]" :key="entry.key">
            <div v-if="entry.key === 'ui' || isTauri" class="about-fingerprint">
              <span class="about-fingerprint__label">{{ entry.label }}</span>
              <code v-if="entry.value" class="about-fingerprint__hash">{{ groupHex(entry.value) }}</code>
              <span v-else class="about-fingerprint__hash is-pending">{{ fingerprints ? t('settings.about.fingerprintUnavailable') : t('settings.about.fingerprintComputing') }}</span>
              <button v-if="entry.value" type="button" class="about-fingerprint__copy" :aria-label="t('settings.about.copyFingerprint')"
                :title="t('settings.about.copyFingerprint')" @click="copyFingerprint(entry.value)">
                <Icon name="copy" viewBox="0 0 24 24" />
              </button>
            </div>
          </template>
        </div>

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
          <!-- Skeleton while the request runs, then the real list in its place,
               so the section never jumps from a button to three rows at once. -->
          <Transition name="qx-fade" mode="out-in">
            <ul v-if="topContributors.length" key="list" class="about-contributors">
              <li v-for="(contributor, index) in topContributors" :key="contributor.login" class="about-contributor"
                :style="{ '--n': index }">
                <a :href="contributor.html_url" target="_blank" rel="noopener noreferrer" class="about-contributor__link">
                  <span class="about-contributor__avatar-frame">
                    <img class="about-contributor__avatar"
                      :class="{ 'is-loaded': loadedAvatars.has(contributor.login) }" :src="contributor.avatar_url"
                      :alt="contributor.login" referrerpolicy="no-referrer"
                      @load="markAvatarLoaded(contributor.login)" @error="markAvatarLoaded(contributor.login)" />
                  </span>
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
            <ul v-else-if="contributorsLoading" key="loading" class="about-contributors is-loading" aria-busy="true"
              :aria-label="t('settings.about.loading')">
              <li v-for="n in 3" :key="n" class="about-contributor" :style="{ '--n': n - 1 }">
                <span class="about-contributor__link">
                  <span class="about-skeleton about-skeleton--avatar"></span>
                  <span class="about-contributor__meta">
                    <span class="about-skeleton about-skeleton--name"></span>
                    <span class="about-skeleton about-skeleton--count"></span>
                  </span>
                </span>
              </li>
            </ul>
          </Transition>
          <template v-if="!topContributors.length && !contributorsLoading">
            <p v-if="contributorsError" class="settings-note">{{ t('settings.about.contributorsError') }}</p>
            <button type="button" class="btn settings-btn" @click="requestContributors">
              {{ t('settings.about.loadContributors') }}
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
    transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
  }

  .settings.settings-enter-from,
  .settings.settings-leave-to {
    opacity: 0;
    transform: translateY(100%);
  }
}

.settings-note--error {
  color: var(--red, #ff6b70);
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

/* One grouped list: the rows sit in the group's own box and are told apart
   by an inset hairline, instead of each being a bordered box inside it. */
.about-contributors {
  list-style: none;
  margin: 0;
  display: flex;
  flex-direction: column;
}

.about-contributor + .about-contributor .about-contributor__link {
  background-image: linear-gradient(to right, transparent 0 48px, var(--line-strong) 48px);
  background-size: 100% 1px;
  background-repeat: no-repeat;
  background-position: top left;
}

.about-contributor__link {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  text-decoration: none;
}

/* The rows arrive one after another once the list replaces the skeleton. */
.about-contributors:not(.is-loading) .about-contributor {
  animation: contributor-in var(--dur-slow) var(--ease-out) both;
  animation-delay: calc(var(--n) * 70ms);
}

@keyframes contributor-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.about-contributor__avatar-frame {
  flex: none;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

/* An avatar shows once it has arrived rather than popping into a hole. */
.about-contributor__avatar {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
}

.about-contributor__avatar.is-loaded {
  opacity: 1;
}

.about-contributor__meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.about-contributor__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
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
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  white-space: nowrap;
}

.about-contributor__count {
  font-size: 12px;
  color: var(--muted);
}

.about-contributor__link:hover .about-contributor__name {
  color: var(--accent);
}

/* Placeholders the shape of a row, with a light sweeping across them. */
.about-skeleton {
  display: block;
  border-radius: 999px;
  background: linear-gradient(90deg,
      color-mix(in srgb, var(--text) 7%, transparent) 0%,
      color-mix(in srgb, var(--text) 15%, transparent) 50%,
      color-mix(in srgb, var(--text) 7%, transparent) 100%);
  background-size: 220% 100%;
  animation: skeleton-sweep 1.4s ease-in-out infinite;
  animation-delay: calc(var(--n, 0) * 120ms);
}

.about-skeleton--avatar {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
}

.about-skeleton--name {
  width: 120px;
  height: 11px;
}

.about-skeleton--count {
  width: 72px;
  height: 9px;
}

@keyframes skeleton-sweep {
  from { background-position: 110% 0; }
  to { background-position: -110% 0; }
}

@media (prefers-reduced-motion: reduce) {

  .about-contributors:not(.is-loading) .about-contributor {
    animation: none;
  }

  .about-skeleton {
    animation: none;
  }
}

/* Barre flottante « Modifications repérées [Sauvegarder] » */
.settings-save-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: var(--z-sheet);
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
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
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
  transition: background-color var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-out);
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
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.save-bar-enter-from,
.save-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

.about-fingerprint {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 10px;
  align-items: center;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--field-bg);
}

.about-fingerprint__label {
  grid-column: 1 / -1;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.about-fingerprint__hash {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  letter-spacing: 0.02em;
  word-break: break-all;
  color: var(--text);
}

.about-fingerprint__hash.is-pending {
  color: var(--muted);
  font-family: var(--font);
}

.about-fingerprint__copy {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--muted);
}

.about-fingerprint__copy:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text);
}

.about-fingerprint__copy svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
}

.profile-links__title {
  display: block;
  margin-top: 12px;
}

.profile-links {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 8px;
}

.profile-links__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
  gap: 6px;
  align-items: center;
}

.profile-links__url.is-invalid {
  box-shadow: inset 0 0 0 1px var(--red);
}

.profile-link-enter-active,
.profile-link-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.profile-link-enter-from,
.profile-link-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 640px) {
  .profile-links__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .profile-links__url {
    grid-column: 1 / 2;
  }
}

.theme-studio__body {
  margin-top: 10px;
}

.theme-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--preview-tint) 10%, var(--bg));
  box-shadow: inset 0 0 0 1px var(--line);
  transition: background-color var(--dur-base) var(--ease-out);
}

.theme-preview__bubble {
  max-width: 70%;
  padding: 7px 12px;
  border-radius: 16px;
  font-size: 13px;
  transition: background-color var(--dur-base) var(--ease-out);
}

.theme-preview__bubble--in {
  align-self: flex-start;
  background: var(--bubble-in);
  color: var(--text);
}

.theme-preview__bubble--out {
  align-self: flex-end;
  background: var(--preview-accent);
  color: #fff;
}

.theme-preview__chip {
  position: absolute;
  top: 10px;
  right: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--preview-accent) 18%, transparent);
  color: var(--preview-accent);
  font-size: 11px;
  font-weight: 700;
}

.theme-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 6px;
}

.theme-preset {
  display: flex;
  overflow: hidden;
  width: 44px;
  height: 28px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.theme-preset span {
  flex: 1;
}

.theme-preset:hover {
  transform: scale(1.06);
}

.theme-preset.is-active {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
}

.theme-field {
  border-bottom: 1px solid var(--line);
}

.theme-field__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 46px;
  color: var(--text);
  font-size: 15px;
  text-align: left;
}

.theme-field__value {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.theme-field__value code {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}

.theme-field__swatch {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--line-strong);
}

.theme-field__picker {
  padding: 6px 6px 14px;
}

/* Keyframes rather than transitions: the colour cross-fade overrides every transition while it runs. */
.theme-disclose-enter-active {
  animation: theme-disclose-in var(--dur-slow) var(--ease-out) both;
  transform-origin: top center;
}

.theme-disclose-leave-active {
  animation: theme-disclose-out var(--dur-base) var(--ease-in) both;
  transform-origin: top center;
}

@keyframes theme-disclose-in {
  from { opacity: 0; transform: translateY(-10px) scale(.98); }
}

@keyframes theme-disclose-out {
  to { opacity: 0; transform: translateY(-8px) scale(.98); }
}

@media (prefers-reduced-motion: reduce) {
  .theme-disclose-enter-active,
  .theme-disclose-leave-active {
    animation-duration: 1ms;
  }
}

.theme-share {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.theme-import {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

@media (max-width: 820px) {
  .settings-page--about .settings-group {
    padding: 0;
    margin: 0 0 26px;
  }

  .settings-page--about :deep(.settings-actions) {
    display: flex;
    flex-wrap: wrap;
  }
}
</style>
