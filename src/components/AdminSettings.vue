<script setup lang="ts">
/**
 * Server administration.
 *
 * Built on three primitives borrowed from macOS System Settings: an inset
 * grouped list, a row, and a segmented control. Everything on screen is one of
 * those three, which is what keeps a dense admin surface calm. Figures come
 * from `/api/admin/overview`. Nothing is estimated here, and no write is
 * applied optimistically: a row changes only once the server confirms it.
 */
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";
import type { useDialog } from "@/composables/useDialog";
import BadgeIcon from "@/components/BadgeIcon.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import {
  ASSIGNABLE_BADGE_IDS,
  badgeArtworkKey,
  badgeLabel as badgeLabelFor,
  isReservedBadge,
  normalizeBadgeId,
  sameBadgeArtwork
} from "@/config/badges";

const props = defineProps({
  messenger: { type: Object, required: true }
});

const { t, locale } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;

/** Server-side cap on custom badges (`MAX_USER_BADGES`). */
const MAX_BADGES = 16;
/** Rooms rendered at once; the filter narrows anything beyond that. */
const ROOM_PAGE = 60;
const VIEWS = ["overview", "users", "rooms", "config"] as const;
type AdminView = (typeof VIEWS)[number];

const view = ref<AdminView>("overview");
const userQuery = ref("");
const roomQuery = ref("");
const badgeDrafts = ref<Record<string, string[]>>({});
const customBadgeDraft = ref("");
const pickerOpen = ref(false);
const pendingAction = ref("");
const pendingFeature = ref("");
const adminDefaultRoomId = ref("");

/** Which account the detail pane shows, and which way the panes travel. */
const detailId = ref("");
const transitionName = ref<"push" | "pop" | "forward" | "back">("push");
const stageEl = ref<HTMLElement | null>(null);

const state = computed(() => props.messenger.state);
const overview = computed<any>(() => state.value.adminOverview);
const loading = computed(() => Boolean(state.value.adminLoading));
const error = computed(() => String(state.value.adminError || ""));
const accounts = computed(() => overview.value?.accounts || null);
const connections = computed(() => overview.value?.connections || null);
const roomTotals = computed(() => overview.value?.roomTotals || null);
const server = computed(() => overview.value?.server || null);
const features = computed<any>(() => overview.value?.features || null);
const defaultRoom = computed(() => overview.value?.defaultRoom || null);

const searchResults = computed<any[]>(() => state.value.adminSearchResults || []);
const searchLoading = computed(() => Boolean(state.value.adminSearchLoading));
const searched = computed(() => Boolean(state.value.adminSearchSearched));

/** The account in the detail pane, re-read from the list so it stays current. */
const detailUser = computed<any>(
  () => searchResults.value.find((entry) => String(entry?.id || "") === detailId.value) || null
);

// A deleted account cannot stay on screen.
watch([detailId, searchResults], () => {
  if (detailId.value && !detailUser.value) detailId.value = "";
});

const allRooms = computed<any[]>(() => (Array.isArray(overview.value?.rooms) ? overview.value.rooms : []));

const matchingRooms = computed<any[]>(() => {
  const needle = roomQuery.value.trim().toLowerCase();
  if (!needle) return allRooms.value;
  return allRooms.value.filter((room: any) => {
    const id = String(room?.roomId || "").toLowerCase();
    const name = String(props.messenger.displayRoomName?.(room?.roomId) || "").toLowerCase();
    return id.includes(needle) || name.includes(needle);
  });
});

// A busy server can hold thousands of rooms; only a page of them is rendered.
const rooms = computed<any[]>(() => matchingRooms.value.slice(0, ROOM_PAGE));

/**
 * Only rooms this client holds a key for can become the default: the server
 * redistributes that key on connect, so it has to be handed over here.
 */
const roomOptions = computed(() =>
  (props.messenger.state.rooms || [])
    .filter((room: any) => room?.roomId && props.messenger.roomKeyFor?.(room.roomId))
    .map((room: any) => ({ value: String(room.roomId), label: String(room.title || room.roomId) }))
);

const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: "medium" }));
const timeFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { timeStyle: "short" }));
const stampFormatter = computed(() =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" })
);

function formatDate(value: unknown) {
  const ms = Number(value) || 0;
  return ms > 0 ? dateFormatter.value.format(new Date(ms)) : t("settings.admin.never");
}

function formatTime(value: unknown) {
  const ms = Number(value) || 0;
  return ms > 0 ? timeFormatter.value.format(new Date(ms)) : t("settings.admin.never");
}

function formatCount(value: unknown) {
  return new Intl.NumberFormat(locale.value).format(Number(value) || 0);
}

/** Uptime is shown as the moment the process came up, with no invented units. */
const startedAt = computed(() => {
  const generated = Number(overview.value?.generatedAt) || 0;
  const uptime = Number(server.value?.uptimeMs) || 0;
  if (!generated || !uptime) return "";
  return stampFormatter.value.format(new Date(generated - uptime));
});

function platformLabel(platform: string) {
  return props.messenger.platformLabel?.(platform) || platform;
}

// Server-side search: one request per typing pause, never the whole user table.
let searchTimer: number | null = null;
watch(userQuery, (value) => {
  if (searchTimer) window.clearTimeout(searchTimer);
  const needle = String(value || "").trim();
  if (!needle) {
    props.messenger.cancelAdminUserSearch();
    return;
  }
  searchTimer = window.setTimeout(() => props.messenger.searchAdminUsers(needle), 300);
});

