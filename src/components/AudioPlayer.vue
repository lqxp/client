<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps({
  src: { type: String, required: true },
  filename: { type: String, default: "Audio" },
  sizeLabel: { type: String, default: "" },
  fallbackDuration: { type: String, default: "" },
  messenger: { type: Object, default: null }
});

const audioRef = ref(null);
const isPlaying = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const canPlay = ref(false);
let frameId = 0;
let playbackStartedAt = 0;
let playbackBaseTime = 0;

const fallbackDurationSeconds = computed(() => parseClock(props.fallbackDuration));
const effectiveDuration = computed(() => duration.value || fallbackDurationSeconds.value);

const progress = computed(() => {
  if (!effectiveDuration.value) return 0;
  return Math.min(100, (currentTime.value / effectiveDuration.value) * 100);
});

const elapsedLabel = computed(() => formatClock(currentTime.value));
const durationLabel = computed(() => {
  if (effectiveDuration.value) return formatClock(effectiveDuration.value);
  return "--:--";
});

function parseClock(value) {
  const match = /^(\d+):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatClock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const rest = String(value % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function syncAudioState() {
  const audio = audioRef.value;
  if (!audio) return;
  const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
  duration.value = nextDuration;
  const nextTime = audio.currentTime || 0;
  if (nextTime || !isPlaying.value) currentTime.value = nextTime;
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
    if (mediaTime > currentTime.value) {
      currentTime.value = mediaTime;
      playbackStartedAt = performance.now();
      playbackBaseTime = mediaTime;
    } else if (effectiveDuration.value) {
      const elapsed = (performance.now() - playbackStartedAt) / 1000;
      currentTime.value = Math.min(effectiveDuration.value, playbackBaseTime + elapsed);
    }

    const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (nextDuration) duration.value = nextDuration;
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);
}

async function togglePlayback() {
  const audio = audioRef.value;
  if (!audio) return;

  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      isPlaying.value = false;
    }
  } else {
    audio.pause();
  }
}

function seek(event) {
  const audio = audioRef.value;
  if (!audio || !effectiveDuration.value) return;
  const nextTime = (Number(event.target.value) / 100) * effectiveDuration.value;
  audio.currentTime = nextTime;
  currentTime.value = nextTime;
  playbackStartedAt = performance.now();
  playbackBaseTime = nextTime;
}

function downloadAudio() {
  if (!props.src) return;
  const a = document.createElement("a");
  a.href = props.src;
  a.download = props.filename || "audio";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function onLoadedMetadata() {
  props.messenger?.applyAudioOutput?.(audioRef.value);
  canPlay.value = true;

  const audio = audioRef.value;
  if (audio && (audio.duration === Infinity || Number.isNaN(audio.duration))) {
    // Force Chrome to recalculate the duration/position
    audio.currentTime = 1e101;
    const fixHandler = () => {
      audio.currentTime = 0;
      audio.removeEventListener("timeupdate", fixHandler);
      syncAudioState();
    };
    audio.addEventListener("timeupdate", fixHandler);
  } else {
    syncAudioState();
  }
}

watch(
  () => props.messenger?.state.selectedAudioOutputId,
  () => props.messenger?.applyAudioOutput?.(audioRef.value)
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
  if (effectiveDuration.value) currentTime.value = effectiveDuration.value;
}

watch(
  () => props.src,
  () => {
    stopProgressLoop();
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    canPlay.value = false;
  }
);

onBeforeUnmount(() => {
  stopProgressLoop();
  const audio = audioRef.value;
  if (audio) audio.pause();
});
</script>

<template>
  <div class="audio-player">
    <audio
      ref="audioRef"
      :src="src"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="syncAudioState"
      @timeupdate="syncAudioState"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    ></audio>

    <button class="audio-player__play" type="button" :aria-label="isPlaying ? 'Pause audio' : 'Play audio'" @click="togglePlayback">
      <svg v-if="isPlaying" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5h3v14H8zM13 5h3v14h-3z"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </button>

    <div class="audio-player__body">
      <div class="audio-player__top">
        <span class="audio-player__title">{{ filename }}</span>
        <span class="audio-player__duration">{{ elapsedLabel }} / {{ durationLabel }}</span>
      </div>

      <label class="audio-player__seek">
        <span class="sr-only">Audio progress</span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          :value="progress"
          :disabled="!canPlay && !effectiveDuration"
          :style="{ '--progress': `${progress}%` }"
          @input="seek"
        />
      </label>

      <div class="audio-player__bottom">
        <span v-if="sizeLabel" class="audio-player__meta">{{ sizeLabel }}</span>
        <button class="audio-player__download" type="button" aria-label="Download audio" @click="downloadAudio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
          <span>Save</span>
        </button>
      </div>
    </div>
  </div>
</template>
