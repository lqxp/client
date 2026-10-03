<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import type { useDialog } from "@/composables/useDialog";
import { takePickedFile } from "@/utils/pickedFile";
import Icon from "@/components/Icon.vue";
import { localPlatform, type CloudSync } from "@/composables/useCloudSync";
import type { Messenger } from "@/composables/useMessenger";

const i18n = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const { t } = i18n;
const dialog = inject<ReturnType<typeof useDialog>>("dialog")!;
const cloudSync = inject<CloudSync>("cloudSync")!;

const props = defineProps<{ messenger: Messenger }>();
const backupFileInputRef = ref<HTMLInputElement | null>(null);

function onExportBackup() { props.messenger.exportData(); }
function onImportBackup() { backupFileInputRef.value?.click(); }
function onBackupFilePicked(event: Event) {
  const file = takePickedFile(event);
  if (file) props.messenger.importData(file);
}
async function onClearBackup() {
  if (!await dialog.showConfirm(t('dialog.clearDataConfirm'), "", { danger: true, confirmLabel: t('dialog.clear') })) return;
  props.messenger.clearAllData();
  props.messenger.state.settingsOpen = false;
}
const hasWords = computed(() => {
  const w = (props.messenger.state as unknown as Record<string, unknown>).recoveryWords;
  return Array.isArray(w) && w.length >= 12;
});
const myId = computed(() =>
  String((props.messenger.state as unknown as Record<string, unknown>).deviceId || ""),
);
const myPlatform = computed(() => localPlatform());
const shortId = (id: string) =>
  id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
const peerSince = (ts: number) =>
  ts ? new Date(ts).toLocaleString() : "—";
const platformIcon = (p: string) =>
  p === "mobile" ? "smartphone" : p === "desktop" ? "monitor" : "globe";
const platformLabel = (p: string) =>
  p === "mobile" ? t("cloudsync.platformMobile") : p === "desktop" ? t("cloudsync.platformDesktop") : t("cloudsync.platformWeb");
</script>

