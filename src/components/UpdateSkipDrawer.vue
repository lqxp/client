<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useUpdater } from "@/composables/useUpdater";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
const { skipDrawerVisible, skipUpdate } = useUpdater();
</script>

<template>
  <Transition name="update-skip-drawer">
    <button
      v-if="skipDrawerVisible"
      type="button"
      class="update-skip-drawer"
      @click="skipUpdate"
    >
      <span class="update-skip-drawer__title">{{ t('updater.skipTitle') }}</span>
      <span class="update-skip-drawer__hint">{{ t('updater.skipHint') }}</span>
    </button>
  </Transition>
</template>

<style scoped>
.update-skip-drawer {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 9999990;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 240px;
  max-width: min(340px, calc(100vw - 32px));
  padding: 13px 18px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  border: 1px solid var(--line-strong);
  box-shadow: 0 16px 44px color-mix(in srgb, var(--bg) 46%, transparent);
  color: var(--text);
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
  user-select: none;
  backdrop-filter: blur(16px);
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.update-skip-drawer:hover {
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border-color: var(--accent);
  transform: translateY(-2px);
}

.update-skip-drawer:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.update-skip-drawer__title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  line-height: 1.2;
}

.update-skip-drawer__hint {
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  line-height: 1.4;
}

.update-skip-drawer-enter-active,
.update-skip-drawer-leave-active {
  transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.update-skip-drawer-enter-from,
.update-skip-drawer-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}
</style>
