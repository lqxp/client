<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

export interface DonutSlice {
  label: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    slices: DonutSlice[];
    title: string;
    caption?: string;
    valueLabel: string;
  }>(),
  { caption: "" }
);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const SIZE = 132;
const STROKE = 18;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** Two px of surface between arcs, in the same units as the circumference. */
const GAP = 2;

const showTable = ref(false);
const hovered = ref(-1);

/** A fifth slice would need a hue the validator rejects, so it rolls up. */
const grouped = computed<DonutSlice[]>(() => {
  const sorted = [...props.slices].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= 4) return sorted;
  const head = sorted.slice(0, 3);
  const rest = sorted.slice(3).reduce((sum, slice) => sum + slice.value, 0);
  return [...head, { label: t("chart.other"), value: rest }];
});

const total = computed(() => grouped.value.reduce((sum, slice) => sum + slice.value, 0));

const arcs = computed(() => {
  let offset = 0;
  return grouped.value.map((slice, index) => {
    const share = total.value ? slice.value / total.value : 0;
    const length = Math.max(0, share * CIRCUMFERENCE - GAP);
    const arc = {
      ...slice,
      index,
      share,
      dash: `${length} ${CIRCUMFERENCE - length}`,
      offset: -offset,
    };
    offset += share * CIRCUMFERENCE;
    return arc;
  });
});

const active = computed(() => (hovered.value >= 0 ? arcs.value[hovered.value] : null));

function pct(share: number): string {
  const value = share * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

function compact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
</script>

<template>
  <figure class="donut">
    <figcaption class="donut__head">
      <div>
        <span class="donut__title">{{ title }}</span>
        <span v-if="caption" class="donut__caption">{{ caption }}</span>
      </div>
      <button type="button" class="donut__toggle" :aria-pressed="showTable"
        @click="showTable = !showTable">{{ showTable ? t('chart.graph') : t('chart.table') }}</button>
    </figcaption>

    <p v-if="!total" class="donut__empty">{{ t('chart.empty') }}</p>

    <div v-else-if="!showTable" class="donut__body">
      <div class="donut__ring">
        <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" role="img"
          :aria-label="`${title}: ${total} ${valueLabel}`">
          <g :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`">
            <circle class="donut__track" :cx="SIZE / 2" :cy="SIZE / 2" :r="R"
              :stroke-width="STROKE" />
            <circle v-for="arc in arcs" :key="arc.label" class="donut__arc"
              :class="[`donut__arc--${arc.index}`, { 'is-dim': hovered >= 0 && hovered !== arc.index }]"
              :cx="SIZE / 2" :cy="SIZE / 2" :r="R" :stroke-width="STROKE"
              :stroke-dasharray="arc.dash" :stroke-dashoffset="arc.offset"
              :style="{ '--i': arc.index }" tabindex="0"
              :aria-label="`${arc.label}: ${arc.value}`" @pointerenter="hovered = arc.index"
              @pointerleave="hovered = -1" @focus="hovered = arc.index" @blur="hovered = -1" />
          </g>
        </svg>

        <!-- The hole is not decoration: it holds the figure the ring is of. -->
        <div class="donut__centre">
          <strong>{{ active ? pct(active.share) : compact(total) }}</strong>
          <span>{{ active ? active.label : valueLabel }}</span>
        </div>
      </div>

      <ul class="donut__legend">
        <li v-for="arc in arcs" :key="arc.label" class="donut__key"
          :class="{ 'is-hovered': hovered === arc.index }" @pointerenter="hovered = arc.index"
          @pointerleave="hovered = -1">
          <span class="donut__swatch" :class="`donut__arc--${arc.index}`"></span>
          <span class="donut__key-label">{{ arc.label }}</span>
          <span class="donut__key-value">{{ arc.value }}</span>
        </li>
      </ul>
    </div>

    <table v-else class="donut__table">
      <thead>
        <tr>
          <th scope="col">{{ title }}</th>
          <th scope="col" class="donut__num">{{ valueLabel }}</th>
          <th scope="col" class="donut__num">%</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="arc in arcs" :key="arc.label">
          <td>{{ arc.label }}</td>
          <td class="donut__num">{{ arc.value }}</td>
          <td class="donut__num">{{ pct(arc.share) }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.donut {
  margin: 0;
}

.donut__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 10px;
}

.donut__title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.donut__caption {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.donut__toggle {
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

.donut__toggle:hover {
  background: color-mix(in srgb, var(--text) 13%, transparent);
  color: var(--text);
}

.donut__empty {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.donut__body {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.donut__ring {
  position: relative;
  flex: none;
  width: 132px;
  height: 132px;
}

.donut__ring svg {
  display: block;
  width: 100%;
  height: 100%;
}

.donut__track {
  fill: none;
  stroke: var(--chart-track);
}

.donut__arc {
  fill: none;
  stroke-linecap: butt;
  transform-origin: center;
  animation: donut-sweep 720ms cubic-bezier(0.32, 0.72, 0, 1) both;
  animation-delay: calc(var(--i) * 90ms);
  transition: opacity 160ms ease-out, stroke-width 200ms cubic-bezier(0.32, 0.72, 0, 1);
  cursor: pointer;
}

.donut__arc:focus-visible {
  outline: none;
  stroke-width: 22;
}

.donut__arc.is-dim {
  opacity: .38;
}

.donut__arc:not(.is-dim):hover {
  stroke-width: 22;
}

/* The four validated categorical marks live in styles.css, once. */
.donut__arc--0,
.donut__swatch.donut__arc--0 {
  stroke: var(--chart-1);
  background: var(--chart-1);
}

.donut__arc--1,
.donut__swatch.donut__arc--1 {
  stroke: var(--chart-2);
  background: var(--chart-2);
}

.donut__arc--2,
.donut__swatch.donut__arc--2 {
  stroke: var(--chart-3);
  background: var(--chart-3);
}

.donut__arc--3,
.donut__swatch.donut__arc--3 {
  stroke: var(--chart-4);
  background: var(--chart-4);
}

.donut__centre {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1px;
  pointer-events: none;
  text-align: center;
}

.donut__centre strong {
  font-size: 19px;
  font-weight: 600;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.donut__centre span {
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--muted);
}

.donut__legend {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.donut__key {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  transition: opacity 140ms ease-out;
}

.donut__legend:hover .donut__key:not(.is-hovered) {
  opacity: .5;
}

.donut__swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

.donut__key-label {
  color: var(--muted);
}

.donut__key-value {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.donut__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.donut__table th,
.donut__table td {
  padding: 5px 0;
  text-align: left;
  color: var(--text);
}

.donut__table th {
  color: var(--muted);
  font-weight: 500;
}

.donut__table tbody tr + tr td {
  border-top: 1px solid var(--line);
}

.donut__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@keyframes donut-sweep {
  from { opacity: 0; transform: rotate(-24deg) scale(.9); }
  to { opacity: 1; transform: rotate(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {

  .donut__arc {
    animation: none;
    transition: opacity 120ms linear;
  }

  .donut__arc:hover,
  .donut__arc:focus-visible {
    stroke-width: 18;
  }
}
</style>
