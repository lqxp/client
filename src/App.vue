<script setup lang="ts">
import { provide, onMounted } from "vue";
import { useI18n } from "@/composables/useI18n";
import { useUpdater } from "@/composables/useUpdater";
import UpdateOverlay from "@/components/UpdateOverlay.vue";
import UpdateSkipDrawer from "@/components/UpdateSkipDrawer.vue";

const i18n = useI18n();
provide("i18n", i18n);

const { checkForUpdates } = useUpdater();

onMounted(() => {
  checkForUpdates(false);
});
</script>

<template>
  <div class="app-shell">
    <main class="app-shell__content">
      <router-view />
    </main>
    <UpdateOverlay />
    <UpdateSkipDrawer />
  </div>
</template>
