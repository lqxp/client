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
          <!-- Download / Install Progress Arc -->
          <svg v-if="phase === 'downloading' || phase === 'installing'" class="hero-progress-svg" viewBox="0 0 96 96">
            <circle class="hero-progress-bg" cx="48" cy="48" r="42" />
            <circle
              class="hero-progress-fill"
              cx="48"
              cy="48"
              r="42"
              :style="{ strokeDashoffset: 263.8 - (263.8 * progressPercent) / 100 }"
            />
          </svg>

          <!-- Searching Radar Spinner -->
          <svg v-else-if="phase === 'checking'" class="hero-spinner-svg" viewBox="0 0 96 96">
            <circle class="hero-spinner-track" cx="48" cy="48" r="42" />
            <circle class="hero-spinner-head" cx="48" cy="48" r="42" />
          </svg>

          <div class="hero-icon-content">
            <Transition name="icon-fade" mode="out-in">
              <div v-if="phase === 'checking'" key="checking" class="apple-search-center">
                <svg class="loupe-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="M16 16L20.5 20.5" stroke-linecap="round" />
                </svg>
              </div>

              <div v-else-if="phase === 'upToDate'" key="upToDate" class="success-badge">
                <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M20 6L9 17l-5-5" />
                </svg>
              </div>

              <div v-else-if="phase === 'found'" key="found" class="found-badge">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
                </svg>
              </div>

              <div v-else-if="phase === 'downloading'" key="downloading" class="download-badge">
                <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
                </svg>
              </div>

              <div v-else-if="phase === 'installing'" key="installing" class="installing-badge">
                <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" class="install-gear-spin">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </div>

              <div v-else-if="phase === 'completed'" key="completed" class="completed-badge">
                <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div v-else-if="phase === 'error'" key="error" class="error-badge">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2">
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

        <div v-if="phase === 'completed'" class="update-action-area">
          <button class="update-primary-btn" @click="triggerRelaunch">
            <span>{{ t('updater.restartNow') }}</span>
          </button>
        </div>

        <div v-if="phase === 'error'" class="update-action-area">
          <button class="update-secondary-btn" @click="retryUpdate">
            {{ t('updater.retry') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.update-screen {
  position: fixed;
  inset: 0;
  z-index: 999999;
  width: 100vw;
  height: 100vh;
  color: var(--text, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
  backdrop-filter: blur(48px) saturate(180%) brightness(0.65);
  -webkit-backdrop-filter: blur(48px) saturate(180%) brightness(0.65);
  background: rgba(10, 10, 15, 0.4);
}

:global(:root[data-theme="light"]) .update-screen {
  backdrop-filter: blur(48px) saturate(180%) brightness(0.95);
  -webkit-backdrop-filter: blur(48px) saturate(180%) brightness(0.95);
  background: rgba(255, 255, 255, 0.5);
  color: #1d1d1f;
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
  padding: 1rem;
}

.update-close-btn {
  position: fixed;
  top: 1.5rem;
  right: 1.5rem;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  border: none;
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

:global(:root[data-theme="light"]) .update-close-btn {
  background: rgba(0, 0, 0, 0.08);
  color: rgba(0, 0, 0, 0.6);
}

.update-close-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.update-hero-icon-container {
  position: relative;
  width: 96px;
  height: 96px;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-spinner-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  animation: apple-spin 1.4s linear infinite;
}

.hero-spinner-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 3.5;
}

:global(:root[data-theme="light"]) .hero-spinner-track {
  stroke: rgba(0, 0, 0, 0.08);
}

.hero-spinner-head {
  fill: none;
  stroke: var(--blue, #007aff);
  stroke-width: 3.5;
  stroke-dasharray: 263.8;
  stroke-dashoffset: 200;
  stroke-linecap: round;
}

@keyframes apple-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
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
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 3.5;
}

:global(:root[data-theme="light"]) .hero-progress-bg {
  stroke: rgba(0, 0, 0, 0.08);
}

.hero-progress-fill {
  fill: none;
  stroke: var(--blue, #007aff);
  stroke-width: 3.5;
  stroke-dasharray: 263.8;
  stroke-dashoffset: 263.8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.hero-icon-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.apple-search-center {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--blue, #007aff);
  animation: apple-breath 2s ease-in-out infinite;
}

.loupe-svg {
  width: 44px;
  height: 44px;
}

@keyframes apple-breath {
  0%, 100% {
    opacity: 0.75;
    transform: scale(0.96);
  }
  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}

.install-gear-spin {
  animation: apple-spin 3s linear infinite;
}

.success-badge,
.found-badge,
.download-badge,
.installing-badge,
.completed-badge {
  color: var(--blue, #007aff);
}

.error-badge {
  color: #ff3b30;
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
  font-size: 1.35rem;
  font-weight: 500;
  letter-spacing: -0.015em;
  margin: 0;
  color: var(--text, #ffffff);
}

:global(:root[data-theme="light"]) .update-title {
  color: #1d1d1f;
}

.update-action-area {
  margin-top: 2rem;
  width: 100%;
  max-width: 240px;
  display: flex;
  justify-content: center;
}

.update-primary-btn {
  width: 100%;
  padding: 0.85rem 1.5rem;
  background: var(--blue, #007aff);
  color: #ffffff;
  border: none;
  border-radius: 12px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-shadow: 0 4px 16px rgba(0, 122, 255, 0.35);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.update-primary-btn:hover {
  background: #0066cc;
  box-shadow: 0 6px 22px rgba(0, 122, 255, 0.45);
}

.update-secondary-btn {
  padding: 0.75rem 1.5rem;
  background: rgba(255, 255, 255, 0.12);
  color: var(--text, #ffffff);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

:global(:root[data-theme="light"]) .update-secondary-btn {
  background: rgba(0, 0, 0, 0.06);
  color: #1d1d1f;
  border-color: rgba(0, 0, 0, 0.12);
}

.update-secondary-btn:hover {
  background: rgba(255, 255, 255, 0.22);
}

.update-fade-enter-active,
.update-fade-leave-active {
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.update-fade-enter-from,
.update-fade-leave-to {
  opacity: 0;
}
</style>
