<script setup lang="ts">
/**
 * The frame every modal sits in.
 *
 * It owns what each modal used to reinvent: the backdrop, the way in and, the
 * part most of them lacked, the way out. It also takes focus when it opens so
 * Escape reaches it, and gives focus back to whatever opened it on close.
 * The modal itself only draws its panel, and keeps its own look.
 *
 * Escape is handled on the backdrop rather than on the window. A modal opened
 * on top of another is teleported into its own subtree, so the key only ever
 * reaches the one that holds focus, and closing the top one never closes the
 * one beneath it.
 *
 * The caller teleports it, never the shell itself. A component whose root is
 * a Teleport does not pass its parent's scope attribute to what it renders,
 * so every modal's scoped backdrop rules (fixed position, full screen, its
 * layer) stopped matching and the modals rendered at the foot of the page.
 * Through a Transition root the attribute does pass.
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The modal's own backdrop class, which carries its placement and tint. */
    backdropClass?: string;
  }>(),
  { backdropClass: "" }
);

const emit = defineEmits<{ close: [] }>();

const backdropRef = ref<HTMLElement | null>(null);
let returnFocusTo: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      const backdrop = backdropRef.value;
      // A modal that focuses its own first field keeps it.
      if (backdrop && !backdrop.contains(document.activeElement)) backdrop.focus({ preventScroll: true });
      return;
    }
    returnFocusTo?.focus?.({ preventScroll: true });
    returnFocusTo = null;
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  returnFocusTo = null;
});
</script>

<template>
  <Transition name="qx-modal" :duration="{ enter: 340, leave: 220 }" appear>
    <div v-if="open" ref="backdropRef" class="qx-modal-backdrop" :class="backdropClass" tabindex="-1"
      @click.self="emit('close')" @keydown.esc.stop="emit('close')">
      <slot />
    </div>
  </Transition>
</template>

<style scoped>
.qx-modal-backdrop:focus {
  outline: none;
}
</style>
