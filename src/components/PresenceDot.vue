<script setup lang="ts">
export type Presence = "online" | "dnd" | "invisible" | "call" | "connecting";

withDefaults(defineProps<{ status: Presence; size?: number; ring?: number }>(), { size: 8, ring: 0 });
</script>

<template>
  <span class="presence-dot" :class="[`is-${status}`, { 'has-ring': ring > 0 }]"
    :style="{ '--dot': `${size}px`, '--ring': `${ring}px` }" aria-hidden="true"></span>
</template>
