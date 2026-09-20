<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

export interface PieSlice {
  label: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    slices: PieSlice[];
    title: string;
    caption?: string;
    valueLabel: string;
  }>(),
  { caption: "" }
);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const SIZE = 148;
const CENTRE = SIZE / 2;
const R = 66;
/** Two px of surface between slices, expressed as the angle that spans. */
const GAP = 2 / R;
/** How far a slice leans out when it is the one being read. */
const LEAN = 5;

const showTable = ref(false);
const hovered = ref(-1);

const grouped = computed<PieSlice[]>(() => {
  const sorted = [...props.slices].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= 4) return sorted;
  const rest = sorted.slice(3).reduce((sum, slice) => sum + slice.value, 0);
  return [...sorted.slice(0, 3), { label: t("chart.other"), value: rest }];
});

const total = computed(() => grouped.value.reduce((sum, slice) => sum + slice.value, 0));

function polar(angle: number, radius: number): string {
  return `${(CENTRE + radius * Math.cos(angle)).toFixed(2)} ${(CENTRE + radius * Math.sin(angle)).toFixed(2)}`;
}

interface PieArc extends PieSlice {
  index: number;
  share: number;
  path: string;
  /** Unit vector along the bisector, for the lean and the inline label. */
  lean: string;
  labelX: number;
  labelY: number;
  fits: boolean;
}

const arcs = computed<PieArc[]>(() => {
  const whole = total.value;
  let angle = -Math.PI / 2;
  return grouped.value.map((slice, index) => {
    const span = whole ? (slice.value / whole) * Math.PI * 2 : 0;
    const only = grouped.value.length === 1;
    // A lone slice is a disc: an arc from a point back to itself draws nothing.
    const inset = only ? 0 : Math.min(GAP / 2, span / 4);
    const from = angle + inset;
    const to = angle + span - inset;
    const mid = angle + span / 2;
    const path = only
      ? `M ${polar(-Math.PI / 2, R)} A ${R} ${R} 0 1 1 ${polar(-Math.PI / 2 + Math.PI, R)} A ${R} ${R} 0 1 1 ${polar(-Math.PI / 2, R)} Z`
      : `M ${CENTRE} ${CENTRE} L ${polar(from, R)} A ${R} ${R} 0 ${to - from > Math.PI ? 1 : 0} 1 ${polar(to, R)} Z`;
    angle += span;
    return {
      ...slice,
      index,
      share: whole ? slice.value / whole : 0,
      path,
      lean: `${(Math.cos(mid) * LEAN).toFixed(2)}px, ${(Math.sin(mid) * LEAN).toFixed(2)}px`,
      labelX: only ? CENTRE : CENTRE + Math.cos(mid) * R * 0.62,
      labelY: (only ? CENTRE : CENTRE + Math.sin(mid) * R * 0.62) + 4,
      // Under about an eighth of the circle the label no longer clears its own
      // slice, and the legend carries it instead.
      fits: whole ? slice.value / whole >= 0.12 : false,
    };
  });
});

function pct(share: number): string {
  const value = share * 100;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}
</script>

