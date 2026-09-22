<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import type { Messenger } from "@/composables/useMessenger";
import type { PropType } from "vue";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Voice message" },
  sizeLabel: { type: String, default: "" },
  fallbackDuration: { type: [String, Number] as PropType<string | number>, default: "" },
  waveform: { type: Array as () => number[], default: () => [] },
  messenger: { type: Object as PropType<Messenger>, default: null },
  resumeKey: { type: String, default: "" },
  chain: { type: Boolean, default: false }
});

const rootRef = ref<HTMLElement | null>(null);
const audioRef = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const decodedDuration = ref(0);
const canPlay = ref(false);
const playbackRate = ref(1);
const isHoveringWave = ref(false);
const hoverProgress = ref(0);
const rawWaveBars = ref<number[]>([]);

let frameId = 0;
let playbackStartedAt = 0;
let playbackBaseTime = 0;

const BAR_COUNT = 32;
// Some engines report an unknown length as Infinity, WebKitGTK as a huge finite number.
const MAX_SANE_SECONDS = 12 * 3600;
const CHAIN_EVENT = "qx:voice-play";

const defaultBars = [
  25, 35, 55, 40, 70, 85, 60, 45, 75, 90, 65, 50, 80, 70, 45, 60,
  85, 55, 35, 65, 80, 55, 70, 90, 60, 45, 75, 50, 40, 55, 35, 25
];

const waveBars = computed(() => {
  if (Array.isArray(props.waveform) && props.waveform.length > 0) return props.waveform;
  if (rawWaveBars.value.length > 0) return rawWaveBars.value;
  return defaultBars;
});

function isSaneDuration(value: number) {
  return Number.isFinite(value) && value > 0 && value < MAX_SANE_SECONDS;
}

function parseClock(value: string | number) {
  if (typeof value === "number") return isSaneDuration(value) ? value : 0;
  const parts = String(value || "").trim().split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return 0;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return isSaneDuration(seconds) ? seconds : 0;
}

