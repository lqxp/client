<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type PropType } from "vue";
import type { Messenger } from "@/composables/useMessenger";
import { useI18n } from "@/composables/useI18n";
import { turnServerList, type TurnServerConfig } from "@/config/runtime";
import Icon from "@/components/Icon.vue";
import SelectMenu from "@/components/SelectMenu.vue";
import { targetChecked, targetValue } from "@/utils/inputEvent";

const props = defineProps({
  messenger: { type: Object as PropType<Messenger>, required: true },
  active: { type: Boolean, default: true }
});

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const showAddTurn = ref(false);
const newTurnLabel = ref("");
const newTurnUrls = ref("");
const newTurnUsername = ref("");
const newTurnCredential = ref("");
const turnServerError = ref("");

const turnServers = computed(() => props.messenger.turnServers.value || turnServerList());
const turnServerOptions = computed(() =>
  turnServers.value.map((server: TurnServerConfig) => ({ value: String(server.id), label: String(server.label) }))
);

function formatTurnUrl(url: string) {
  const m = url.match(/^(turn|turns|stun):([^:?]+)(?::(\d+))?(?:\?transport=(\w+))?$/);
  if (!m) return url;
  const [, proto, host, port, transport] = m;
  const protoLabel = proto === "turns" ? "TLS" : proto.toUpperCase();
  return `${protoLabel} ${port ? `${host}:${port}` : host}${transport ? ` (${transport})` : ""}`;
}

const selectedTurnInfo = computed(() => {
  const id = props.messenger.state.selectedTurnServerId;
  if (!id) return null;
  const srv = turnServers.value.find((s: TurnServerConfig) => s.id === id);
  if (!srv) return null;
  const hintKey = `settings.calls.turnHints.${id}`;
  const i18nHint = t(hintKey);
  return {
    urls: (srv.urls || []).map((u: string) => formatTurnUrl(u)).join(" · "),
    hint: i18nHint !== hintKey ? i18nHint : (srv.hint || "")
  };
});

function addCustomTurnServer() {
  turnServerError.value = "";
  const urls = newTurnUrls.value.split(/[\s,;]+/).map((u) => u.trim()).filter(Boolean);
  const ok = props.messenger.addCustomTurnServer({
    label: newTurnLabel.value,
    urls,
    username: newTurnUsername.value,
    credential: newTurnCredential.value,
  });
  if (!ok) {
    turnServerError.value = t("settings.calls.turnInvalid");
    return;
  }
  newTurnLabel.value = "";
  newTurnUrls.value = "";
  newTurnUsername.value = "";
  newTurnCredential.value = "";
}

