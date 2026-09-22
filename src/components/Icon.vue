<script setup lang="ts">
/**
 * One stroke icon from the shared registry.
 *
 * Only the inside of the SVG comes from here: the <svg> keeps every attribute
 * its caller writes on <Icon>, viewBox, size, stroke, class, so an inline icon
 * swapped for this one renders identically. What changes is that the same
 * glyph is now drawn from one definition instead of from thirty copies that
 * could each drift on their own.
 */
import { computed } from "vue";
import { ICONS, type IconName } from "@/config/icons";

const props = defineProps<{ name: IconName }>();

const nodes = computed(() => ICONS[props.name]);
</script>

<template>
  <svg>
    <component :is="node.tag" v-for="(node, index) in nodes" :key="index" v-bind="node.attrs" />
  </svg>
</template>
