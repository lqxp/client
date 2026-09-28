<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { initialsOf } from "@/utils/initials";

const props = withDefaults(
  defineProps<{
    name: string;
    src?: string;
    accent?: string;
    size?: "sm" | "md" | "lg";
  }>(),
  { src: "", accent: "blue", size: "md" }
);

const initials = computed(() => initialsOf(props.name));

/**
 * A src that 404s (expired room icon, revoked blob URL, offline avatar)
 * must not leave a blank circle: fall back to the default initials avatar,
 * exactly like a missing src. The flag resets whenever the src changes so a
 * fresh URL is always attempted.
 */
const failed = ref(false);
watch(
  () => props.src,
  () => {
    failed.value = false;
  }
);

const showImage = computed(() => Boolean(props.src) && !failed.value);
</script>

<template>
  <span class="avatar" :class="[`avatar--${size}`, showImage ? 'avatar--image' : `avatar--${accent}`]">
    <img v-if="showImage" :src="src" alt="" draggable="false" @error="failed = true" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
