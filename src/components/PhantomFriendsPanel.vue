<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "@/composables/useI18n";
import AddFriendModal from "@/components/AddFriendModal.vue";

const props = defineProps<{ messenger: any; phantom: any }>();

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const addOpen = ref(false);

const friends = computed<any[]>(() => Object.values(props.phantom.state.friendsByUser || {}) as any[]);
const requests = computed(() => props.phantom.state.pendingIncoming || []);
const ghostCodes = computed(() => props.phantom.state.ghostCodes || []);

onMounted(() => {
  props.phantom.ensurePrekey().catch(() => {});
  props.phantom.loadRoster().catch(() => {});
  props.phantom.startScheduler();
});

function openFriend(roomId: string) {
  if (roomId && props.messenger?.selectConversation) {
    props.messenger.selectConversation(roomId);
  }
}

async function copyGhostUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <section class="phantom-friends">
    <header class="phantom-friends__head">
      <strong>{{ t("phantom.title") }}</strong>
      <button class="icon-btn" type="button" :aria-label="t('phantom.send')" @click="addOpen = true">+</button>
    </header>

    <div v-if="requests.length" class="phantom-requests">
      <span class="phantom-requests__badge">{{ requests.length }}</span>
      <div v-for="request in requests" :key="request.id" class="phantom-request">
        <span class="phantom-request__name">{{ request.sender?.displayName || "…" }}</span>
        <span class="phantom-request__intro">{{ request.intro || "" }}</span>
        <div class="phantom-request__actions">
          <button type="button" @click="props.phantom.acceptIncoming(request.id)">{{ t("phantom.accept") }}</button>
          <button type="button" @click="props.phantom.ignoreIncoming(request.id)">{{ t("phantom.ignore") }}</button>
        </div>
      </div>
    </div>

    <ul v-if="friends.length" class="phantom-friends__list">
      <li v-for="friend in friends" :key="friend.peerFp" class="phantom-friend">
        <button type="button" @click="openFriend(friend.roomId)">
          <span class="phantom-friend__avatar">{{ (friend.peerDisplayName || "?").slice(0, 1).toUpperCase() }}</span>
          <span class="phantom-friend__name">{{ friend.peerDisplayName }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="!requests.length" class="phantom-friends__empty">{{ t("phantom.noFriends") }}</p>

    <div v-if="ghostCodes.length" class="phantom-ghosts">
      <span>{{ t("phantom.ghostLink") }}</span>
      <button v-for="(code, i) in ghostCodes" :key="i" type="button" @click="copyGhostUrl(code.url)">
        ⧉ {{ code.url.slice(0, 24) }}…
      </button>
    </div>

    <AddFriendModal :messenger="messenger" :phantom="phantom" :open="addOpen" @close="addOpen = false" />
  </section>
</template>

<style scoped>
.phantom-friends {
  border-top: 1px solid var(--border, #2a2d33);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.phantom-friends__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary, #a7abb3);
}
.phantom-friends__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.phantom-friend button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary, #e6e8ec);
  cursor: pointer;
}
.phantom-friend button:hover {
  background: var(--hover, #26292f);
}
.phantom-friend__avatar {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent, #4f7cff);
  color: #fff;
  font-weight: 700;
}
.phantom-friend__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phantom-friends__empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #a7abb3);
  padding: 0 4px;
}
.phantom-requests {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}
.phantom-requests__badge {
  position: absolute;
  top: -4px;
  right: 0;
  background: var(--danger, #e5534b);
  color: #fff;
  font-size: 11px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  padding: 0 5px;
}
.phantom-request {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 8px;
  background: var(--surface, #1c1f24);
  border: 1px solid var(--border, #2a2d33);
}
.phantom-request__name {
  font-weight: 600;
  font-size: 13px;
}
.phantom-request__intro {
  font-size: 12px;
  color: var(--text-secondary, #a7abb3);
}
.phantom-request__actions {
  display: flex;
  gap: 6px;
}
.phantom-request__actions button {
  padding: 4px 8px;
  border-radius: 6px;
  border: 0;
  cursor: pointer;
  font-size: 12px;
  color: #fff;
  background: var(--accent, #4f7cff);
}
.phantom-request__actions button:last-child {
  background: transparent;
  border: 1px solid var(--border, #2a2d33);
  color: var(--text-secondary, #a7abb3);
}
.phantom-ghosts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary, #a7abb3);
}
.phantom-ghosts button {
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--accent, #4f7cff);
  cursor: pointer;
  padding: 0;
  font-size: 11px;
}
</style>
