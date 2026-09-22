<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "@/composables/useI18n";

defineProps<{ maximized: boolean }>();

const emit = defineEmits<{ minimize: []; toggleMaximize: []; close: [] }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();
</script>

<template>
  <div class="desktop-titlebar__window-controls" role="group" :aria-label="t('titlebar.windowControls')">
    <button class="desktop-titlebar__window-button" type="button" :aria-label="t('titlebar.minimize')"
      @click="emit('minimize')">
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 8.5h8" />
      </svg>
    </button>
    <button class="desktop-titlebar__window-button" type="button"
      :aria-label="maximized ? t('titlebar.restore') : t('titlebar.maximize')" @click="emit('toggleMaximize')">
      <svg v-if="maximized" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 2.5h5v5" />
        <path d="M2.5 4.5h5v5h-5z" />
      </svg>
      <svg v-else viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 3h6v6H3z" />
      </svg>
    </button>
    <button class="desktop-titlebar__window-button desktop-titlebar__window-button--close" type="button"
      :aria-label="t('titlebar.close')" @click="emit('close')">
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="m3 3 6 6" />
        <path d="m9 3-6 6" />
      </svg>
    </button>
  </div>
</template>