onMounted(() => {
  // Results from an earlier visit would otherwise sit under an empty field.
  props.messenger.cancelAdminUserSearch();
  props.messenger.loadAdminOverview();
});

onBeforeUnmount(() => {
  if (searchTimer) window.clearTimeout(searchTimer);
  if (flashTimer) window.clearTimeout(flashTimer);
  props.messenger.cancelAdminUserSearch();
});

function refresh() {
  props.messenger.loadAdminOverview();
}

/**
 * The two panes overlap while they cross, so the stage has to carry its own
 * height through the transition. Otherwise it snaps to the incoming pane and
 * clips whatever is still on its way out.
 */
function lockStage() {
  const el = stageEl.value;
  if (el) el.style.height = `${el.offsetHeight}px`;
}

function growStage(entering: Element) {
  const el = stageEl.value;
  if (!el) return;
  el.style.height = `${(entering as HTMLElement).offsetHeight}px`;
}

function freeStage() {
  const el = stageEl.value;
  if (el) el.style.height = "";
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * A badge row makes room for itself on the way in and gives it back on the way
 * out, so the rows around it slide instead of jumping.
 *
 * Padding has to travel with the height. Animating height alone leaves the
 * row's 7px of vertical padding behind, so it collapses to a 14px stub and
 * then disappears in one frame, which is the jolt this replaces. Driven from
 * script because only the browser knows a row's natural height.
 */
const SETTLE = "cubic-bezier(0.32, 0.72, 0, 1)";

function collapseFrames(node: HTMLElement) {
  const style = window.getComputedStyle(node);
  const open = {
    height: `${node.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    opacity: 1
  };
  const shut = {
    height: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    opacity: 0
  };
  return { open, shut };
}

function animateRow(el: Element, done: () => void, opening: boolean) {
  const node = el as HTMLElement;
  if (prefersReducedMotion()) return done();
  const { open, shut } = collapseFrames(node);
  node.style.overflow = "hidden";
  const animation = node.animate(opening ? [shut, open] : [open, shut], {
    duration: opening ? 340 : 300,
    easing: SETTLE
  });
  animation.onfinish = () => {
    node.style.overflow = "";
    done();
  };
}

function badgeEnter(el: Element, done: () => void) {
  animateRow(el, done, true);
}

function badgeLeave(el: Element, done: () => void) {
  animateRow(el, done, false);
}

/**
 * A ban or a lockout is the one action here with real consequences, so the
 * panel acknowledges it once rather than silently repainting a dot.
 */
const flash = ref("");
let flashTimer: number | null = null;

function pulse(kind: "danger" | "restore") {
  flash.value = kind;
  if (flashTimer) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    flash.value = "";
    flashTimer = null;
  }, 900);
}

function selectView(id: AdminView) {
  if (id === view.value && !detailId.value) return;
  // Leaving a detail pane is a step back up; moving between views travels
  // sideways, in whichever direction the segmented control just went.
  transitionName.value = detailId.value
    ? "pop"
    : VIEWS.indexOf(id) > VIEWS.indexOf(view.value)
      ? "forward"
      : "back";
  view.value = id;
  detailId.value = "";
}

function viewLabel(id: AdminView) {
  return t(`settings.admin.view.${id}`);
}

const viewIndex = computed(() => VIEWS.indexOf(view.value));

function openUser(user: any) {
  transitionName.value = "push";
  detailId.value = String(user?.id || "");
  pickerOpen.value = false;
  customBadgeDraft.value = "";
}

function closeUser() {
  transitionName.value = "pop";
  detailId.value = "";
}

function accountStateLabel(user: any) {
  if (user?.banned) return t("settings.admin.banned");
  if (user?.disabled) return t("settings.admin.disabled");
  return t("settings.admin.active");
}

function accountStateClass(user: any) {
  if (user?.banned) return "is-banned";
  if (user?.disabled) return "is-disabled";
  return "is-active";
}

/** Badges actually stored on the account, the ones an admin can take back. */
function grantableBadges(user: any): string[] {
  const stored = Array.isArray(user?.customBadges) ? user.customBadges : [];
  return stored.map(normalizeBadgeId).filter((badge: string) => badge && !isReservedBadge(badge));
}

/**
 * Badges the server derives: `admin` from its admin list, `early` from the
 * account rank, `system` for the official account. Removing one would do
 * nothing, so they are listed locked. An admin can still grant `early` to
 * somebody else; it simply cannot be taken off an account that earned it.
 */
function serverBadges(user: any): string[] {
  const stored = new Set(grantableBadges(user));
  const all = Array.isArray(user?.badges) ? user.badges : [];
  return all.map(normalizeBadgeId).filter((badge: string) => badge && !stored.has(badge));
}

function draftFor(user: any): string[] {
  const id = String(user?.id || "");
  if (!id) return [];
  if (!(id in badgeDrafts.value)) badgeDrafts.value[id] = grantableBadges(user);
  return badgeDrafts.value[id];
}

/**
 * Catalogue entries this account does not already wear, counting the badges
 * the server derives, and matching on artwork rather than on id. Offering
 * `staff` to somebody who is already `admin` would paint the same crest twice.
 */
function availableBadges(user: any): string[] {
  const taken = new Set([...draftFor(user), ...serverBadges(user)].map(badgeArtworkKey));
  return ASSIGNABLE_BADGE_IDS.filter((badge) => !taken.has(badgeArtworkKey(badge)));
}

/** A stored badge the server already covers with the same picture. */
function isShadowed(user: any, badge: string) {
  return serverBadges(user).some((derived) => sameBadgeArtwork(derived, badge));
}

function isCustom(badge: string) {
  return !ASSIGNABLE_BADGE_IDS.includes(badge);
}

function chipLabel(badge: string) {
  return isCustom(badge) ? badge : badgeLabelFor(t, badge);
}

function draftChanged(user: any) {
  return draftFor(user).join(",") !== grantableBadges(user).join(",");
}

function atBadgeLimit(user: any) {
  return draftFor(user).length >= MAX_BADGES;
}

function addBadge(user: any, badge: string) {
  const id = String(user?.id || "");
  const current = draftFor(user);
  if (current.includes(badge) || current.length >= MAX_BADGES) return;
  badgeDrafts.value[id] = [...current, badge];
}

function removeBadge(user: any, badge: string) {
  const id = String(user?.id || "");
  badgeDrafts.value[id] = draftFor(user).filter((entry) => entry !== badge);
}

function addCustomBadge(user: any) {
  const badge = normalizeBadgeId(customBadgeDraft.value);
  if (!badge || isReservedBadge(badge)) return;
  addBadge(user, badge);
  customBadgeDraft.value = "";
}

function resetDraft(user: any) {
  const id = String(user?.id || "");
  if (id) badgeDrafts.value[id] = grantableBadges(user);
}

function isPending(action = "") {
  return action ? pendingAction.value === action : Boolean(pendingAction.value);
}

async function run(action: string, task: () => Promise<unknown>) {
  if (pendingAction.value) return;
  pendingAction.value = action;
  try {
    await task();
  } finally {
    pendingAction.value = "";
  }
}

async function saveBadges(user: any) {
  const badges = [...draftFor(user)];
  pickerOpen.value = false;
  await run("badges", async () => {
    const saved = await props.messenger.setAdminUserBadges?.(String(user.id), badges);
    // On success the row carries the badges the server stored; on failure the
    // draft is rolled back to the last confirmed state.
    badgeDrafts.value[String(user.id)] = saved ? badges : grantableBadges(user);
  });
}

async function setDisabled(user: any, disabled: boolean) {
  if (disabled && !(await confirmAction("disableConfirm", user))) return;
  await run("disabled", async () => {
    const ok = await props.messenger.setAdminUserDisabled(String(user.id), disabled);
    if (ok) pulse(disabled ? "danger" : "restore");
  });
}

async function setBanned(user: any, banned: boolean) {
  if (banned && !(await confirmAction("banConfirm", user))) return;
  await run("banned", async () => {
    const ok = await props.messenger.setAdminUserBanned(String(user.id), banned);
    if (ok) pulse(banned ? "danger" : "restore");
  });
}

async function removeAccount(user: any) {
  if (isSelf(user)) return;
  if (!(await confirmAction("deleteConfirm", user))) return;
  await run("delete", () => props.messenger.deleteAdminUser(String(user.id)));
}

function isSelf(user: any) {
  return String(user?.id || "") === String(state.value.userId || "");
}

function confirmAction(key: string, user: any) {
  return dialog.showConfirm(
    t(`settings.admin.${key}`, { username: String(user?.username || user?.id || "") }),
    t("settings.admin.confirmTitle")
  );
}

/**
 * Feature switches are re-synced from the server's answer, so a rejected
 * change snaps the control back instead of leaving the UI out of step.
 */
async function toggleFeature(key: string, event: Event) {
  const input = event.target as HTMLInputElement;
  pendingFeature.value = key;
  try {
    await props.messenger.setAdminFeature(key, input.checked);
  } finally {
    pendingFeature.value = "";
    input.checked = Boolean(features.value?.[key]);
  }
}

async function applyDefaultRoom() {
  if (!adminDefaultRoomId.value) return;
  await props.messenger.setServerDefaultRoom(adminDefaultRoomId.value);
}

async function clearDefaultRoom() {
  const confirmed = await dialog.showConfirm(
    t("settings.admin.defaultRoomClearConfirm"),
    t("settings.admin.confirmTitle")
  );
  if (!confirmed) return;
  await props.messenger.clearServerDefaultRoom();
}
</script>

<template>
  <div class="ax">
    <div class="ax__bar">
      <div class="seg" role="tablist" :aria-label="t('settings.admin.title')">
        <span class="seg__thumb" :style="{ transform: `translateX(${viewIndex * 100}%)` }" aria-hidden="true"></span>
        <button v-for="id in VIEWS" :key="id" type="button" role="tab" class="seg__item"
          :class="{ 'is-on': view === id }" :aria-selected="view === id" @click="selectView(id)">
          {{ viewLabel(id) }}
        </button>
      </div>
      <button type="button" class="ax__refresh" :class="{ 'is-busy': loading }" :disabled="loading"
        :aria-label="t('settings.admin.refresh')" :title="t('settings.admin.refresh')" @click="refresh">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" />
          <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" />
          <path d="M4 4.5v4h4" />
          <path d="M20 19.5v-4h-4" />
        </svg>
      </button>
    </div>

    <p v-if="error" class="ax__error" role="alert">{{ error }}</p>

    <div ref="stageEl" class="ax__stage">
      <Transition :name="transitionName" @before-leave="lockStage" @enter="growStage" @after-enter="freeStage"
        @enter-cancelled="freeStage">
        <!-- ─────────────────────────────── Detail ─────────────────────────── -->
        <div v-if="detailUser" key="detail" class="pane">
          <button type="button" class="back" @click="closeUser">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {{ viewLabel('users') }}
          </button>

          <h3 class="pane__title">{{ detailUser.username }}</h3>

          <section class="grp">
            <p class="grp__label">{{ t('settings.admin.identity') }}</p>
            <div class="grp__box">
              <div class="row">
                <span class="row__label">{{ t('settings.admin.accountId') }}</span>
                <span class="row__value row__value--mono">{{ detailUser.id }}</span>
              </div>
              <div class="row">
                <span class="row__label">{{ t('settings.admin.registered') }}</span>
                <span class="row__value">{{ formatDate(detailUser.createdAt) }}</span>
              </div>
              <div class="row">
                <span class="row__label">{{ t('settings.admin.accountState') }}</span>
                <span class="row__value dot" :class="accountStateClass(detailUser)">
                  <i aria-hidden="true"></i>{{ accountStateLabel(detailUser) }}
                </span>
              </div>
            </div>
          </section>

          <section class="grp">
            <p class="grp__label">
              {{ t('settings.admin.badges') }}
              <span class="grp__count" :class="{ 'is-full': atBadgeLimit(detailUser) }">
                {{ t('settings.admin.badgeCount', { used: String(draftFor(detailUser).length), max: String(MAX_BADGES) }) }}
              </span>
            </p>
            <div class="grp__box">
              <TransitionGroup :css="false" @enter="badgeEnter" @leave="badgeLeave">
                <div v-for="badge in draftFor(detailUser)" :key="`has-${badge}`" class="row row--badge"
                  :class="{ 'is-shadowed': isShadowed(detailUser, badge) }">
                <BadgeIcon :badge="badge" class="row__badge" />
                <span class="row__label" :class="{ 'row__label--mono': isCustom(badge) }">{{ chipLabel(badge) }}</span>
                <span v-if="isShadowed(detailUser, badge)" class="row__hint">{{ t('settings.admin.badgeShadowed') }}</span>
                  <button type="button" class="row__remove" :disabled="isPending()"
                    :aria-label="t('settings.admin.removeBadge', { badge })"
                    :title="t('settings.admin.removeBadge', { badge })" @click="removeBadge(detailUser, badge)">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".16" />
                      <path d="M8.5 12h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </button>
                </div>
              </TransitionGroup>

              <button type="button" class="row row--action" :disabled="isPending() || atBadgeLimit(detailUser)"
                :aria-expanded="pickerOpen" @click="pickerOpen = !pickerOpen">
                <svg class="row__plus" :class="{ 'is-open': pickerOpen }" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".16" />
                  <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
                <span class="row__label">{{ t('settings.admin.addBadges') }}</span>
              </button>

              <div class="reveal" :class="{ 'is-open': pickerOpen }">
                <div class="reveal__inner">
                  <div class="picker">
                    <button v-for="badge in availableBadges(detailUser)" :key="`add-${badge}`" type="button"
                      class="opt" :disabled="isPending() || atBadgeLimit(detailUser)"
                      @click="addBadge(detailUser, badge)">
                      <BadgeIcon :badge="badge" class="opt__icon" />
                      <span>{{ badgeLabelFor(t, badge) }}</span>
                    </button>
                    <p v-if="!availableBadges(detailUser).length" class="picker__empty">
                      {{ t('settings.admin.badgeLimit') }}
                    </p>
                  </div>
                  <div class="field">
                    <input v-model="customBadgeDraft" class="field__input" type="text" maxlength="32"
                      autocomplete="off" spellcheck="false" :placeholder="t('settings.admin.customBadge')"
                      :aria-label="t('settings.admin.customBadge')" :disabled="isPending() || atBadgeLimit(detailUser)"
                      @keydown.enter.prevent="addCustomBadge(detailUser)" />
                    <button type="button" class="field__btn"
                      :disabled="!customBadgeDraft || isPending() || atBadgeLimit(detailUser)"
                      @click="addCustomBadge(detailUser)">{{ t('settings.admin.addBadge') }}</button>
                  </div>
                </div>
              </div>
            </div>
            <p class="grp__note">{{ t('settings.admin.badgesNote') }}</p>

            <div class="save" :class="{ 'is-open': draftChanged(detailUser) }">
              <div class="save__inner">
                <span class="save__label">{{ t('settings.admin.pendingChanges') }}</span>
                <button type="button" class="btn-plain" :disabled="isPending()" @click="resetDraft(detailUser)">
                  {{ t('settings.admin.cancel') }}
                </button>
                <button type="button" class="btn-filled" :disabled="isPending()" @click="saveBadges(detailUser)">
                  {{ isPending('badges') ? t('settings.admin.saving') : t('settings.admin.saveBadges') }}
                </button>
              </div>
            </div>
          </section>

          <section v-if="serverBadges(detailUser).length" class="grp">
            <p class="grp__label">{{ t('settings.admin.serverBadges') }}</p>
            <div class="grp__box">
              <div v-for="badge in serverBadges(detailUser)" :key="`locked-${badge}`" class="row row--badge is-locked">
                <BadgeIcon :badge="badge" class="row__badge" />
                <span class="row__label">{{ badgeLabelFor(t, badge) }}</span>
                <svg class="row__lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </div>
            </div>
          </section>

          <section class="grp">
            <p class="grp__label">{{ t('settings.admin.accountActions') }}</p>
            <div class="grp__box" :class="{ 'is-flash-danger': flash === 'danger', 'is-flash-restore': flash === 'restore' }">
              <button type="button" class="row row--action" :class="{ 'is-danger': !detailUser.disabled }"
                :disabled="isPending()" @click="setDisabled(detailUser, !detailUser.disabled)">
                <span class="row__label">
                  {{ detailUser.disabled ? t('settings.admin.enableAccount') : t('settings.admin.disableAccount') }}
                </span>
              </button>
              <button type="button" class="row row--action" :class="{ 'is-danger': !detailUser.banned }"
                :disabled="isPending()" @click="setBanned(detailUser, !detailUser.banned)">
                <span class="row__label">
                  {{ detailUser.banned ? t('settings.admin.pardonAccount') : t('settings.admin.banAccount') }}
                </span>
              </button>
              <button type="button" class="row row--action is-danger" :disabled="isPending() || isSelf(detailUser)"
                @click="removeAccount(detailUser)">
                <span class="row__label">{{ t('settings.admin.deleteAccount') }}</span>
              </button>
            </div>
            <p v-if="isSelf(detailUser)" class="grp__note">{{ t('settings.admin.selfNote') }}</p>
          </section>
        </div>

        <!-- ──────────────────────────────── Root ──────────────────────────── -->
        <div v-else :key="view" class="pane">
          <!-- Overview -->
          <template v-if="view === 'overview'">
            <p v-if="!overview && loading" class="empty">{{ t('settings.admin.loading') }}</p>
            <p v-else-if="!overview" class="empty">{{ t('settings.admin.noSnapshot') }}</p>
            <template v-else>
              <section class="grp">
                <p class="grp__label">{{ t('settings.admin.accounts') }}</p>
                <div class="grp__box">
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.accountsTotal') }}</span>
                    <span class="row__value row__value--lead">{{ formatCount(accounts?.total) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.accountsDisabled') }}</span>
                    <span class="row__value">{{ formatCount(accounts?.disabled) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.accountsBanned') }}</span>
                    <span class="row__value">{{ formatCount(accounts?.banned) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.accountsNewDay') }}</span>
                    <span class="row__value">{{ formatCount(accounts?.newLastDay) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.accountsNewWeek') }}</span>
                    <span class="row__value">{{ formatCount(accounts?.newLastWeek) }}</span>
                  </div>
                </div>
              </section>

              <section class="grp">
                <p class="grp__label">{{ t('settings.admin.connections') }}</p>
                <div class="grp__box">
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.connectionSessions') }}</span>
                    <span class="row__value row__value--lead">{{ formatCount(connections?.sessions) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.connectionUsers') }}</span>
                    <span class="row__value">{{ formatCount(connections?.users) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.connectionVoice') }}</span>
                    <span class="row__value">{{ formatCount(connections?.voice) }}</span>
                  </div>
                  <div v-for="entry in connections?.platforms || []" :key="entry.platform" class="row">
                    <span class="row__label">{{ platformLabel(entry.platform) }}</span>
                    <span class="row__value">{{ formatCount(entry.count) }}</span>
                  </div>
                </div>
                <p class="grp__note">{{ t('settings.admin.snapshotNote') }}</p>
              </section>

              <section class="grp">
                <p class="grp__label">{{ t('settings.admin.rooms') }}</p>
                <div class="grp__box">
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.roomsKnown') }}</span>
                    <span class="row__value row__value--lead">{{ formatCount(roomTotals?.known) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.roomsActive') }}</span>
                    <span class="row__value">{{ formatCount(roomTotals?.active) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.roomsBuffered') }}</span>
                    <span class="row__value">{{ formatCount(roomTotals?.bufferedMessages) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.roomsVoice') }}</span>
                    <span class="row__value">{{ formatCount(roomTotals?.voice) }}</span>
                  </div>
                </div>
              </section>

              <section class="grp">
                <p class="grp__label">{{ t('settings.admin.service') }}</p>
                <div class="grp__box">
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.serverVersion') }}</span>
                    <span class="row__value row__value--mono">{{ server?.version || t('settings.admin.unknown') }}</span>
                  </div>
                  <div v-if="startedAt" class="row">
                    <span class="row__label">{{ t('settings.admin.since') }}</span>
                    <span class="row__value">{{ startedAt }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.updated') }}</span>
                    <span class="row__value">{{ formatTime(overview.generatedAt) }}</span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.registrations') }}</span>
                    <span class="row__value dot" :class="features?.registerEnabled ? 'is-active' : 'is-off'">
                      <i aria-hidden="true"></i>
                      {{ features?.registerEnabled ? t('settings.admin.enabledState') : t('settings.admin.disabledState') }}
                    </span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.calls') }}</span>
                    <span class="row__value dot" :class="features?.callsEnabled ? 'is-active' : 'is-off'">
                      <i aria-hidden="true"></i>
                      {{ features?.callsEnabled ? t('settings.admin.enabledState') : t('settings.admin.disabledState') }}
                    </span>
                  </div>
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.defaultRoom') }}</span>
                    <span class="row__value">
                      {{ defaultRoom ? messenger.displayRoomName(defaultRoom.roomId) : t('settings.admin.defaultRoomNone') }}
                    </span>
                  </div>
                </div>
              </section>
            </template>
          </template>

          <!-- Users -->
          <template v-else-if="view === 'users'">
            <label class="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input v-model="userQuery" type="search" autocomplete="off" spellcheck="false"
                :placeholder="t('settings.admin.searchUsers')" :aria-label="t('settings.admin.searchUsers')" />
            </label>

            <p v-if="!userQuery.trim()" class="empty">{{ t('settings.admin.searchUsersNote') }}</p>
            <p v-else-if="searchLoading" class="empty">{{ t('settings.admin.loading') }}</p>
            <p v-else-if="searched && !searchResults.length" class="empty">{{ t('settings.admin.noUsersFound') }}</p>

            <section v-if="searchResults.length" class="grp">
              <div class="grp__box">
                <button v-for="user in searchResults" :key="user.id" type="button" class="row row--nav"
                  @click="openUser(user)">
                  <span class="row__stack">
                    <span class="row__title">{{ user.username }}</span>
                    <span class="row__sub">{{ user.id }} · {{ t('settings.admin.joined', { date: formatDate(user.createdAt) }) }}</span>
                  </span>
                  <span class="row__trail">
                    <span v-if="user.admin" class="pill pill--admin">{{ t('settings.admin.roleAdmin') }}</span>
                    <span class="row__state dot" :class="accountStateClass(user)">
                      <i aria-hidden="true"></i>{{ accountStateLabel(user) }}
                    </span>
                  </span>
                  <svg class="row__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
                    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m9 5 7 7-7 7" />
                  </svg>
                </button>
              </div>
            </section>
          </template>

          <!-- Rooms -->
          <template v-else-if="view === 'rooms'">
            <label class="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input v-model="roomQuery" type="search" autocomplete="off" spellcheck="false"
                :placeholder="t('settings.admin.filterRooms')" :aria-label="t('settings.admin.filterRooms')" />
            </label>

            <p v-if="!overview && loading" class="empty">{{ t('settings.admin.loading') }}</p>
            <p v-else-if="!rooms.length" class="empty">{{ t('settings.admin.noRooms') }}</p>
            <section v-else class="grp">
              <div class="grp__box">
                <div v-for="room in rooms" :key="room.roomId" class="row">
                  <span class="row__stack">
                    <span class="row__title">{{ messenger.displayRoomName(room.roomId) }}</span>
                    <span class="row__sub">{{ room.roomId }}</span>
                  </span>
                  <span class="row__value row__value--tight">
                    {{ formatCount(room.onlineCount) }} · {{ formatCount(room.messageCount) }}
                  </span>
                </div>
              </div>
              <p class="grp__note">
                <template v-if="matchingRooms.length > rooms.length">
                  {{ t('settings.admin.roomsShown', { shown: String(rooms.length), total: String(matchingRooms.length) }) }}
                </template>
                {{ t('settings.admin.roomsLegend') }}
              </p>
            </section>
          </template>

          <!-- Configuration -->
          <template v-else>
            <p v-if="!overview && loading" class="empty">{{ t('settings.admin.loading') }}</p>
            <p v-else-if="!overview" class="empty">{{ t('settings.admin.noSnapshot') }}</p>
            <template v-else>
              <section class="grp">
                <p class="grp__label">{{ t('settings.admin.features') }}</p>
                <div class="grp__box">
                  <label class="row row--control">
                    <span class="row__label">{{ t('settings.admin.registrations') }}</span>
                    <span class="sw">
                      <input type="checkbox" :checked="Boolean(features?.registerEnabled)"
                        :disabled="pendingFeature === 'registerEnabled'"
                        @change="toggleFeature('registerEnabled', $event)" />
                      <span class="sw__track"><span class="sw__knob"></span></span>
                    </span>
                  </label>
                  <label class="row row--control">
                    <span class="row__label">{{ t('settings.admin.calls') }}</span>
                    <span class="sw">
                      <input type="checkbox" :checked="Boolean(features?.callsEnabled)"
                        :disabled="pendingFeature === 'callsEnabled'" @change="toggleFeature('callsEnabled', $event)" />
                      <span class="sw__track"><span class="sw__knob"></span></span>
                    </span>
                  </label>
                </div>
              </section>

              <section class="grp">
                <p class="grp__label">{{ t('settings.admin.defaultRoom') }}</p>
                <div class="grp__box">
                  <div class="row">
                    <span class="row__label">{{ t('settings.admin.defaultRoomCurrent') }}</span>
                    <span class="row__value">
                      {{ defaultRoom ? messenger.displayRoomName(defaultRoom.roomId) : t('settings.admin.defaultRoomNone') }}
                    </span>
                  </div>
                  <div class="row row--control">
                    <span class="row__label">{{ t('settings.admin.defaultRoomSelect') }}</span>
                    <SelectMenu v-model="adminDefaultRoomId" class="row__pick" :options="roomOptions"
                      :placeholder="t('settings.admin.none')" :disabled="!roomOptions.length"
                      :aria-label="t('settings.admin.defaultRoomSelect')" />
                  </div>
                  <button type="button" class="row row--action" :disabled="!adminDefaultRoomId"
                    @click="applyDefaultRoom">
                    <span class="row__label">{{ t('settings.admin.defaultRoomSet') }}</span>
                  </button>
                  <button type="button" class="row row--action is-danger" :disabled="!defaultRoom"
                    @click="clearDefaultRoom">
                    <span class="row__label">{{ t('settings.admin.defaultRoomClear') }}</span>
                  </button>
                </div>
                <p class="grp__note">
                  {{ roomOptions.length ? t('settings.admin.defaultRoomNote') : t('settings.admin.defaultRoomNoOptions') }}
                </p>
              </section>
            </template>
          </template>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* One curve for the whole surface: the easing iOS uses for sheets. */
.ax {
  --ease: cubic-bezier(0.32, 0.72, 0, 1);
  --sep: color-mix(in srgb, var(--text) 8%, transparent);
  --field: color-mix(in srgb, var(--text) 7%, transparent);
  display: grid;
  gap: 14px;
}

/* ── Segmented control ─────────────────────────────────────────────────── */
.ax__bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.seg {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding: 2px;
  border-radius: 9px;
  background: var(--field);
}

.seg__thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc((100% - 4px) / 4);
  border-radius: 7px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .28), 0 0 0 .5px rgba(0, 0, 0, .12);
  transition: transform .32s var(--ease);
}

.seg__item {
  position: relative;
  z-index: 1;
  height: 26px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color .32s var(--ease);
}

.seg__item.is-on {
  color: var(--text);
  font-weight: 600;
}

.ax__refresh {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--field);
  color: var(--muted);
  cursor: pointer;
  transition: color .2s var(--ease), background .2s var(--ease);
}

.ax__refresh:hover:not(:disabled) {
  color: var(--text);
}

.ax__refresh:active:not(:disabled) {
  transform: scale(.94);
}

.ax__refresh svg {
  width: 15px;
  height: 15px;
}

.ax__refresh.is-busy svg {
  animation: ax-spin 900ms linear infinite;
}

@keyframes ax-spin {
  to {
    transform: rotate(360deg);
  }
}

.ax__error {
  margin: 0;
  padding: 9px 12px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
  font-size: 13px;
}

/* ── Push / pop navigation ─────────────────────────────────────────────── */
.ax__stage {
  position: relative;
  overflow: hidden;
  transition: height .42s var(--ease);
}

.pane {
  display: grid;
  gap: 18px;
  width: 100%;
}

/* A push goes down a level, so it travels further than a sideways move
   between two views that sit at the same depth. */
.push-enter-active,
.push-leave-active,
.pop-enter-active,
.pop-leave-active {
  transition: transform .42s var(--ease), opacity .42s var(--ease);
}

.forward-enter-active,
.forward-leave-active,
.back-enter-active,
.back-leave-active {
  transition: transform .34s var(--ease), opacity .26s ease-out;
}

.push-leave-active,
.pop-leave-active,
.forward-leave-active,
.back-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.forward-enter-from {
  transform: translateX(14px);
  opacity: 0;
}

.forward-leave-to {
  transform: translateX(-14px);
  opacity: 0;
}

.back-enter-from {
  transform: translateX(-14px);
  opacity: 0;
}

.back-leave-to {
  transform: translateX(14px);
  opacity: 0;
}

.push-enter-from {
  transform: translateX(22px);
  opacity: 0;
}

.push-leave-to {
  transform: translateX(-8%);
  opacity: 0;
}

.pop-enter-from {
  transform: translateX(-8%);
  opacity: 0;
}

.pop-leave-to {
  transform: translateX(22px);
  opacity: 0;
}

/* ── Grouped list ──────────────────────────────────────────────────────── */
.grp {
  display: grid;
  gap: 7px;
}

.grp__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 0 2px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--muted);
}

.grp__count {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}

.grp__count.is-full {
  color: #e0a32e;
}

.grp__box {
  position: relative;
  border-radius: 10px;
  background: var(--surface-2);
  overflow: hidden;
}

.grp__note {
  margin: 0 2px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--muted);
}

/* ── Row ───────────────────────────────────────────────────────────────── */
.row {
  position: relative;
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 13.5px;
  text-align: left;
}

/* Hairline inset to the label, the way macOS draws its lists. */
.row + .row::before,
.row + .reveal.is-open::before {
  content: "";
  position: absolute;
  top: 0;
  left: 14px;
  right: 0;
  height: 1px;
  background: var(--sep);
}

.row--nav,
.row--action,
.row--control {
  cursor: pointer;
  transition: background .12s ease-out;
}

.row--nav:hover,
.row--action:hover:not(:disabled),
.row--control:hover {
  background: color-mix(in srgb, var(--text) 5%, transparent);
}

.row--nav:active,
.row--action:active:not(:disabled) {
  background: color-mix(in srgb, var(--text) 9%, transparent);
}

.row--action:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.row__label {
  flex: 1 1 auto;
  min-width: 0;
}

.row__label--mono {
  font-family: var(--mono);
  font-size: 12.5px;
}

.row__value {
  flex: 0 0 auto;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.row__value--lead {
  color: var(--text);
  font-weight: 600;
}

.row__value--mono {
  font-family: var(--mono);
  font-size: 12px;
}

.row__value--tight {
  font-size: 12.5px;
}

.row__stack {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.row__title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__sub {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__trail {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.row__chev {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  color: var(--dim);
}

.row__state {
  font-size: 12px;
}

.pill {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--muted);
  background: color-mix(in srgb, var(--text) 9%, transparent);
}

.pill--admin {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.dot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dot i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.dot.is-active {
  color: var(--green);
}

.dot.is-disabled,
.dot.is-off {
  color: var(--dim);
}

.dot.is-banned {
  color: var(--red);
}

.row--action.is-danger .row__label {
  color: var(--red);
}

/* ── Badge rows ────────────────────────────────────────────────────────── */
.row__badge {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
}

.row--badge.is-shadowed {
  opacity: .55;
}

.row--badge.is-locked .row__label {
  color: var(--muted);
}

.row__hint {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__lock {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  color: var(--dim);
}

.row__remove {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--red);
  cursor: pointer;
  transition: transform .34s cubic-bezier(.34, 1.4, .64, 1), opacity .15s ease-out;
}

.row__remove:active:not(:disabled) {
  transform: scale(.82);
  transition-duration: .09s;
}

.row__remove:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.row__remove svg {
  width: 100%;
  height: 100%;
}

.row__plus {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  color: var(--accent);
  transition: transform .32s var(--ease);
}

.row__plus.is-open {
  transform: rotate(45deg);
}

/* One acknowledgement for a ban or a lockout, then the panel goes quiet. */
.grp__box.is-flash-danger {
  animation: ax-flash-danger .9s ease-out;
}

.grp__box.is-flash-restore {
  animation: ax-flash-restore .9s ease-out;
}

@keyframes ax-flash-danger {
  0% {
    background: var(--surface-2);
  }

  18% {
    background: color-mix(in srgb, var(--red) 26%, var(--surface-2));
  }

  100% {
    background: var(--surface-2);
  }
}

@keyframes ax-flash-restore {
  0% {
    background: var(--surface-2);
  }

  18% {
    background: color-mix(in srgb, var(--green) 22%, var(--surface-2));
  }

  100% {
    background: var(--surface-2);
  }
}

/* ── Reveal (badge picker) ─────────────────────────────────────────────── */
.reveal {
  position: relative;
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows .32s var(--ease);
}

.reveal.is-open {
  grid-template-rows: 1fr;
}

.reveal__inner {
  overflow: hidden;
  display: grid;
  gap: 10px;
}

.reveal.is-open .reveal__inner {
  padding: 11px 14px 13px;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.picker__empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px 4px 6px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: background .15s ease-out, transform .15s var(--ease);
}

.opt:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}

.opt:active:not(:disabled) {
  transform: scale(.96);
}

.opt:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.opt__icon {
  width: 17px;
  height: 17px;
}

/* ── Fields ────────────────────────────────────────────────────────────── */
.field {
  display: flex;
  gap: 7px;
}

.field__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: var(--field);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: box-shadow .15s ease-out;
}

.field__input:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
}

.field__btn,
.btn-plain,
.btn-filled {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 7px;
  background: var(--field);
  color: var(--text);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s ease-out, transform .15s var(--ease);
}

.btn-filled,
.field__btn {
  background: var(--accent);
  color: #fff;
}

.field__btn:active:not(:disabled),
.btn-plain:active:not(:disabled),
.btn-filled:active:not(:disabled) {
  transform: scale(.97);
}

.field__btn:disabled,
.btn-plain:disabled,
.btn-filled:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 11px;
  border-radius: 8px;
  background: var(--field);
}

.search svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--muted);
}

.search input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 13.5px;
  outline: none;
}

.search input::-webkit-search-cancel-button {
  filter: grayscale(1) opacity(.6);
}

.row__pick {
  flex: 0 0 auto;
  max-width: 60%;
}

/* ── Save bar ──────────────────────────────────────────────────────────── */
.save {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows .32s var(--ease);
}

.save.is-open {
  grid-template-rows: 1fr;
}

.save__inner {
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 7px;
}

.save.is-open .save__inner {
  padding-top: 4px;
}

.save__label {
  flex: 1 1 auto;
  font-size: 12px;
  color: var(--accent);
}

/* ── Switch ────────────────────────────────────────────────────────────── */
.sw {
  position: relative;
  flex: 0 0 auto;
  width: 40px;
  height: 24px;
}

.sw input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.sw__track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 16%, transparent);
  transition: background .28s var(--ease);
  pointer-events: none;
}

.sw__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
  transition: transform .28s var(--ease);
}

.sw input:checked ~ .sw__track {
  background: var(--green);
}

.sw input:checked ~ .sw__track .sw__knob {
  transform: translateX(16px);
}

.sw input:disabled ~ .sw__track {
  opacity: .5;
}

.sw input:focus-visible ~ .sw__track {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
}

/* ── Detail header ─────────────────────────────────────────────────────── */
.back {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-bottom: -8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-family: inherit;
  font-size: 13.5px;
  cursor: pointer;
  transition: opacity .15s ease-out;
}

.back:hover {
  opacity: .7;
}

.back svg {
  width: 16px;
  height: 16px;
}

.pane__title {
  margin: 0;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -.015em;
}

.empty {
  margin: 0;
  padding: 30px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 560px) {
  .seg__item {
    font-size: 11.5px;
    padding: 0 3px;
  }

  .row__trail {
    gap: 6px;
  }

  .row__state {
    display: none;
  }
}

/* Motion carries meaning here, never decoration, so it all reduces to a fade. */
@media (prefers-reduced-motion: reduce) {

  .push-enter-active,
  .push-leave-active,
  .pop-enter-active,
  .pop-leave-active,
  .forward-enter-active,
  .forward-leave-active,
  .back-enter-active,
  .back-leave-active {
    transition: opacity .2s linear;
  }

  .push-enter-from,
  .push-leave-to,
  .pop-enter-from,
  .pop-leave-to,
  .forward-enter-from,
  .forward-leave-to,
  .back-enter-from,
  .back-leave-to {
    transform: none;
  }

  .ax__stage,
  .seg__thumb,
  .row__plus,
  .reveal,
  .save,
  .sw__track,
  .sw__knob,
  .opt,
  .row__remove {
    transition-duration: .01ms;
  }

  .ax__refresh.is-busy svg {
    animation: none;
    opacity: .5;
  }

  .grp__box.is-flash-danger,
  .grp__box.is-flash-restore {
    animation: none;
  }
}
</style>
