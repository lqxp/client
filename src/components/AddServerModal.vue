<script setup lang="ts">
import { inject } from "vue";
import { useI18n } from "@/composables/useI18n";

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const props = defineProps({
  open: { type: Boolean, default: false }
});
const emit = defineEmits(["close", "create", "join"]);

function close() {
  emit("close");
}

function create() {
  emit("create");
}

function join() {
  emit("join");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="add-server-backdrop" @click.self="close">
      <div class="add-server" role="dialog" :aria-label="t('sidebar.addServer')">
        <header class="add-server__head">
          <h2 class="add-server__title">{{ t('sidebar.addServer') }}</h2>
          <button class="icon-btn add-server__close" type="button" :aria-label="t('message.cancel')" @click="close">
            <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        <div class="add-server__body">
          <button type="button" class="add-server__action" @click="create">
            <span class="add-server__action-icon add-server__action-icon--create">
              <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            <span class="add-server__action-text">
              <strong>{{ t('rooms.createTitle') }}</strong>
              <small>{{ t('rooms.createSubtitle') }}</small>
            </span>
          </button>

          <button type="button" class="add-server__action" @click="join">
            <span class="add-server__action-icon add-server__action-icon--join">
              <svg viewBox="0 0 24 24">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M19 8v6M16 11h6" />
              </svg>
            </span>
            <span class="add-server__action-text">
              <strong>{{ t('sidebar.addServerJoin') }}</strong>
              <small>{{ t('sidebar.addServerJoinHint') }}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.add-server-backdrop {
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

.add-server {
  width: 100%;
  max-width: 440px;
  max-height: calc(100vh - 56px);
  overflow-y: auto;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  font-family: var(--font);
}

.add-server__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 6px;
}

.add-server__title {
  margin: 0;
  font-family: var(--font);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.add-server__close {
  flex: none;
}

.add-server__body {
  display: grid;
  gap: 10px;
  padding: 14px 24px 24px;
}

.add-server__action {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}

.add-server__action:hover,
.add-server__action:focus-visible {
  border-color: var(--accent);
  background: var(--surface-hover);
  outline: none;
}

.add-server__action-icon {
  flex: none;
  width: 42px;
  height: 42px;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
}

.add-server__action-icon svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.add-server__action-icon--create {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.add-server__action-icon--join {
  background: color-mix(in srgb, var(--green) 16%, transparent);
  color: var(--green);
}

.add-server__action-text {
  min-width: 0;
}

.add-server__action-text strong {
  display: block;
  font-size: 15px;
  font-weight: 600;
}

.add-server__action-text small {
  display: block;
  margin-top: 3px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted);
}

@media (max-width: 700px), (hover: none) and (pointer: coarse) {
  .add-server-backdrop {
    padding: 0;
    align-items: flex-end;
    background: rgba(0, 0, 0, 0.52);
    backdrop-filter: blur(12px);
  }

  .add-server {
    max-width: 100%;
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.5), 0 -1px 0 var(--line-strong);
    padding-bottom: max(18px, env(safe-area-inset-bottom));
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .add-server::before {
    content: "";
    display: block;
    width: 40px;
    height: 5px;
    margin: 12px auto 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--muted) 48%, transparent);
  }

  .add-server__head {
    padding: 8px 18px 6px;
  }

  .add-server__body {
    padding: 10px 18px 18px;
  }

  .add-server__action {
    padding: 16px;
  }

  .add-server__action-icon {
    width: 46px;
    height: 46px;
  }
}
</style>