function formatClock(seconds: number) {
  const value = isSaneDuration(seconds) ? Math.floor(seconds) : 0;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(value % 60).padStart(2, "0")}`;
}

const fallbackDurationSeconds = computed(() => parseClock(props.fallbackDuration));
const referenceDuration = computed(() => decodedDuration.value || fallbackDurationSeconds.value);
const effectiveDuration = computed(() => {
  const media = duration.value;
  const reference = referenceDuration.value;
  if (!isSaneDuration(media)) return reference;
  if (reference && Math.abs(media - reference) > Math.max(2, reference * 0.2)) return reference;
  return media;
});

function clampTime(value: number) {
  const time = isSaneDuration(value) ? value : 0;
  return effectiveDuration.value ? Math.min(time, effectiveDuration.value) : 0;
}

const progress = computed(() => {
  if (!effectiveDuration.value) return 0;
  return Math.min(100, (currentTime.value / effectiveDuration.value) * 100);
});

const elapsedLabel = computed(() => formatClock(currentTime.value));
const durationLabel = computed(() => formatClock(effectiveDuration.value));

// Decoded once per file: the only duration that no engine can get wrong.
const decodeCache = new Map<string, { bars: number[]; duration: number }>();
let decoding = "";

async function decodeAudio(url: string) {
  if (!url || decoding === url) return;
  const cached = decodeCache.get(url);
  if (cached) {
    rawWaveBars.value = cached.bars;
    decodedDuration.value = cached.duration;
    return;
  }
  decoding = url;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const buffer = await res.arrayBuffer();
    const AudioContextClass = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioCtx = new AudioContextClass();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));
    } catch {
      audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        audioCtx.decodeAudioData(buffer.slice(0), resolve, reject);
      });
    }
    audioCtx.close().catch(() => {});

    const channel = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(channel.length / BAR_COUNT));
    const amplitudes: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const start = i * step;
      const count = Math.max(0, Math.min(step, channel.length - start));
      let sum = 0;
      for (let j = 0; j < count; j++) sum += channel[start + j] ** 2;
      amplitudes.push(count > 0 ? Math.sqrt(sum / count) : 0);
    }
    const max = Math.max(...amplitudes, 0.001);
    const bars = amplitudes.map((value) => Math.max(16, Math.min(100, Math.round((value / max) * 100))));
    const exact = isSaneDuration(audioBuffer.duration) ? audioBuffer.duration : 0;
    decodeCache.set(url, { bars, duration: exact });
    if (props.src !== url) return;
    rawWaveBars.value = bars;
    decodedDuration.value = exact;
  } catch {
    // The recorded label and the default bars stand in.
  } finally {
    if (decoding === url) decoding = "";
  }
}

function needsDecode() {
  return !props.waveform?.length || (!fallbackDurationSeconds.value && !isSaneDuration(duration.value));
}

// Positions live in memory only: nothing about what was listened to reaches the disk.
const resumePositions = new Map<string, number>();
let stopActive: (() => void) | null = null;

function rememberPosition() {
  if (!props.resumeKey) return;
  const time = currentTime.value;
  if (time > 1 && effectiveDuration.value && time < effectiveDuration.value - 1) resumePositions.set(props.resumeKey, time);
  else resumePositions.delete(props.resumeKey);
}

function syncAudioState() {
  const audio = audioRef.value;
  if (!audio) return;
  if (isSaneDuration(audio.duration)) duration.value = audio.duration;
  else if (!referenceDuration.value) void decodeAudio(props.src);
  const nextTime = clampTime(audio.currentTime);
  if (nextTime > 0 || !isPlaying.value && !resumePositions.has(props.resumeKey)) currentTime.value = nextTime;
}

function stopProgressLoop() {
  if (!frameId) return;
  cancelAnimationFrame(frameId);
  frameId = 0;
}

function startProgressLoop() {
  stopProgressLoop();
  playbackStartedAt = performance.now();
  playbackBaseTime = currentTime.value;

  const tick = () => {
    const audio = audioRef.value;
    if (!audio || audio.paused || audio.ended) {
      frameId = 0;
      return;
    }
    const mediaTime = clampTime(audio.currentTime);
    if (mediaTime > 0) {
      currentTime.value = mediaTime;
      playbackStartedAt = performance.now();
      playbackBaseTime = mediaTime;
    } else if (effectiveDuration.value) {
      const elapsed = ((performance.now() - playbackStartedAt) / 1000) * playbackRate.value;
      currentTime.value = Math.min(effectiveDuration.value, playbackBaseTime + elapsed);
    }
    if (isSaneDuration(audio.duration)) duration.value = audio.duration;
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);
}

function pauseSelf() {
  const audio = audioRef.value;
  if (audio && !audio.paused) audio.pause();
}

async function play() {
  const audio = audioRef.value;
  if (!audio) return;
  try {
    if (audio.ended || (effectiveDuration.value && currentTime.value >= effectiveDuration.value - 0.2)) {
      currentTime.value = 0;
    }
    if (Math.abs((isSaneDuration(audio.currentTime) ? audio.currentTime : 0) - currentTime.value) > 0.3) {
      audio.currentTime = currentTime.value;
    }
    audio.volume = 1.0;
    audio.muted = false;
    audio.playbackRate = playbackRate.value;
    if (stopActive && stopActive !== pauseSelf) stopActive();
    stopActive = pauseSelf;
    await audio.play();
    isPlaying.value = true;
    startProgressLoop();
  } catch (err) {
    console.warn("Audio play failed:", err);
    isPlaying.value = false;
    stopProgressLoop();
  }
}

async function togglePlayback() {
  const audio = audioRef.value;
  if (!audio) return;
  if (audio.paused) {
    await play();
    return;
  }
  audio.pause();
}

function playFromStart() {
  currentTime.value = 0;
  if (props.resumeKey) resumePositions.delete(props.resumeKey);
  void play();
}

function playNextInChain() {
  const root = rootRef.value;
  if (!props.chain || !root) return;
  const players = Array.from(document.querySelectorAll<HTMLElement>("[data-voice-chain]"));
  const next = players[players.indexOf(root) + 1];
  next?.dispatchEvent(new CustomEvent(CHAIN_EVENT));
}

function seekByProgress(pct: number) {
  const audio = audioRef.value;
  const dur = effectiveDuration.value;
  if (!dur) return;
  const nextTime = Math.max(0, Math.min(dur, (pct / 100) * dur));
  currentTime.value = nextTime;
  if (audio) {
    try {
      audio.currentTime = nextTime;
    } catch {
      /* ignore */
    }
  }
  playbackStartedAt = performance.now();
  playbackBaseTime = nextTime;
  if (!isPlaying.value) rememberPosition();
}

function onWaveClick(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  seekByProgress(Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)));
}

function onWaveMouseMove(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  hoverProgress.value = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  isHoveringWave.value = true;
}

function onWaveMouseLeave() {
  isHoveringWave.value = false;
}

function cyclePlaybackRate() {
  const rates = [0.5, 1, 1.5, 2];
  playbackRate.value = rates[(rates.indexOf(playbackRate.value) + 1) % rates.length];
  if (audioRef.value) audioRef.value.playbackRate = playbackRate.value;
}

function downloadAudio() {
  if (!props.src) return;
  const a = document.createElement("a");
  a.href = props.src;
  a.download = props.filename || "voice-message.webm";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function onLoadedMetadata() {
  canPlay.value = true;
  const audio = audioRef.value;
  if (audio) {
    audio.volume = 1.0;
    audio.muted = false;
    props.messenger?.applyAudioOutput?.(audio);
  }
  syncAudioState();
}

watch(
  () => props.messenger?.state.selectedAudioOutputId,
  () => {
    if (audioRef.value) props.messenger?.applyAudioOutput?.(audioRef.value);
  }
);

function onPlay() {
  isPlaying.value = true;
  startProgressLoop();
}

function onPause() {
  isPlaying.value = false;
  stopProgressLoop();
  syncAudioState();
  rememberPosition();
  if (stopActive === pauseSelf) stopActive = null;
}

function onEnded() {
  isPlaying.value = false;
  stopProgressLoop();
  if (stopActive === pauseSelf) stopActive = null;
  if (props.resumeKey) resumePositions.delete(props.resumeKey);
  currentTime.value = effectiveDuration.value;
  playNextInChain();
}

watch(
  () => props.src,
  (newSrc) => {
    stopProgressLoop();
    isPlaying.value = false;
    duration.value = 0;
    decodedDuration.value = 0;
    canPlay.value = false;
    currentTime.value = resumePositions.get(props.resumeKey) ?? 0;
    if (newSrc && needsDecode()) void decodeAudio(newSrc);
  },
  { immediate: true }
);

onMounted(() => {
  rootRef.value?.addEventListener(CHAIN_EVENT, playFromStart);
});

onBeforeUnmount(() => {
  stopProgressLoop();
  rootRef.value?.removeEventListener(CHAIN_EVENT, playFromStart);
  if (stopActive === pauseSelf) stopActive = null;
  rememberPosition();
  audioRef.value?.pause();
});
</script>

<template>
  <div ref="rootRef" class="voice-player" :class="{ 'is-playing': isPlaying }" :data-voice-chain="chain ? '' : undefined">
    <audio
      ref="audioRef"
      :src="src"
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="syncAudioState"
      @timeupdate="syncAudioState"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    ></audio>

    <button
      class="voice-player__play"
      type="button"
      :aria-label="isPlaying ? t('audio.pause') : t('audio.play')"
      @click="togglePlayback"
    >
      <Transition name="apple-pop" mode="out-in">
        <!-- Perfectly Centered Pause Icon -->
        <svg v-if="isPlaying" key="pause" viewBox="0 0 24 24" class="voice-player__icon" fill="currentColor">
          <rect x="5.5" y="4.5" width="4" height="15" rx="1.5" />
          <rect x="14.5" y="4.5" width="4" height="15" rx="1.5" />
        </svg>
        <!-- Perfectly Centered Play Icon -->
        <svg v-else key="play" viewBox="0 0 24 24" class="voice-player__icon" fill="currentColor">
          <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l11-6.86a1 1 0 0 0 0-1.68l-11-6.86A1 1 0 0 0 8 5.14z" />
        </svg>
      </Transition>
    </button>

    <!-- Vertically Centered Waveform (Accent Themed with Fluid Physics) -->
    <div
      class="voice-player__waveform"
      role="slider"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="t('audio.progress')"
      tabindex="0"
      @click="onWaveClick"
      @mousemove="onWaveMouseMove"
      @mouseleave="onWaveMouseLeave"
    >
      <div
        v-for="(height, idx) in waveBars"
        :key="idx"
        class="voice-player__bar"
        :class="{
          'is-played': (idx / waveBars.length) * 100 <= progress,
          'is-hovered': isHoveringWave && (idx / waveBars.length) * 100 <= hoverProgress
        }"
        :style="{ height: `${height}%` }"
      ></div>
    </div>

    <!-- Right Group: Seconds/Timer + Speed + Download -->
    <div class="voice-player__right">
      <span class="voice-player__time">
        {{ isPlaying || currentTime > 0 ? elapsedLabel : durationLabel }}
      </span>

      <button
        class="voice-player__speed"
        type="button"
        :title="`${t('audio.speed')} (0.5x, 1x, 1.5x, 2x)`"
        @click.stop="cyclePlaybackRate"
      >
        {{ playbackRate }}x
      </button>

      <button
        class="voice-player__dl"
        type="button"
        :title="t('audio.save')"
        @click.stop="downloadAudio"
      >
        <Icon name="download" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.voice-player {
  /* Color tokens — default (incoming bubble / discord): accent-based.
     Alpha is handled with opacity on the bars (no color-mix, which some
     WebKitGTK builds do not support). */
  --vp-play-bg: var(--accent, #3b82f6);
  --vp-play-fg: #ffffff;
  --vp-bar-color: var(--accent, #3b82f6);
  --vp-bar-idle-opacity: 0.32;
  --vp-bar-hover-opacity: 0.68;
  --vp-speed-border: var(--accent, #3b82f6);
  --vp-speed-bg: var(--accent, #3b82f6);
  --vp-speed-hover-fg: #ffffff;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 260px;
  max-width: min(390px, 88vw);
  height: 40px;
  padding: 0 4px;
  user-select: none;
  box-sizing: border-box;
}

/* Own bubble (bubble style only): the bubble is accent-tinted, so the player
   flips to white so its controls stand out. The full selector lives inside
   :global() — with `:global(A) B`, the scoped compiler drops the B part. */
:global(:root:not([data-message-style="discord"]) .msg.is-own .voice-player) {
  --vp-play-bg: rgba(255, 255, 255, 0.92);
  --vp-play-fg: var(--accent, #3b82f6);
  --vp-bar-color: #ffffff;
  --vp-bar-idle-opacity: 0.38;
  --vp-bar-hover-opacity: 0.75;
  --vp-speed-border: rgba(255, 255, 255, 0.5);
  --vp-speed-bg: rgba(255, 255, 255, 0.92);
  --vp-speed-hover-fg: var(--accent, #3b82f6);
}

.voice-player audio {
  display: none;
}

.voice-player__play {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  padding: 0;
  margin: 0;
  border-radius: 10px;
  background: var(--vp-play-bg);
  color: var(--vp-play-fg);
  border: none;
  outline: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  box-shadow: none;
  transition:
    transform var(--dur-slow) var(--ease-spring),
    border-radius var(--dur-base) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out);
  will-change: transform;
}

.voice-player__play:hover {
  transform: scale(1.06);
  border-radius: 11px;
  opacity: 0.94;
}

.voice-player__play:active {
  transform: scale(0.88);
  border-radius: 9px;
  opacity: 0.82;
  transition-duration: var(--dur-fast);
}

.voice-player__icon {
  width: 15px;
  height: 15px;
  display: block;
  margin: 0;
  will-change: transform, opacity;
}

.apple-pop-enter-active {
  transition:
    transform var(--dur-base) var(--ease-spring),
    opacity var(--dur-fast) var(--ease-out);
}

.apple-pop-leave-active {
  transition:
    transform var(--dur-fast) var(--ease-in),
    opacity var(--dur-fast) var(--ease-out);
}

.apple-pop-enter-from {
  transform: scale(0.55) rotate(-10deg);
  opacity: 0;
}

.apple-pop-leave-to {
  transform: scale(0.55) rotate(10deg);
  opacity: 0;
}

/* Vertically Centered Waveform (Accent Themed with Fluid Physics) */
.voice-player__waveform {
  flex: 1;
  min-width: 0;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  cursor: pointer;
}

.voice-player__bar {
  flex: 1;
  min-width: 2px;
  max-width: 3.5px;
  border-radius: 999px;
  background: var(--vp-bar-color);
  opacity: var(--vp-bar-idle-opacity);
  transition:
    height var(--dur-base) var(--ease-out),
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
  align-self: center;
  transform-origin: center bottom;
  will-change: height, opacity, transform;
}

/* Played State - Solid Vibrant Accent Color */
.voice-player__bar.is-played {
  opacity: 1;
}

/* Hover State - Slightly brighter and subtely scaled unplayed bars */
.voice-player__bar.is-hovered:not(.is-played) {
  opacity: var(--vp-bar-hover-opacity);
  transform: scaleY(1.1);
}

/* Right Section: Time + Speed + DL aligned cleanly */
.voice-player__right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.voice-player__time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 11.5px;
  letter-spacing: -0.01em;
  opacity: 0.88;
  min-width: 28px;
  text-align: right;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.voice-player__speed {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--vp-speed-border);
  background: transparent;
  color: inherit;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform var(--dur-base) var(--ease-spring),
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
  will-change: transform;
}

.voice-player__speed:hover {
  background: var(--vp-speed-bg);
  color: var(--vp-speed-hover-fg);
  border-color: transparent;
  transform: scale(1.08);
}

.voice-player__speed:active {
  transform: scale(0.88);
  transition-duration: var(--dur-fast);
}

.voice-player__dl {
  padding: 3px 4px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.65;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    transform var(--dur-base) var(--ease-spring),
    opacity var(--dur-fast) var(--ease-out);
  will-change: transform, opacity;
}

.voice-player__dl:hover {
  opacity: 1;
  transform: scale(1.15);
}

.voice-player__dl:active {
  transform: scale(0.86);
  opacity: 0.75;
  transition-duration: var(--dur-fast);
}
</style>