const DISCLOSE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function discloseRow(element: Element, done: () => void, opening: boolean) {
  const node = element as HTMLElement;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return done();
  const style = window.getComputedStyle(node);
  const open = {
    height: `${node.offsetHeight}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    opacity: 1,
    transform: "translateY(0)",
  };
  const shut = { height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0, transform: "translateY(-4px)" };
  const index = Number(node.dataset.discloseIndex) || 0;
  node.style.overflow = "hidden";
  const animation = node.animate(opening ? [shut, open] : [open, shut], {
    duration: opening ? 320 : 240,
    delay: opening ? index * 45 : 0,
    easing: DISCLOSE_EASE,
    fill: "backwards",
  });
  animation.onfinish = () => {
    node.style.overflow = "";
    done();
  };
}

function discloseEnter(element: Element, done: () => void) {
  discloseRow(element, done, true);
}

function discloseLeave(element: Element, done: () => void) {
  discloseRow(element, done, false);
}

const devicesOfKind = (kind: MediaDeviceKind) =>
  computed(() => props.messenger.state.audioDevices.filter((device) => device.kind === kind));
const microphones = devicesOfKind("audioinput");
const headphones = devicesOfKind("audiooutput");
const cameras = devicesOfKind("videoinput");

function deviceOptions(devices: MediaDeviceInfo[], fallback: string) {
  return [
    { value: "", label: t("settings.calls.systemDefault") },
    ...devices.map((device: MediaDeviceInfo, index: number) => ({
      value: String(device.deviceId || ""),
      label: device.label || `${fallback} ${index + 1}`
    }))
  ];
}
const microphoneOptions = computed(() => deviceOptions(microphones.value, t("settings.calls.microphone")));
const speakerOptions = computed(() => deviceOptions(headphones.value, t("settings.calls.speakers")));
const cameraOptions = computed(() => deviceOptions(cameras.value, t("settings.calls.camera")));

const clampPercent = (value: unknown) => Math.max(0, Math.min(100, Number(value) || 0));
const micLevel = computed(() => clampPercent(props.messenger.state.micTestLevel));
const micGate = computed(() => clampPercent(props.messenger.state.microphoneThreshold));
const micGateOpen = computed(
  () => Boolean(props.messenger.state.micTestActive) && micLevel.value > 0 && micLevel.value >= micGate.value
);

const LEVEL_BARS = 16;
const levelBars = Array.from({ length: LEVEL_BARS }, (_, index) => index + 1);
const litBars = computed(() => Math.round((micLevel.value / 100) * LEVEL_BARS));
const gateBar = computed(() => Math.max(1, Math.ceil((micGate.value / 100) * LEVEL_BARS)));

const cameraPreviewRef = ref<HTMLVideoElement | null>(null);
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
    cameraPreviewError.value = t("settings.calls.cameraUnavailable");
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
    cameraPreviewError.value = error instanceof Error ? error.message : t("settings.calls.cameraPreviewError");
    stopCameraPreview();
  } finally {
    cameraPreviewLoading.value = false;
  }
}

async function onVideoInputChanged(deviceId: string) {
  props.messenger.setVideoInput(deviceId);
  if (cameraPreviewActive.value) await startCameraPreview();
}

function release() {
  props.messenger.stopMicTest();
  stopCameraPreview();
}

watch(() => props.active, (active) => {
  if (active) props.messenger.refreshAudioDevices();
  else release();
});

onMounted(() => {
  if (props.active) props.messenger.refreshAudioDevices();
});

onBeforeUnmount(release);
</script>

<template>
  <section class="settings-page">
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
            <Icon name="close" viewBox="0 0 24 24" />
          </button>
        </div>
      </div>
    </div>

    <div class="settings-group">
      <button type="button" class="btn settings-btn" @click="showAddTurn = !showAddTurn">
        {{ showAddTurn ? t('settings.calls.hideAddTurn') : t('settings.calls.showAddTurn') }}
      </button>

      <TransitionGroup :css="false" @enter="discloseEnter" @leave="discloseLeave">
        <div v-if="showAddTurn" key="turn-label" data-disclose-index="0" class="turn-form-field">
          <label class="turn-form-field__label" for="turn-field-label">{{ t('settings.calls.turnLabel') }}</label>
          <input id="turn-field-label" v-model="newTurnLabel" type="text" class="settings-input"
            :placeholder="t('settings.calls.turnLabelPlaceholder')" />
        </div>

        <div v-if="showAddTurn" key="turn-urls" data-disclose-index="1" class="turn-form-field">
          <label class="turn-form-field__label" for="turn-field-urls">{{ t('settings.calls.turnUrls') }}</label>
          <input id="turn-field-urls" v-model="newTurnUrls" type="text" class="settings-input" spellcheck="false"
            placeholder="turn:host:3478?transport=udp, turns:host:5349?transport=tcp" />
        </div>

        <div v-if="showAddTurn" key="turn-username" data-disclose-index="2" class="turn-form-field">
          <label class="turn-form-field__label" for="turn-field-username">{{ t('settings.calls.turnUsername') }}</label>
          <input id="turn-field-username" v-model="newTurnUsername" type="text" class="settings-input" autocomplete="off" />
        </div>

        <div v-if="showAddTurn" key="turn-credential" data-disclose-index="3" class="turn-form-field">
          <label class="turn-form-field__label" for="turn-field-credential">{{ t('settings.calls.turnCredential') }}</label>
          <input id="turn-field-credential" v-model="newTurnCredential" type="password" class="settings-input"
            autocomplete="new-password" />
        </div>

        <p v-if="showAddTurn && turnServerError" key="turn-error" data-disclose-index="4"
          class="settings-note settings-note--error">{{ turnServerError }}</p>
        <button v-if="showAddTurn" key="turn-submit" data-disclose-index="4" type="button"
          class="btn settings-btn turn-form-submit"
          :disabled="!newTurnUrls.trim() || !newTurnLabel.trim()" @click="addCustomTurnServer">
          {{ t('settings.calls.addTurnServer') }}
        </button>
      </TransitionGroup>
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

      <div class="settings-camera-preview"
        :class="{ 'is-live': cameraPreviewActive && !cameraPreviewLoading }">

        <video ref="cameraPreviewRef" autoplay muted playsinline></video>
        <Transition name="camera-state">
          <div v-if="cameraPreviewError" key="error" class="settings-camera-preview__state is-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 8.5v4" />
              <path d="M12 16h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            <span>{{ cameraPreviewError }}</span>
          </div>
          <div v-else-if="cameraPreviewLoading" key="loading" class="settings-camera-preview__state">
            <span class="settings-camera-preview__spinner" aria-hidden="true"></span>
            <span>{{ t('settings.calls.startingCamera') }}</span>
          </div>
          <div v-else-if="!cameraPreviewActive" key="idle" class="settings-camera-preview__state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="2.5" y="6.5" width="13" height="11" rx="2.5" />
              <path d="M15.5 10.8l6-3.2v8.8l-6-3.2z" />
            </svg>
            <span>{{ t('settings.calls.cameraPreview') }}</span>
          </div>
        </Transition>
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
      <div class="settings-range">
        <div class="settings-range__head">
          <span class="settings-range__label">{{ t('settings.calls.micThreshold') }}</span>
          <span class="settings-range__value">{{ micGate }}</span>
        </div>
        <div class="mac-slider" :style="{ '--p': micGate / 100 }">
          <span class="mac-slider__track"></span>
          <span class="mac-slider__fill"></span>
          <input class="mac-slider__input" type="range" min="0" max="100" step="1" :value="micGate"
            :aria-label="t('settings.calls.micThreshold')"
            @input="messenger.setMicrophoneThreshold(targetValue($event))" />
          <span class="mac-slider__knob" aria-hidden="true"></span>
        </div>
        <p class="settings-range__hint">{{ t('settings.calls.micThresholdHint') }}</p>
      </div>

      <div class="settings-level">
        <span class="settings-level__label">{{ t('settings.calls.inputLevel') }}</span>
        <span class="settings-level__meter" :class="{ 'is-open': micGateOpen }" role="img"
          :aria-label="`${t('settings.calls.inputLevel')}: ${micLevel}`">
          <span v-for="bar in levelBars" :key="bar" class="settings-level__bar"
            :class="{ 'is-lit': bar <= litBars, 'is-gate': bar === gateBar }"></span>
        </span>
      </div>

      <p class="settings-note mic-gate__status" :class="{ 'is-open': micGateOpen }">
        {{ messenger.state.micTestActive
          ? (micGateOpen ? t('settings.calls.micGateOpen') : t('settings.calls.micGateClosed'))
          : t('settings.calls.micGateIdle') }}
      </p>

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
</template>

<style scoped>
.turn-server-detail {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--field-bg);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.turn-server-detail__urls {
  font-size: 12px;
  color: var(--muted);
  font-family: monospace;
  word-break: break-all;
}

.turn-server-detail__hint {
  font-size: 11px;
  color: var(--muted);
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
  background: var(--field-bg);
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
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.custom-turn-row__info small {
  font-size: 11px;
  color: var(--muted);
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
  align-items: center;
  gap: 14px;
  min-height: 44px;
}

.turn-form-field__label {
  flex: 0 0 9.5rem;
  color: var(--text);
  font-size: 15px;
}

@media (max-width: 760px) {

  .turn-form-field {
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 10px;
    padding-bottom: 12px;
  }

  .turn-form-field__label {
    flex-basis: 100%;
  }

}

.turn-form-submit {
  margin-top: 16px;
}

.settings-note--error {
  color: var(--red, #ff6b70);
}

.settings-range__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.settings-range__value {
  color: var(--muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.settings-range__hint {
  margin: -5px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.mac-slider {
  position: relative;
  height: 22px;
  margin-top: 2px;
}

.mac-slider__track,
.mac-slider__fill {
  position: absolute;
  top: 50%;
  left: 9px;
  height: 4px;
  margin-top: -2px;
  border-radius: 999px;
  pointer-events: none;
}

.mac-slider__track {
  right: 9px;
  background: var(--chart-track);
}

.mac-slider__fill {
  width: calc((100% - 18px) * var(--p));
  background: var(--accent);
}

.mac-slider__knob {
  position: absolute;
  top: 50%;
  left: calc(9px + (100% - 18px) * var(--p));
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .34), 0 0 0 .5px rgba(0, 0, 0, .14);
  pointer-events: none;
  transition: transform var(--dur-base) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.mac-slider__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
}

.mac-slider__input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 999px;
}

.mac-slider__input::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
}

.mac-slider__input:hover ~ .mac-slider__knob {
  transform: scale(1.08);
}

.mac-slider__input:active ~ .mac-slider__knob {
  transform: scale(1.16);
}

.mac-slider__input:focus-visible ~ .mac-slider__knob {
  box-shadow: 0 1px 3px rgba(0, 0, 0, .34), 0 0 0 3px color-mix(in srgb, var(--accent) 55%, transparent);
}

.settings-level {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 42px;
}

.settings-level__label {
  color: var(--text);
  font-size: 15.5px;
}

.settings-level__meter {
  display: flex;
  align-items: center;
  gap: 3px;
}

.settings-level__bar {
  width: 5px;
  height: 13px;
  border-radius: 2px;
  background: var(--chart-track);
  transition: background-color 90ms linear;
}

.settings-level__bar.is-lit {
  background: color-mix(in srgb, var(--text) 52%, transparent);
}

.settings-level__meter.is-open .settings-level__bar.is-lit {
  background: var(--green);
}

.settings-level__bar.is-gate {
  height: 19px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 45%, transparent);
}

.mic-gate__status {
  transition: color var(--dur-base) var(--ease-out);
}

.mic-gate__status.is-open {
  color: var(--green);
}

@media (prefers-reduced-motion: reduce) {

  .mac-slider__knob,
  .settings-level__bar {
    transition: none;
  }

  .mac-slider__input:hover ~ .mac-slider__knob,
  .mac-slider__input:active ~ .mac-slider__knob {
    transform: none;
  }
}

.settings-camera-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  margin-top: 14px;
  margin-bottom: 12px;
  overflow: hidden;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg) 70%, #000);
  box-shadow: inset 0 0 0 1px var(--line-strong);
}

.settings-camera-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: transparent;
  transform: scaleX(-1);
  opacity: 0;
  transition: opacity var(--dur-slow) var(--ease-out);
}

.settings-camera-preview.is-live video {
  opacity: 1;
}

.settings-camera-preview__state {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 16px;
  color: var(--muted);
  text-align: center;
  font-size: 14px;
}

.settings-camera-preview__state svg {
  width: 30px;
  height: 30px;
  opacity: .72;
}

.settings-camera-preview__state.is-error {
  color: var(--red);
}

.settings-camera-preview__spinner {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--text) 18%, transparent);
  border-top-color: var(--accent);
  animation: camera-spin 720ms linear infinite;
}

.camera-state-enter-active,
.camera-state-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.camera-state-enter-from,
.camera-state-leave-to {
  opacity: 0;
  transform: scale(.97);
}

.settings-camera-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

@media (prefers-reduced-motion: reduce) {

  .settings-camera-preview video,
  .camera-state-enter-active,
  .camera-state-leave-active {
    transition: none;
  }

  .settings-camera-preview__spinner {
    animation-duration: 2.4s;
  }
}

@keyframes camera-spin {
  to { transform: rotate(1turn); }
}
</style>
