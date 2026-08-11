<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUpdater } from "@/composables/useUpdater";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const appWindow = isTauri ? getCurrentWindow() : null;
const isMaximized = ref(false);

const { updateAvailable, triggerCheckUpdatesEvent } = useUpdater();

const title = computed(() => `QxChat ${__APP_VERSION__}`);

async function syncMaximizedState() {
  if (!appWindow) return;
  isMaximized.value = await appWindow.isMaximized();
}

async function minimizeWindow() {
  await appWindow?.minimize();
}

async function toggleMaximizeWindow() {
  if (!appWindow) return;

  await appWindow.toggleMaximize();
  await syncMaximizedState();
}

async function closeWindow() {
  await appWindow?.close();
}

function isTitleBarInteractiveTarget(target: EventTarget | null) {
  return Boolean((target as HTMLElement | null)?.closest("button"));
}

function handleTitleBarDoubleClick(event: MouseEvent) {
  if (isTitleBarInteractiveTarget(event.target)) return;
  void toggleMaximizeWindow();
}

onMounted(() => {
  void syncMaximizedState();
});
</script>

<template>
  <header
    v-if="isTauri"
    class="app-titlebar"
    data-tauri-drag-region
    @dblclick="handleTitleBarDoubleClick"
  >
    <div class="app-titlebar__brand" data-tauri-drag-region>
      <span class="app-titlebar__mark" aria-hidden="true">Q</span>
      <span class="app-titlebar__title" data-tauri-drag-region>{{ title }}</span>

      <div
        v-if="updateAvailable"
        class="app-titlebar__update-badge"
        title="Mise à jour disponible (cliquez pour mettre à jour)"
        @click.stop="triggerCheckUpdatesEvent"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </div>
    </div>

    <div class="app-titlebar__controls" aria-label="Contrôles de fenêtre">
      <button class="app-titlebar__button" type="button" aria-label="Minimiser" @click="minimizeWindow">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 8.5h8" />
        </svg>
      </button>

      <button
        class="app-titlebar__button"
        type="button"
        :aria-label="isMaximized ? 'Restaurer' : 'Maximiser'"
        @click="toggleMaximizeWindow"
      >
        <svg v-if="isMaximized" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4.5 2.5h5v5" />
          <path d="M2.5 4.5h5v5h-5z" />
        </svg>
        <svg v-else viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3h6v6H3z" />
        </svg>
      </button>

      <button
        class="app-titlebar__button app-titlebar__button--close"
        type="button"
        aria-label="Fermer"
        @click="closeWindow"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 3 6 6" />
          <path d="m9 3-6 6" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-titlebar {
  flex: none;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--surface) 92%, #000 8%);
  border-bottom: 1px solid var(--line);
  color: var(--text);
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.app-titlebar,
.app-titlebar * {
  user-select: none;
  -webkit-user-select: none;
}

.app-titlebar__brand {
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  pointer-events: none;
}

.app-titlebar__mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.app-titlebar__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: color-mix(in srgb, var(--text) 88%, transparent);
}

.app-titlebar__update-badge {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.4);
  cursor: pointer;
  margin-left: 4px;
  animation: update-glow 2.2s infinite ease-in-out;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease;
}

.app-titlebar__update-badge:hover {
  transform: scale(1.12);
  background: rgba(34, 197, 94, 0.35);
  color: #4ade80;
}

.app-titlebar__controls {
  flex: none;
  height: 100%;
  display: flex;
  align-items: stretch;
}

.app-titlebar__button {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  color: color-mix(in srgb, var(--text) 78%, transparent);
  transition: background-color 120ms ease, color 120ms ease;
}

.app-titlebar__button:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.app-titlebar__button--close:hover {
  background: var(--red);
  color: #fff;
}

.app-titlebar__button svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
