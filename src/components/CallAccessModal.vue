<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  messenger: { type: Object, required: true },
  open: { type: Boolean, default: false },
  roomId: { type: String, default: "" }
});
const emit = defineEmits(["close"]);

function choose(allowMembers: boolean) {
  props.messenger.startCall({ allowMembers });
  emit("close");
}

function close() {
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="call-access-backdrop" @click.self="close">
      <div class="call-access" role="dialog" :aria-label="t('rooms.callAccessTitle')">
        <header class="call-access__head">
          <h2 class="call-access__title">{{ t('rooms.callAccessTitle') }}</h2>
          <button class="icon-btn call-access__close" type="button" :aria-label="t('message.cancel')" @click="close">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="call-access__body">
          <p class="call-access__message">
            {{ t('rooms.callAccessMessage', { channel: messenger.displayRoomName?.(roomId) || roomId }) }}
          </p>
        </div>

        <footer class="call-access__foot">
          <button type="button" class="call-access__btn call-access__btn--secondary" @click="choose(false)">
            {{ t('rooms.callAdminsOnly') }}
          </button>
          <button type="button" class="call-access__btn call-access__btn--primary" @click="choose(true)">
            {{ t('rooms.callAllowMembers') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.call-access-backdrop {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
}

.call-access {
  width: 100%;
  max-width: 420px;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
}

.call-access__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 4px;
}

.call-access__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.call-access__close {
  flex: none;
}

.call-access__body {
  padding: 8px 24px 20px;
}

.call-access__message {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--muted);
}

.call-access__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--line);
}

.call-access__btn {
  height: 40px;
  padding: 0 20px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.call-access__btn--secondary {
  background: transparent;
  color: var(--muted);
}

.call-access__btn--secondary:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.call-access__btn--primary {
  background: var(--accent);
  color: #fff;
}

.call-access__btn--primary:hover {
  background: color-mix(in srgb, var(--accent) 82%, #000 18%);
}
</style>