<template>
  <section class="settings-page">
    <div class="settings-group">
      <h4>{{ t("cloudsync.title") }}</h4>
      <p class="settings-note">{{ t("cloudsync.note") }}</p>
      <label class="settings-check">
        <span>{{ t("cloudsync.enable") }}</span>
        <span class="toggle" :class="{ 'is-on': cloudSync.state.enabled }">
          <input
            type="checkbox"
            :checked="cloudSync.state.enabled"
            @change="cloudSync.setEnabled(($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </span>
      </label>
      <p class="settings-note">{{ t("cloudsync.relayNote") }}</p>
    </div>

    <div class="settings-group">
      <h4>{{ t("cloudsync.devices") }}</h4>
      <div class="sync-devices">
        <div class="sync-device sync-device--self">
          <span class="sync-device__icon" aria-hidden="true">
            <Icon :name="platformIcon(myPlatform)" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </span>
          <div class="sync-device__meta">
            <strong>{{ t("cloudsync.thisDevice") }} · {{ platformLabel(myPlatform) }}</strong>
            <code>{{ shortId(myId) || "—" }}</code>
          </div>
        </div>
        <div
          v-for="p in cloudSync.state.peers"
          :key="p.id"
          class="sync-device"
        >
          <span class="sync-device__icon" aria-hidden="true">
            <Icon :name="platformIcon(p.platform)" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </span>
          <div class="sync-device__meta">
            <strong>{{ platformLabel(p.platform) }}</strong>
            <code>{{ shortId(p.id) }}</code>
            <small>epoch {{ p.epoch }} · {{ t("cloudsync.lastSync") }}: {{ peerSince(p.lastSeen) }}</small>
          </div>
          <div class="sync-device__side">
            <span class="sync-device__badge">{{ t("cloudsync.paired") }}</span>
            <button
              type="button"
              class="btn settings-btn settings-btn--danger sync-device__unpair"
              :title="t('cloudsync.unpair')"
              @click="cloudSync.unpairPeer(p.id)"
            >
              {{ t("cloudsync.unpair") }}
            </button>
          </div>
        </div>
        <p v-if="!cloudSync.state.peers.length" class="settings-note">
          {{ cloudSync.state.phase === "hello-sent" ? t("cloudsync.waitingPeer") : t("cloudsync.unpaired") }}
        </p>
      </div>
      <div v-if="!hasWords" class="settings-note settings-note--danger">
        {{ t("cloudsync.wordsMissing") }}
      </div>
      <p v-if="cloudSync.state.lastError" class="settings-note settings-note--danger">
        {{ cloudSync.state.lastError }}
      </p>
      <div class="settings-actions">
        <button
          type="button"
          class="btn settings-btn"
          :disabled="!cloudSync.state.enabled || cloudSync.state.pairingBusy"
          @click="cloudSync.startPairing()"
        >
          {{ t("cloudsync.pair") }}
        </button>
        <button
          type="button"
          class="btn settings-btn"
          :disabled="!cloudSync.state.peers.length"
          @click="cloudSync.pushSnapshot()"
        >
          {{ t("cloudsync.syncNow") }}
        </button>
        <button
          type="button"
          class="btn settings-btn settings-btn--danger"
          :disabled="!cloudSync.state.peers.length && !cloudSync.state.enabled"
          @click="cloudSync.revoke()"
        >
          {{ t("cloudsync.revoke") }}
        </button>
      </div>
      <p class="settings-note">{{ t("cloudsync.autoPairNote") }}</p>
      <p v-if="cloudSync.state.lastSyncAt" class="settings-note">
        {{ t("cloudsync.lastSync") }}: {{ new Date(cloudSync.state.lastSyncAt).toLocaleString() }}
      </p>
      <p class="settings-note">
        {{ t("cloudsync.diag", {
          sent: String(cloudSync.state.diag.sent),
          received: String(cloudSync.state.diag.received),
          applied: String(cloudSync.state.diag.applied),
          failed: String(cloudSync.state.diag.failed),
        }) }}
      </p>
    </div>

    <div class="settings-group">
      <h4>{{ t("cloudsync.whatToSync") }}</h4>
      <label class="settings-check">
        <span>{{ t("cloudsync.domainRooms") }}</span>
        <span class="toggle" :class="{ 'is-on': cloudSync.state.domains.rooms }">
          <input
            type="checkbox"
            :checked="cloudSync.state.domains.rooms"
            @change="cloudSync.setDomain('rooms', ($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </span>
      </label>
      <label class="settings-check">
        <span>{{ t("cloudsync.domainMessages") }}</span>
        <span class="toggle" :class="{ 'is-on': cloudSync.state.domains.messages }">
          <input
            type="checkbox"
            :checked="cloudSync.state.domains.messages"
            @change="cloudSync.setDomain('messages', ($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </span>
      </label>
      <label class="settings-check">
        <span>{{ t("cloudsync.domainParams") }}</span>
        <span class="toggle" :class="{ 'is-on': cloudSync.state.domains.params }">
          <input
            type="checkbox"
            :checked="cloudSync.state.domains.params"
            @change="cloudSync.setDomain('params', ($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </span>
      </label>
      <div v-if="cloudSync.state.domains.params" class="sync-subgroups">
        <label class="settings-check settings-check--sub">
          <span>{{ t("cloudsync.groupAppearance") }}</span>
          <span class="toggle" :class="{ 'is-on': cloudSync.state.paramGroups.appearance }">
            <input
              type="checkbox"
              :checked="cloudSync.state.paramGroups.appearance"
              @change="cloudSync.setParamGroup('appearance', ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </span>
        </label>
        <label class="settings-check settings-check--sub">
          <span>{{ t("cloudsync.groupSounds") }}</span>
          <span class="toggle" :class="{ 'is-on': cloudSync.state.paramGroups.sounds }">
            <input
              type="checkbox"
              :checked="cloudSync.state.paramGroups.sounds"
              @change="cloudSync.setParamGroup('sounds', ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </span>
        </label>
        <label class="settings-check settings-check--sub">
          <span>{{ t("cloudsync.groupBehavior") }}</span>
          <span class="toggle" :class="{ 'is-on': cloudSync.state.paramGroups.behavior }">
            <input
              type="checkbox"
              :checked="cloudSync.state.paramGroups.behavior"
              @change="cloudSync.setParamGroup('behavior', ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </span>
        </label>
        <label class="settings-check settings-check--sub">
          <span>{{ t("cloudsync.groupGeneral") }}</span>
          <span class="toggle" :class="{ 'is-on': cloudSync.state.paramGroups.general }">
            <input
              type="checkbox"
              :checked="cloudSync.state.paramGroups.general"
              @change="cloudSync.setParamGroup('general', ($event.target as HTMLInputElement).checked)"
            />
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
          </span>
        </label>
        <p class="settings-note">{{ t("cloudsync.localeNote") }}</p>
      </div>
      <label class="settings-check">
        <span>{{ t("cloudsync.domainFriendKeys") }}</span>
        <span class="toggle" :class="{ 'is-on': cloudSync.state.domains.friendKeys }">
          <input
            type="checkbox"
            :checked="cloudSync.state.domains.friendKeys"
            @change="cloudSync.setDomain('friendKeys', ($event.target as HTMLInputElement).checked)"
          />
          <span class="toggle__track"><span class="toggle__thumb"></span></span>
        </span>
      </label>
    </div>

    <div v-if="cloudSync.state.conflicts.length" class="settings-group">
      <h4>{{ t("cloudsync.conflicts") }}</h4>
      <p class="settings-note">{{ t("cloudsync.conflictsNote") }}</p>
      <div v-for="c in cloudSync.state.conflicts" :key="c.roomId" class="phantom-blocked-row">
        <code>{{ shortId(c.roomId) }}</code>
        <div class="settings-actions">
          <button type="button" class="btn settings-btn" @click="cloudSync.resolveConflict(c.roomId, 'local')">
            {{ t("cloudsync.keepLocal") }}
          </button>
          <button type="button" class="btn settings-btn" @click="cloudSync.resolveConflict(c.roomId, 'remote')">
            {{ t("cloudsync.requestRemote") }}
          </button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <h4>{{ t('settings.backups.title') }}</h4>
      <p class="settings-note">{{ t('settings.backups.note') }}</p>
      <div class="settings-actions">
        <button type="button" class="btn settings-btn" @click="onExportBackup">
          <Icon name="upload" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round" />
          {{ t('settings.backups.export') }}
        </button>
        <button type="button" class="btn settings-btn" @click="onImportBackup">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21V9" />
            <path d="m6 15 6 6 6-6" />
            <path d="M5 3h14" />
          </svg>
          {{ t('settings.backups.import') }}
        </button>
        <button type="button" class="btn settings-btn settings-btn--danger" @click="onClearBackup">
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
    <input ref="backupFileInputRef" type="file" accept="application/json,.json" style="display: none"
      @change="onBackupFilePicked" />
  </section>
