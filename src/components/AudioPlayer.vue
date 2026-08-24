<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Voice message" },
  sizeLabel: { type: String, default: "" },
  fallbackDuration: { type: String, default: "" },
  waveform: { type: Array as () => number[], default: () => [] },
  messenger: { type: Object, default: null }
});

const audioRef = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const canPlay = ref(false);
const playbackRate = ref(1);
const isHoveringWave = ref(false);
const hoverProgress = ref(0);
const rawWaveBars = ref<number[]>([]);

let frameId = 0;
let playbackStartedAt = 0;
let playbackBaseTime = 0;

// In-memory cache for decoded waveforms
const waveformCache = new Map<string, number[]>();

const BAR_COUNT = 32;

const defaultBars = [
  25, 35, 55, 40, 70, 85, 60, 45, 75, 90, 65, 50, 80, 70, 45, 60,
  85, 55, 35, 65, 80, 55, 70, 90, 60, 45, 75, 50, 40, 55, 35, 25
];

const waveBars = computed(() => {
  if (Array.isArray(props.waveform) && props.waveform.length > 0) {
    return props.waveform;
  }
  if (rawWaveBars.value.length > 0) return rawWaveBars.value;
  return defaultBars;
});

async function decodeRealWaveform(url: string) {
  if (!url) return;
  if (props.waveform && props.waveform.length > 0) return;
  if (waveformCache.has(url)) {
    rawWaveBars.value = waveformCache.get(url)!;
    return;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();
    let audioBuffer: AudioBuffer | null = null;
    try {
      audioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));
    } catch {
      // Fallback with callback syntax for older safari/webkit
      audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        audioCtx.decodeAudioData(buffer.slice(0), resolve, reject);
      });
    }
    try {
      await audioCtx.close();
    } catch {
      /* ignore */
    }

    if (!audioBuffer) return;

    const channelData = audioBuffer.getChannelData(0);
    const step = Math.floor(channelData.length / BAR_COUNT);
    const amplitudes: number[] = [];

    for (let i = 0; i < BAR_COUNT; i++) {
      const start = i * step;
      let sum = 0;
      const count = Math.min(step, channelData.length - start);
      for (let j = 0; j < count; j++) {
        const val = Math.abs(channelData[start + j]);
        sum += val * val;
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0;
      amplitudes.push(rms);
    }

    const max = Math.max(...amplitudes, 0.001);
    const normalized = amplitudes.map((val) => {
      const pct = Math.round((val / max) * 100);
      return Math.max(16, Math.min(100, pct));
    });

    waveformCache.set(url, normalized);
    rawWaveBars.value = normalized;

    if (audioBuffer.duration && Number.isFinite(audioBuffer.duration) && !duration.value) {
      duration.value = audioBuffer.duration;
    }
  } catch (e) {
    // Keep clean fallback bars
  }
}

const fallbackDurationSeconds = computed(() => parseClock(props.fallbackDuration));
const effectiveDuration = computed(() => {
  if (duration.value && Number.isFinite(duration.value) && duration.value > 0) {
    return duration.value;
  }
  return fallbackDurationSeconds.value || 0;
});

const progress = computed(() => {
  if (!effectiveDuration.value) return 0;
  return Math.min(100, (currentTime.value / effectiveDuration.value) * 100);
});

const elapsedLabel = computed(() => formatClock(currentTime.value));
const durationLabel = computed(() => {
  if (effectiveDuration.value) return formatClock(effectiveDuration.value);
  return "0:00";
});

function parseClock(value: string) {
  const match = /^(\d+):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatClock(seconds: number) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const rest = String(value % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function syncAudioState() {
  const audio = audioRef.value;
  if (!audio) return;
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    duration.value = audio.duration;
  }
  const nextTime = audio.currentTime || 0;
  if (nextTime > 0 || !isPlaying.value) {
    currentTime.value = nextTime;
  }
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

    const mediaTime = audio.currentTime || 0;
    if (mediaTime > 0) {
      currentTime.value = mediaTime;
      playbackStartedAt = performance.now();
      playbackBaseTime = mediaTime;
    } else if (effectiveDuration.value) {
      const elapsed = ((performance.now() - playbackStartedAt) / 1000) * playbackRate.value;
      currentTime.value = Math.min(effectiveDuration.value, playbackBaseTime + elapsed);
    }

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      duration.value = audio.duration;
    }

    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);
}

