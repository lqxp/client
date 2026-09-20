<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

export interface StackSlice {
  label: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    slices: StackSlice[];
    title: string;
    caption?: string;
    valueLabel: string;
  }>(),
  { caption: "" }
);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const showTable = ref(false);
const hovered = ref(-1);

const total = computed(() => props.slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0));

const parts = computed(() =>
  props.slices.map((slice, index) => {
    const value = Math.max(0, slice.value);
    const share = total.value ? (value / total.value) * 100 : 0;
    return {
      ...slice,
      value,
      share,
      index,
      // Roughly six characters fit per 10% of a full-width bar; below that the
      // label would be clipped, and the tooltip carries it instead.
      fits: share >= 14,
    };
  })
);

function pct(share: number): string {
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
}
</script>

<template>
  <figure class="stack">
    <figcaption class="stack__head">
      <div>
        <span class="stack__title">{{ title }}</span>
        <span v-if="caption" class="stack__caption">{{ caption }}</span>
      </div>
      <button type="button" class="stack__toggle" :aria-pressed="showTable"
        @click="showTable = !showTable">{{ showTable ? t('chart.graph') : t('chart.table') }}</button>
    </figcaption>

    <p v-if="!total" class="stack__empty">{{ t('chart.empty') }}</p>

    <template v-else-if="!showTable">
      <div class="stack__bar" role="img" :aria-label="`${title}: ${total} ${valueLabel}`">
        <span v-for="part in parts" :key="part.label" class="stack__seg"
          :class="[`stack__seg--${part.index % 3}`, { 'is-hovered': hovered === part.index }]"
          :style="{ width: `${part.share}%`, '--i': part.index }" tabindex="0"
          :aria-label="`${part.label}: ${part.value}`" @pointerenter="hovered = part.index"
          @pointerleave="hovered = -1" @focus="hovered = part.index" @blur="hovered = -1">
          <span v-if="part.fits" class="stack__inline">{{ pct(part.share) }}</span>
        </span>
      </div>

      <!-- Two or more series, so the legend is always there; identity never
           rests on colour alone. -->
      <ul class="stack__legend">
        <li v-for="part in parts" :key="part.label" class="stack__key"
          :class="{ 'is-hovered': hovered === part.index }" @pointerenter="hovered = part.index"
          @pointerleave="hovered = -1">
          <span class="stack__swatch" :class="`stack__seg--${part.index % 3}`"></span>
          <span class="stack__key-label">{{ part.label }}</span>
          <span class="stack__key-value">{{ part.value }}</span>
        </li>
      </ul>
    </template>

    <table v-else class="stack__table">
      <thead>
        <tr>
          <th scope="col">{{ title }}</th>
          <th scope="col" class="stack__num">{{ valueLabel }}</th>
          <th scope="col" class="stack__num">%</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="part in parts" :key="part.label">
          <td>{{ part.label }}</td>
          <td class="stack__num">{{ part.value }}</td>
          <td class="stack__num">{{ pct(part.share) }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.stack {
  margin: 0;
}

.stack__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 10px;
}

.stack__title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.stack__caption {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.stack__toggle {
  flex: none;
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--muted);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: background-color 140ms ease-out, color 140ms ease-out;
}

.stack__toggle:hover {
  background: color-mix(in srgb, var(--text) 13%, transparent);
  color: var(--text);
}

.stack__empty {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.stack__bar {
  display: flex;
  /* The gap is the separator; no segment carries a border. */
  gap: 2px;
  height: 26px;
  border-radius: 7px;
  overflow: hidden;
}

.stack__seg {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 3px;
  transform-origin: left;
  animation: stack-grow 620ms cubic-bezier(0.32, 0.72, 0, 1) both;
  animation-delay: calc(var(--i) * 70ms);
  transition: filter 140ms ease-out;
}

.stack__seg:first-child {
  border-radius: 7px 0 0 7px;
}

.stack__seg:last-child {
  border-radius: 0 7px 7px 0;
}

.stack__seg.is-hovered {
  filter: brightness(1.16);
}

.stack__seg:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: -3px;
}

/* The four validated categorical marks live in styles.css, once. */
.stack__seg--0 {
  background: var(--chart-1);
}

.stack__seg--1 {
  background: var(--chart-2);
}

.stack__seg--2 {
  background: var(--chart-3);
}

/* The one place text may sit on a fill: it is measured to fit first. */
.stack__inline {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .35);
}

.stack__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.stack__key {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  transition: opacity 140ms ease-out;
}

.stack__legend:hover .stack__key:not(.is-hovered) {
  opacity: .5;
}

.stack__swatch {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

.stack__key-label {
  color: var(--muted);
}

.stack__key-value {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.stack__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.stack__table th,
.stack__table td {
  padding: 5px 0;
  text-align: left;
  color: var(--text);
}

.stack__table th {
  color: var(--muted);
  font-weight: 500;
}

.stack__table tbody tr + tr td {
  border-top: 1px solid var(--line);
}

.stack__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@keyframes stack-grow {
  from { transform: scaleX(0); opacity: .35; }
  to { transform: scaleX(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {

  .stack__seg {
    animation: none;
  }
}
</style>
