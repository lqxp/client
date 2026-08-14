<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  visible: { type: Boolean, default: false },
  lock: { type: Boolean, default: false }
});

function systemPrefersLight() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches;
}

function resolveTheme(mode: string) {
  if (mode === "system") return systemPrefersLight() ? "light" : "dark";
  if (mode === "adaptive") {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? "light" : "dark";
  }
  return mode === "light" ? "light" : "dark";
}

const activeMode = computed(() =>
  props.lock
    ? String(props.messenger.state.clientLockThemeMode || props.messenger.state.themeMode || "system")
    : String(props.messenger.state.themeMode || "system")
);
const resolvedTheme = computed(() => resolveTheme(activeMode.value));
const isLightTheme = computed(() => resolvedTheme.value === "light");

function toggleTheme() {
  const next = isLightTheme.value ? "dark" : "light";
  if (props.lock) {
    props.messenger.setClientLockThemeMode?.(next);
  } else {
    props.messenger.setThemeMode?.(next);
  }
}
</script>

<template>
  <Transition name="theme-toggle">
    <button
      v-if="visible"
      class="theme-toggle"
      type="button"
      :aria-label="isLightTheme ? t('settings.ui.dark') : t('settings.ui.light')"
      :title="isLightTheme ? t('settings.ui.dark') : t('settings.ui.light')"
      @click="toggleTheme"
    >
      <svg v-if="isLightTheme" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    </button>
  </Transition>
</template>

<style scoped>
.theme-toggle {
  position: fixed;
  right: 22px;
  bottom: max(22px, env(safe-area-inset-bottom));
  z-index: 60;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(18px) saturate(1.2);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
}

.theme-toggle:hover {
  background: rgba(255, 255, 255, 0.34);
}

.theme-toggle svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

:global(:root[data-theme="light"] .theme-toggle) {
  background: rgba(12, 22, 34, 0.08);
  border-color: rgba(12, 22, 34, 0.16);
  color: var(--text);
  box-shadow: 0 10px 28px rgba(57, 72, 92, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

:global(:root[data-theme="light"] .theme-toggle:hover) {
  background: rgba(12, 22, 34, 0.14);
}

.theme-toggle-enter-active,
.theme-toggle-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.theme-toggle-enter-from,
.theme-toggle-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.9);
}
</style>