<template>
  <figure class="pie">
    <figcaption class="pie__head">
      <div>
        <span class="pie__title">{{ title }}</span>
        <span v-if="caption" class="pie__caption">{{ caption }}</span>
      </div>
      <button type="button" class="pie__toggle" :aria-pressed="showTable" @click="showTable = !showTable">
        {{ showTable ? t('chart.graph') : t('chart.table') }}
      </button>
    </figcaption>

    <p v-if="!total" class="pie__empty">{{ t('chart.empty') }}</p>

    <div v-else-if="!showTable" class="pie__body">
      <svg class="pie__svg" :viewBox="`0 0 ${SIZE} ${SIZE}`" role="img"
        :aria-label="`${title}: ${total} ${valueLabel}`">
        <g v-for="arc in arcs" :key="arc.label" class="pie__slice" :class="[
          `pie__slice--${arc.index}`,
          { 'is-lifted': hovered === arc.index, 'is-dim': hovered >= 0 && hovered !== arc.index }
        ]" :style="{ '--i': arc.index, '--lean': arc.lean }" tabindex="0"
          :aria-label="`${arc.label}: ${arc.value} (${pct(arc.share)})`"
          @pointerenter="hovered = arc.index" @pointerleave="hovered = -1" @focus="hovered = arc.index"
          @blur="hovered = -1">
          <path class="pie__wedge" :d="arc.path" />
          <!-- The one place text may sit on a fill: it is measured to fit first. -->
          <text v-if="arc.fits" class="pie__inline" :x="arc.labelX" :y="arc.labelY" text-anchor="middle">
            {{ pct(arc.share) }}
          </text>
        </g>
      </svg>

      <ul class="pie__legend">
        <li v-for="arc in arcs" :key="arc.label" class="pie__key" :class="{ 'is-hovered': hovered === arc.index }"
          @pointerenter="hovered = arc.index" @pointerleave="hovered = -1">
          <span class="pie__swatch" :class="`pie__swatch--${arc.index}`"></span>
          <span class="pie__key-label">{{ arc.label }}</span>
          <span class="pie__key-value">{{ arc.value }}</span>
        </li>
      </ul>
    </div>

    <table v-else class="pie__table">
      <thead>
        <tr>
          <th scope="col">{{ title }}</th>
          <th scope="col" class="pie__num">{{ valueLabel }}</th>
          <th scope="col" class="pie__num">%</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="arc in arcs" :key="arc.label">
          <td>{{ arc.label }}</td>
          <td class="pie__num">{{ arc.value }}</td>
          <td class="pie__num">{{ pct(arc.share) }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.pie {
  margin: 0;
}

.pie__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 10px;
}

.pie__title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.pie__caption {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.pie__toggle {
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

.pie__toggle:hover {
  background: color-mix(in srgb, var(--text) 13%, transparent);
  color: var(--text);
}

.pie__empty {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.pie__body {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.pie__svg {
  display: block;
  flex: none;
  width: 148px;
  height: 148px;
  overflow: visible;
}

.pie__slice {
  transform-origin: center;
  cursor: pointer;
  animation: pie-in 640ms cubic-bezier(0.32, 0.72, 0, 1) both;
  animation-delay: calc(var(--i) * 80ms);
  transition: opacity 160ms ease-out, translate 260ms cubic-bezier(0.32, 0.72, 0, 1);
}

.pie__slice.is-lifted {
  translate: var(--lean);
}

.pie__slice.is-dim {
  opacity: .42;
}

.pie__slice:focus-visible {
  outline: none;
}

.pie__slice:focus-visible .pie__wedge {
  stroke: var(--text);
  stroke-width: 2;
  paint-order: stroke;
}

.pie__slice--0 .pie__wedge { fill: var(--chart-1); }
.pie__slice--1 .pie__wedge { fill: var(--chart-2); }
.pie__slice--2 .pie__wedge { fill: var(--chart-3); }
.pie__slice--3 .pie__wedge { fill: var(--chart-4); }

.pie__swatch--0 { background: var(--chart-1); }
.pie__swatch--1 { background: var(--chart-2); }
.pie__swatch--2 { background: var(--chart-3); }
.pie__swatch--3 { background: var(--chart-4); }

.pie__inline {
  fill: #fff;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .35);
}

.pie__legend {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pie__key {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  transition: opacity 140ms ease-out;
}

.pie__legend:hover .pie__key:not(.is-hovered) {
  opacity: .5;
}

.pie__swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

.pie__key-label {
  color: var(--muted);
}

.pie__key-value {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.pie__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.pie__table th,
.pie__table td {
  padding: 5px 0;
  text-align: left;
  color: var(--text);
}

.pie__table th {
  color: var(--muted);
  font-weight: 500;
}

.pie__table tbody tr + tr td {
  border-top: 1px solid var(--line);
}

.pie__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@keyframes pie-in {
  from { opacity: 0; transform: rotate(-14deg) scale(.86); }
  to { opacity: 1; transform: rotate(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {

  .pie__slice {
    animation: none;
    transition: opacity 120ms linear;
  }

  .pie__slice.is-lifted {
    translate: none;
  }
}
</style>
