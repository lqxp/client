<script setup lang="ts">
import { computed, useId } from "vue";
import BadgeGlyph from "@/components/BadgeGlyph.vue";
import { badgeDesignFor, badgeInitials, designNeedsScope, normalizeBadgeId, scopeBadgeNodes } from "@/config/badges";

const props = defineProps({
  badge: { type: String, required: true },
  avatarSrc: { type: String, default: "" }
});

const instanceId = useId();
const normalizedBadge = computed(() => normalizeBadgeId(props.badge));
const design = computed(() => badgeDesignFor(normalizedBadge.value));
const nodes = computed(() => {
  const current = design.value;
  if (!current) return [];
  return designNeedsScope(current) ? scopeBadgeNodes(current.nodes, instanceId) : current.nodes;
});
const initials = computed(() => badgeInitials(props.badge));
</script>

<template>
  <img v-if="normalizedBadge === 'system' && avatarSrc" class="badge-icon badge-icon--image" :src="avatarSrc" alt=""
    aria-hidden="true" />
  <svg v-else-if="design" class="badge-icon" viewBox="0 0 24 24" v-bind="design.root" aria-hidden="true">
    <BadgeGlyph :nodes="nodes" />
  </svg>
  <span v-else class="badge-icon badge-icon--fallback" aria-hidden="true">{{ initials }}</span>
</template>

<style scoped>
.badge-icon {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
}

.badge-icon--image {
  display: block;
  object-fit: cover;
}
</style>