</template>

<style scoped>
.sync-devices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 12px;
}
.sync-device {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  border-radius: 10px;
}
.sync-device__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent, #3b82f6) 13%, transparent);
  color: var(--accent, #3b82f6);
  flex: none;
}
.sync-device--self .sync-device__icon {
  background: var(--accent, #3b82f6);
  color: #fff;
}
.sync-device__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.sync-device__meta code {
  font-size: 12px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sync-device__meta {
  overflow-wrap: anywhere;
}
.sync-device__meta small {
  opacity: 0.7;
  line-height: 1.45;
}
.sync-device__side {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex: none;
}
.sync-device__badge {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  white-space: nowrap;
}
.sync-device__unpair {
  flex: none;
  min-height: 36px;
}
.sync-subgroups {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 2px solid var(--border, rgba(128, 128, 128, 0.25));
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Narrow screens: the device card breathes — icon + identity on the first
   row, status + unpair on a full-width second row instead of one squeezed
   strip. Buttons keep a 40px+ touch target. */
@media (max-width: 560px) {
  .sync-devices {
    gap: 12px;
  }
  .sync-device {
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px;
    border-radius: 14px;
  }
  .sync-device__icon {
    width: 42px;
    height: 42px;
  }
  .sync-device__meta {
    flex: 1 1 calc(100% - 54px);
    gap: 4px;
  }
  .sync-device__meta strong {
    font-size: 14.5px;
  }
  .sync-device__meta code {
    font-size: 12.5px;
  }
  .sync-device__side {
    flex: 1 1 100%;
    margin-left: 0;
    justify-content: space-between;
  }
  .sync-device__unpair {
    flex: 1;
    min-height: 42px;
  }
  .sync-subgroups {
    margin-left: 4px;
    padding-left: 10px;
    gap: 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sync-device {
    transition: none;
  }
}
</style>
