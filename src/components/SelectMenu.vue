<script setup lang="ts">
/**
 * A pop-up menu that replaces a native `<select>`.
 *
 * The list is teleported to `body` and positioned against the trigger's
 * viewport rect, because several of the places this is used sit inside
 * containers with `overflow: hidden` that would otherwise clip it. It flips
 * above the trigger when there is no room below, closes on outside click,
 * Escape or scroll, and answers the keyboard the way a listbox should.
 *
 * Every colour comes from the theme tokens, so it follows light and dark
 * without a second stylesheet.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

export type SelectValue = string | number;

export interface SelectOption {
  value: SelectValue;
  label: string;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: SelectValue;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  { placeholder: "", disabled: false, ariaLabel: "" }
);

const emit = defineEmits<{ (event: "update:modelValue", value: SelectValue): void }>();

// Two root nodes (the trigger and the teleported list) mean Vue cannot decide
// where a parent's class or id belongs, so the trigger claims them explicitly.
defineOptions({ inheritAttrs: false });

const open = ref(false);
const activeIndex = ref(-1);
const trigger = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLElement | null>(null);
const placement = ref<{ top: number; left: number; width: number; drop: "down" | "up" }>({
  top: 0,
  left: 0,
  width: 0,
  drop: "down"
});

const selected = computed(() => props.options.find((option) => option.value === props.modelValue) || null);
const label = computed(() => selected.value?.label || props.placeholder);
const selectable = computed(() => props.options.filter((option) => !option.disabled));

/** Measured against the viewport: the list is a child of `body`, not of us. */
function place() {
  const el = trigger.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const room = window.innerHeight - rect.bottom;
  const wanted = Math.min(288, props.options.length * 32 + 12);
  const drop = room < wanted + 16 && rect.top > room ? "up" : "down";
  placement.value = {
    top: drop === "down" ? rect.bottom + 6 : rect.top - 6,
    left: rect.left,
    width: rect.width,
    drop
  };
}

function openMenu() {
  if (props.disabled || open.value) return;
  place();
  open.value = true;
  activeIndex.value = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue)
  );
  nextTick(() => scrollActiveIntoView());
}

function closeMenu(refocus = false) {
  if (!open.value) return;
  open.value = false;
  activeIndex.value = -1;
  if (refocus) trigger.value?.focus();
}

function choose(option: SelectOption) {
  if (option.disabled) return;
  emit("update:modelValue", option.value);
  closeMenu(true);
}

function scrollActiveIntoView() {
  const container = list.value;
  if (!container) return;
  const item = container.children[activeIndex.value] as HTMLElement | undefined;
  item?.scrollIntoView({ block: "nearest" });
}

function step(delta: number) {
  if (!open.value) return openMenu();
  const count = props.options.length;
  if (!count || !selectable.value.length) return;
  let next = activeIndex.value;
  for (let i = 0; i < count; i += 1) {
    next = (next + delta + count) % count;
    if (!props.options[next].disabled) break;
  }
  activeIndex.value = next;
  nextTick(() => scrollActiveIntoView());
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      step(1);
      break;
    case "ArrowUp":
      event.preventDefault();
      step(-1);
      break;
    case "Home":
      if (open.value) {
        event.preventDefault();
        activeIndex.value = props.options.findIndex((option) => !option.disabled);
        nextTick(() => scrollActiveIntoView());
      }
      break;
    case "End":
      if (open.value) {
        event.preventDefault();
        activeIndex.value = props.options.reduce((last, option, index) => (option.disabled ? last : index), -1);
        nextTick(() => scrollActiveIntoView());
      }
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      if (!open.value) openMenu();
      else if (activeIndex.value >= 0) choose(props.options[activeIndex.value]);
      break;
    case "Escape":
      if (open.value) {
        event.preventDefault();
        closeMenu(true);
      }
      break;
    case "Tab":
      closeMenu();
      break;
    default:
      break;
  }
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (trigger.value?.contains(target) || list.value?.contains(target)) return;
  closeMenu();
}

// Repositioning a teleported list on every scroll frame is jittery; closing is
// both cheaper and what a native pop-up does.
function onScrollOrResize() {
  closeMenu();
}

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
  } else {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
  }
});

