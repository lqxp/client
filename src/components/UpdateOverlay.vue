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
            <div v-if="phase === 'checking'" class="loupe-search">
              <svg class="loupe-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <circle cx="11" cy="11" r="7" stroke-linecap="round" />
                <path d="M16 16L21 21" stroke-linecap="round" />
              </svg>
            </div>

            <div v-else-if="phase === 'upToDate'" class="success-badge">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <div v-else-if="phase === 'found'" class="found-badge">
              <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>

            <div v-else-if="phase === 'downloading'" class="download-badge">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>

            <div v-else-if="phase === 'installing'" class="installing-badge">
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" class="install-gear-spin">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>

            <div v-else-if="phase === 'completed'" class="completed-badge">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div v-else-if="phase === 'error'" class="error-badge">
              <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
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
  color: var(--text, #f4f4f5);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
}

.update-screen::before {
  content: "";
  position: absolute;
  inset: -40px;
  background-image: url("/assets/wp_dark.jpg");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(36px) brightness(0.7);
  z-index: 0;
  transition: background-image 0.5s ease;
}

:global(:root[data-theme="light"]) .update-screen::before {
  background-image: url("/assets/wp_light.jpg");
  filter: blur(36px) brightness(0.92);
}

.update-canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2.5rem 2rem;
  background: rgba(20, 20, 25, 0.45);
  backdrop-filter: blur(40px) saturate(190%);
  -webkit-backdrop-filter: blur(40px) saturate(190%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

:global(:root[data-theme="light"]) .update-canvas {
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.update-close-btn {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: var(--muted, rgba(255, 255, 255, 0.7));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

:global(:root[data-theme="light"]) .update-close-btn {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.6);
}

.update-close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.update-hero-icon-container {
  position: relative;
  width: 96px;
  height: 96px;
  margin-bottom: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
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
  stroke-width: 4;
}

:global(:root[data-theme="light"]) .hero-progress-bg {
  stroke: rgba(0, 0, 0, 0.08);
}

.hero-progress-fill {
  fill: none;
  stroke: var(--blue, #007aff);
  stroke-width: 4.5;
  stroke-dasharray: 251;
  stroke-dashoffset: 251;
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

.loupe-search {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text, #ffffff);
  animation: apple-pulse 2.2s ease-in-out infinite;
}

:global(:root[data-theme="light"]) .loupe-search {
  color: #1d1d1f;
}

.loupe-svg {
  width: 52px;
  height: 52px;
}

@keyframes apple-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}

.install-gear-spin {
  animation: gear-spin 3s linear infinite;
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
  color: var(--blue, #007aff);
  animation: apple-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.2);
}

.error-badge {
  color: #ff3b30;
  animation: apple-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.2);
}

@keyframes apple-pop {
  0% {
    transform: scale(0.6);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.update-title {
  font-size: 1.375rem;
  font-weight: 600;
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
  max-width: 260px;
  display: flex;
  justify-content: center;
}

.update-primary-btn {
  width: 100%;
  padding: 0.875rem 1.5rem;
  background: var(--blue, #007aff);
  color: #ffffff;
  border: none;
  border-radius: 14px;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-shadow: 0 4px 14px rgba(0, 122, 255, 0.35);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.update-primary-btn:hover {
  background: #0066cc;
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(0, 122, 255, 0.45);
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
