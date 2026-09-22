<script setup lang="ts">
import type { BadgeNode } from "@/config/badges";

defineProps<{ nodes: BadgeNode[] }>();
</script>

<template>
  <component :is="node.tag" v-for="(node, index) in nodes" :key="index" v-bind="node.attrs">
    <BadgeGlyph v-if="node.children" :nodes="node.children" />
  </component>
</template>