watch(
  () => props.disabled,
  (isDisabled) => {
    if (isDisabled) closeMenu();
  }
);

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
});
</script>

<template>
  <button ref="trigger" v-bind="$attrs" type="button" class="smenu" :class="{ 'is-open': open, 'is-empty': !selected }"
    :disabled="props.disabled" :aria-label="props.ariaLabel || undefined" :aria-haspopup="'listbox'"
    :aria-expanded="open" @click="open ? closeMenu() : openMenu()" @keydown="onKeydown">
    <span class="smenu__label">{{ label }}</span>
    <svg class="smenu__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  </button>

  <Teleport to="body">
    <Transition :name="placement.drop === 'down' ? 'smenu-down' : 'smenu-up'">
      <ul v-if="open" ref="list" class="smenu__list" :class="`is-${placement.drop}`" role="listbox"
        :aria-label="props.ariaLabel || undefined" :style="{
          top: `${placement.top}px`,
          left: `${placement.left}px`,
          minWidth: `${placement.width}px`
        }">
        <li v-for="(option, index) in props.options" :key="String(option.value)" class="smenu__option"
          :class="{ 'is-active': index === activeIndex, 'is-selected': option.value === props.modelValue, 'is-disabled': option.disabled }"
          role="option" :aria-selected="option.value === props.modelValue" :aria-disabled="option.disabled || undefined"
          @pointerenter="activeIndex = index" @click="choose(option)">
          <svg class="smenu__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
          <span>{{ option.label }}</span>
        </li>
      </ul>
    </Transition>
  </Teleport>
</template>

<style scoped>
.smenu {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  height: 32px;
  padding: 0 8px 0 11px;
  border: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text) 7%, transparent);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease-out, box-shadow 140ms ease-out;
}

.smenu:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text) 11%, transparent);
}

.smenu.is-open {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.smenu:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
}

.smenu:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.smenu.is-empty .smenu__label {
  color: var(--muted);
}

.smenu__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smenu__chevron {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--muted);
  transition: transform 220ms cubic-bezier(0.32, 0.72, 0, 1);
}

.smenu.is-open .smenu__chevron {
  transform: rotate(180deg);
}
</style>

<style>
/* Unscoped: the list lives in `body`, outside this component's subtree. */
.smenu__list {
  position: fixed;
  z-index: 9999998;
  max-height: 18rem;
  margin: 0;
  padding: 5px;
  list-style: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 10px;
  background: var(--surface-2);
  box-shadow:
    0 0 0 1px var(--line-strong),
    0 12px 34px rgba(0, 0, 0, .42);
}

.smenu__list.is-up {
  transform: translateY(-100%);
}

.smenu__option {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 5px 11px 5px 7px;
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.3;
  cursor: pointer;
  transition: background 100ms ease-out;
}

.smenu__option.is-active:not(.is-disabled) {
  background: var(--accent);
  color: #fff;
}

.smenu__option.is-disabled {
  opacity: .4;
  cursor: not-allowed;
}

.smenu__check {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  opacity: 0;
}

.smenu__option.is-selected .smenu__check {
  opacity: 1;
}

/* Grows out of the edge it is anchored to. */
.smenu-down-enter-active,
.smenu-up-enter-active {
  transition: opacity .16s ease-out, transform .24s cubic-bezier(0.32, 0.72, 0, 1);
}

.smenu-down-leave-active,
.smenu-up-leave-active {
  transition: opacity .12s ease-in, transform .16s ease-in;
}

.smenu-down-enter-from,
.smenu-down-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(.97);
}

.smenu-up-enter-from,
.smenu-up-leave-to {
  opacity: 0;
  transform: translateY(calc(-100% + 6px)) scale(.97);
}

@media (prefers-reduced-motion: reduce) {

  .smenu-down-enter-active,
  .smenu-up-enter-active,
  .smenu-down-leave-active,
  .smenu-up-leave-active {
    transition: opacity .1s linear;
  }

  .smenu-down-enter-from,
  .smenu-down-leave-to {
    transform: none;
  }

  .smenu-up-enter-from,
  .smenu-up-leave-to {
    transform: translateY(-100%);
  }
}
</style>
