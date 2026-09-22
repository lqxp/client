<script setup lang="ts">
import { computed } from "vue";
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
</script>

<template>
  <span class="avatar" :class="[`avatar--${size}`, src ? 'avatar--image' : `avatar--${accent}`]">
    <img v-if="src" :src="src" alt="" draggable="false" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
