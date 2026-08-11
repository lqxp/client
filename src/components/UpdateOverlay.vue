<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useUpdater } from "@/composables/useUpdater";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const {
  isCheckActive,
  phase,
  progressPercent,
  newVersion,
  dismissOverlay,
  retryUpdate,
  triggerRelaunch,
} = useUpdater();
</script>

<template>
  <Transition name="update-fade">
    <div v-if="isCheckActive" class="update-screen" role="dialog" aria-modal="true">
      <div class="update-canvas">
        <button
          v-if="phase === 'error' || phase === 'upToDate'"
          class="update-close-btn"
          aria-label="Close"
          @click="dismissOverlay"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div class="update-hero-icon-container">
          <svg v-if="phase === 'downloading' || phase === 'installing'" class="hero-progress-svg" viewBox="0 0 88 88">
            <circle class="hero-progress-bg" cx="44" cy="44" r="40" />
            <circle
              class="hero-progress-fill"
              cx="44"
              cy="44"
              r="40"
              :style="{ strokeDashoffset: 251 - (251 * progressPercent) / 100 }"
            />
          </svg>

          <div class="hero-icon-content">
            <Transition name="icon-fade" mode="out-in">
              <div v-if="phase === 'checking'" key="checking" class="icon-slot loupe-search">
                <svg class="loupe-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <circle cx="11" cy="11" r="7" stroke-linecap="round" />
                  <path d="M16 16L21 21" stroke-linecap="round" />
                </svg>
              </div>

              <div v-else-if="phase === 'upToDate'" key="upToDate" class="icon-slot success-badge">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>

              <div v-else-if="phase === 'found'" key="found" class="icon-slot found-badge">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>

              <div v-else-if="phase === 'downloading'" key="downloading" class="icon-slot download-badge">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>

              <div v-else-if="phase === 'installing'" key="installing" class="icon-slot installing-badge">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2" class="install-gear-spin">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>

              <div v-else-if="phase === 'completed'" key="completed" class="icon-slot completed-badge">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div v-else-if="phase === 'error'" key="error" class="icon-slot error-badge">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </Transition>
          </div>
        </div>

        <h2 class="update-title">
          <template v-if="phase === 'checking'">{{ t('updater.checking') }}</template>
          <template v-else-if="phase === 'upToDate'">{{ t('updater.upToDate') }}</template>
          <template v-else-if="phase === 'found'">{{ t('updater.found') }}</template>
          <template v-else-if="phase === 'downloading'">{{ t('updater.downloading', { version: newVersion ? `v${newVersion}` : '' }) }}</template>
          <template v-else-if="phase === 'installing'">{{ t('updater.installing') }}</template>
          <template v-else-if="phase === 'completed'">{{ t('updater.completed') }}</template>
          <template v-else-if="phase === 'error'">{{ t('updater.error') }}</template>
        </h2>

        <div class="update-action-area">
          <Transition name="icon-fade" mode="out-in">
            <button v-if="phase === 'completed'" key="restart" class="update-primary-btn" @click="triggerRelaunch">
              <span>{{ t('updater.restartNow') }}</span>
            </button>
            <button v-else-if="phase === 'error'" key="retry" class="update-secondary-btn" @click="retryUpdate">
              {{ t('updater.retry') }}
            </button>
          </Transition>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.update-screen {
  position: fixed;
  inset: 0;
  z-index: 9999999;
  width: 100vw;
  height: 100vh;
  background: #0f0c1b;
  color: var(--text, #f4f4f5);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  overflow: hidden;
}

.update-screen::before {
  content: "";
  position: absolute;
  inset: -30px;
  background-image: url("/assets/wp_dark.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(32px) brightness(0.7);
  opacity: 0.95;
  z-index: 0;
  transition: background-image 0.3s ease;
}

:global(:root[data-theme="light"]) .update-screen {
  background: #f3f4f6;
  color: var(--text, #111827);
}

:global(:root[data-theme="light"]) .update-screen::before {
  background-image: url("/assets/wp_light.jpg");
  filter: blur(32px) brightness(0.95);
  opacity: 0.95;
}

.update-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2rem;
}

.update-close-btn {
  position: fixed;
  top: 1.5rem;
  right: 1.5rem;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  color: var(--muted, rgba(255, 255, 255, 0.7));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

:global(:root[data-theme="light"]) .update-close-btn {
  background: rgba(0, 0, 0, 0.08);
  color: var(--muted, rgba(0, 0, 0, 0.6));
}

.update-close-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  color: var(--text, #ffffff);
}

:global(:root[data-theme="light"]) .update-close-btn:hover {
  background: rgba(0, 0, 0, 0.15);
  color: var(--text, #000000);
}

.update-hero-icon-container {
  position: relative;
  width: 88px;
  height: 88px;
  margin-bottom: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.hero-progress-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.hero-progress-bg {
  fill: none;
  stroke: var(--line-strong, rgba(255, 255, 255, 0.15));
  stroke-width: 4;
}

:global(:root[data-theme="light"]) .hero-progress-bg {
  stroke: rgba(0, 0, 0, 0.12);
}

.hero-progress-fill {
  fill: none;
  stroke: var(--blue, #2090ea);
  stroke-width: 4;
  stroke-dasharray: 251;
  stroke-dashoffset: 251;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s ease-out;
}

.hero-icon-content {
  position: relative;
  z-index: 1;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-slot {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.loupe-search {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text, #ffffff);
  animation: search-orbit 2.6s ease-in-out infinite;
}

:global(:root[data-theme="light"]) .loupe-search {
  color: var(--text, #111827);
}

.loupe-svg {
  width: 48px;
  height: 48px;
}

@keyframes search-orbit {
  0% {
    transform: rotate(0deg) scale(1);
  }
  25% {
    transform: rotate(-18deg) scale(1.08);
  }
  50% {
    transform: rotate(18deg) scale(1.04);
  }
  75% {
    transform: rotate(-10deg) scale(1.06);
  }
  100% {
    transform: rotate(0deg) scale(1);
  }
}

.install-gear-spin {
  animation: gear-spin 4s linear infinite;
}

@keyframes gear-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.success-badge,
.found-badge,
.download-badge,
.installing-badge,
.completed-badge {
  color: #2090ea;
}

.error-badge {
  color: #ff453a;
}

.icon-fade-enter-active,
.icon-fade-leave-active {
  transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.icon-fade-enter-from,
.icon-fade-leave-to {
  opacity: 0;
}

.update-title {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--text, #ffffff);
  min-height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

:global(:root[data-theme="light"]) .update-title {
  color: var(--text, #111827);
}

.update-action-area {
  margin-top: 1.75rem;
  width: 100%;
  max-width: 280px;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.update-primary-btn {
  width: 100%;
  padding: 0.875rem 1.5rem;
  background: var(--blue, #2090ea);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: background 0.2s ease;
}

.update-primary-btn:hover {
  background: var(--blue-hover, #1f7ed1);
}

.update-secondary-btn {
  padding: 0.75rem 1.5rem;
  background: rgba(255, 255, 255, 0.12);
  color: var(--text, #ffffff);
  border: 1px solid var(--line-strong, rgba(255, 255, 255, 0.2));
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

:global(:root[data-theme="light"]) .update-secondary-btn {
  background: rgba(0, 0, 0, 0.08);
  color: #111827;
  border-color: rgba(0, 0, 0, 0.15);
}

.update-secondary-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.update-fade-enter-active,
.update-fade-leave-active {
  transition: opacity 0.35s ease;
}

.update-fade-enter-from,
.update-fade-leave-to {
  opacity: 0;
}
</style>
