<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps<{
  channel?: string;
}>();

const channelLabel = computed(() =>
  String(props.channel || "").trim() || "this room",
);
</script>

<template>
  <div class="room-ban">
    <div class="room-ban__card">
      <div class="room-ban__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M5.6 5.6 18.4 18.4"></path>
        </svg>
      </div>
      <h1 class="room-ban__title">{{ t("ban.roomTitle") }}</h1>
      <p class="room-ban__message">{{ t("ban.roomMessage", { channel: channelLabel }) }}</p>
    </div>
  </div>
</template>

<style scoped>
.room-ban {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text);
  user-select: none;
}

.room-ban__card {
  max-width: 26rem;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.room-ban__icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  margin-bottom: 4px;
}

.room-ban__icon svg {
  width: 28px;
  height: 28px;
}

.room-ban__title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text);
}

.room-ban__message {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--muted);
}
</style>