async function togglePlayback() {
  const audio = audioRef.value;
  if (!audio) return;

  if (audio.paused) {
    try {
      if (audio.ended || (effectiveDuration.value && currentTime.value >= effectiveDuration.value - 0.2)) {
        audio.currentTime = 0;
        currentTime.value = 0;
      }
      audio.volume = 1.0;
      audio.muted = false;
      audio.playbackRate = playbackRate.value;
      await audio.play();
      isPlaying.value = true;
      startProgressLoop();
    } catch (err) {
      console.warn("Audio play failed:", err);
      isPlaying.value = false;
      stopProgressLoop();
    }
  } else {
    audio.pause();
    isPlaying.value = false;
    stopProgressLoop();
    syncAudioState();
  }
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
}

function onWaveClick(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
  seekByProgress(pct);
}

function onWaveMouseMove(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  hoverProgress.value = Math.max(0, Math.min(100, (mouseX / rect.width) * 100));
  isHoveringWave.value = true;
}

function onWaveMouseLeave() {
  isHoveringWave.value = false;
}

function cyclePlaybackRate() {
  const rates = [0.5, 1, 1.5, 2];
  const nextIdx = (rates.indexOf(playbackRate.value) + 1) % rates.length;
  playbackRate.value = rates[nextIdx];
  if (audioRef.value) {
    audioRef.value.playbackRate = playbackRate.value;
  }
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
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      duration.value = audio.duration;
    }
    props.messenger?.applyAudioOutput?.(audio);
  }
  syncAudioState();
}

watch(
  () => props.messenger?.state.selectedAudioOutputId,
  () => {
    if (audioRef.value) {
      props.messenger?.applyAudioOutput?.(audioRef.value);
    }
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
}

function onEnded() {
  isPlaying.value = false;
  stopProgressLoop();
  syncAudioState();
  if (effectiveDuration.value) {
    currentTime.value = effectiveDuration.value;
  }
}

watch(
  () => props.src,
  (newSrc) => {
    stopProgressLoop();
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    canPlay.value = false;
    if (newSrc && (!props.waveform || props.waveform.length === 0)) {
      decodeRealWaveform(newSrc);
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (props.src && (!props.waveform || props.waveform.length === 0)) {
    decodeRealWaveform(props.src);
  }
});

onBeforeUnmount(() => {
  stopProgressLoop();
  const audio = audioRef.value;
  if (audio) {
    audio.pause();
  }
});
</script>

<template>
  <div class="voice-player" :class="{ 'is-playing': isPlaying }">
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

    <!-- Apple-Style Squircle Play/Pause Button with Spring Dynamics -->
    <button
      class="voice-player__play"
      type="button"
      :aria-label="isPlaying ? 'Pause' : 'Play'"
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
      aria-label="Audio progress"
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
        title="Vitesse de lecture (0.5x, 1x, 1.5x, 2x)"
        @click.stop="cyclePlaybackRate"
      >
        {{ playbackRate }}x
      </button>

      <button
        class="voice-player__dl"
        type="button"
        title="Enregistrer le vocal"
        @click.stop="downloadAudio"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
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

/* Apple-Style Squircle Play/Pause Button */
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
    transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1),
    border-radius 240ms cubic-bezier(0.25, 1, 0.5, 1),
    opacity 160ms ease;
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
  transition-duration: 90ms;
}

.voice-player__icon {
  width: 15px;
  height: 15px;
  display: block;
  margin: 0;
  will-change: transform, opacity;
}

/* Apple Spring Icon Crossfade / Pop */
.apple-pop-enter-active {
  transition:
    transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 160ms ease;
}

.apple-pop-leave-active {
  transition:
    transform 140ms cubic-bezier(0.4, 0, 1, 1),
    opacity 110ms ease;
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
    height 220ms cubic-bezier(0.25, 1, 0.5, 1),
    opacity 160ms cubic-bezier(0.25, 1, 0.5, 1),
    transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);
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
  transition: opacity 160ms ease;
}

/* Apple Pill Speed Selector */
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
    transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
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
  transition-duration: 80ms;
}

/* Apple Micro-Bounce Download Button */
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
    transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 160ms ease;
  will-change: transform, opacity;
}

.voice-player__dl:hover {
  opacity: 1;
  transform: scale(1.15);
}

.voice-player__dl:active {
  transform: scale(0.86);
  opacity: 0.75;
  transition-duration: 80ms;
}
</style>
