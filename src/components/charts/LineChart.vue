<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

export interface LinePoint {
  /** Epoch milliseconds. */
  at: number;
  value: number;
}

export interface LineSeries {
  label: string;
  points: LinePoint[];
}

const props = withDefaults(
  defineProps<{
    series: LineSeries[];
    title: string;
    caption?: string;
    valueLabel: string;
    /** Renders a timestamp for the axis and the tooltip. */
    formatX: (at: number) => string;
    formatValue?: (value: number) => string;
  }>(),
  { caption: "", formatValue: (value: number) => String(value) }
);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

/** User units. The SVG scales to its box, so these are only a coordinate space. */
const W = 560;
const H = 184;
const PAD = { top: 16, right: 26, bottom: 26, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const showTable = ref(false);
const hovered = ref(-1);

const clean = computed<LineSeries[]>(() =>
  props.series
    .map((serie) => ({
      label: serie.label,
      points: [...serie.points].filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value))
        .sort((a, b) => a.at - b.at),
    }))
    .filter((serie) => serie.points.length > 0)
);

/** Every x the chart knows about, shared by all series. */
const stamps = computed(() => {
  const all = new Set<number>();
  for (const serie of clean.value) for (const point of serie.points) all.add(point.at);
  return [...all].sort((a, b) => a - b);
});

const xRange = computed(() => {
  const list = stamps.value;
  if (!list.length) return { min: 0, max: 1 };
  const min = list[0];
  const max = list[list.length - 1];
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
});

/**
 * A ceiling the eye can divide: 1, 2 or 5 times a power of ten, never the raw
 * maximum, so the gridline labels are round numbers.
 */
const yMax = computed(() => {
  let peak = 0;
  for (const serie of clean.value) for (const point of serie.points) peak = Math.max(peak, point.value);
  if (peak <= 0) return 2;
  if (peak <= 8) return Math.ceil(peak / 2) * 2;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 2, 4, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= peak) return candidate;
  }
  return 10 * magnitude;
});

function xAt(at: number): number {
  const { min, max } = xRange.value;
  return PAD.left + ((at - min) / (max - min)) * PLOT_W;
}

function yAt(value: number): number {
  return PAD.top + PLOT_H - (Math.max(0, value) / yMax.value) * PLOT_H;
}

interface PlottedSeries {
  label: string;
  index: number;
  dots: { x: number; y: number; at: number; value: number }[];
  line: string;
  area: string;
  length: number;
}

const plotted = computed<PlottedSeries[]>(() =>
  clean.value.map((serie, index) => {
    const dots = serie.points.map((point) => ({
      x: xAt(point.at),
      y: yAt(point.value),
      at: point.at,
      value: point.value,
    }));
    const line = dots.map((dot, i) => `${i ? "L" : "M"}${dot.x.toFixed(2)} ${dot.y.toFixed(2)}`).join(" ");
    const baseline = PAD.top + PLOT_H;
    const area = dots.length
      ? `${line} L${dots[dots.length - 1].x.toFixed(2)} ${baseline} L${dots[0].x.toFixed(2)} ${baseline} Z`
      : "";
    // Measured here rather than with getTotalLength(): the path is straight
    // segments in these same units, so the sum is exact and needs no DOM. It
    // is the dash that draws the line in, so it is padded by a unit: a length
    // a hair short of the path leaves the last pixel of it in the gap.
    let length = 0;
    for (let i = 1; i < dots.length; i += 1) {
      length += Math.hypot(dots[i].x - dots[i - 1].x, dots[i].y - dots[i - 1].y);
    }
    return { label: serie.label, index, dots, line, area, length: Math.max(1, length) + 1 };
  })
);

const single = computed(() => plotted.value.length === 1);

const yTicks = computed(() =>
  [0, 0.5, 1].map((fraction) => ({
    value: yMax.value * fraction,
    y: PAD.top + PLOT_H - fraction * PLOT_H,
  }))
);

/**
 * First, middle and last only: a label under every point collides. The middle
 * one is dropped when the samples are unevenly spaced and it lands close
 * enough to an end to overprint it.
 */
const xTicks = computed(() => {
  const list = stamps.value;
  if (list.length < 2) return list.map((at) => ({ at, x: xAt(at), anchor: "middle" as const }));
  const ends = [
    { at: list[0], x: xAt(list[0]), anchor: "start" as const },
    { at: list[list.length - 1], x: xAt(list[list.length - 1]), anchor: "end" as const },
  ];
  if (list.length < 3) return ends;
  const middle = list[Math.floor(list.length / 2)];
  const x = xAt(middle);
  const room = PLOT_W * 0.18;
  if (x - ends[0].x < room || ends[1].x - x < room) return ends;
  return [ends[0], { at: middle, x, anchor: "middle" as const }, ends[1]];
});

const baseline = PAD.top + PLOT_H;
const axisEndX = W - PAD.right + 9;

/** Both axes in one stroke, each running a little past the last gridline. */
const axisPath = `M${PAD.left} ${PAD.top - 9} L${PAD.left} ${baseline} L${axisEndX} ${baseline}`;
const upHead = `${PAD.left},${PAD.top - 15} ${PAD.left - 3.6},${PAD.top - 8} ${PAD.left + 3.6},${PAD.top - 8}`;
const rightHead = `${axisEndX + 6},${baseline} ${axisEndX - 1},${baseline - 3.6} ${axisEndX - 1},${baseline + 3.6}`;

const hoveredStamp = computed(() => (hovered.value >= 0 ? stamps.value[hovered.value] : 0));

const readout = computed(() => {
  if (hovered.value < 0) return null;
  const at = hoveredStamp.value;
  return {
    at,
    x: xAt(at),
    rows: plotted.value
      .map((serie) => ({ label: serie.label, index: serie.index, dot: serie.dots.find((dot) => dot.at === at) }))
      .filter((row): row is { label: string; index: number; dot: { x: number; y: number; at: number; value: number } } =>
        Boolean(row.dot)
      ),
  };
});

/** Which side the tooltip opens on, so it never leaves the plot. */
const readoutSide = computed(() => (readout.value && readout.value.x > PAD.left + PLOT_W * 0.6 ? "left" : "right"));

function trackPointer(event: PointerEvent) {
  const box = (event.currentTarget as SVGGraphicsElement).getBoundingClientRect();
  if (!box.width || !stamps.value.length) return;
  const at = xRange.value.min + ((event.clientX - box.left) / box.width) * (xRange.value.max - xRange.value.min);
  let nearest = 0;
  let best = Infinity;
  stamps.value.forEach((stamp, index) => {
    const distance = Math.abs(stamp - at);
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  });
  hovered.value = nearest;
}

function stepHover(delta: number) {
  if (!stamps.value.length) return;
  const next = hovered.value < 0 ? (delta > 0 ? 0 : stamps.value.length - 1) : hovered.value + delta;
  hovered.value = Math.min(stamps.value.length - 1, Math.max(0, next));
}

function valueAt(serie: PlottedSeries, at: number): string {
  const dot = serie.dots.find((entry) => entry.at === at);
  return dot ? props.formatValue(dot.value) : "";
}
</script>

<template>
  <figure class="line">
    <figcaption class="line__head">
      <div>
        <span class="line__title">{{ title }}</span>
        <span v-if="caption" class="line__caption">{{ caption }}</span>
      </div>
      <button type="button" class="line__toggle" :aria-pressed="showTable" @click="showTable = !showTable">
        {{ showTable ? t('chart.graph') : t('chart.table') }}
      </button>
    </figcaption>

    <p v-if="!stamps.length" class="line__empty">{{ t('chart.empty') }}</p>

    <div v-else-if="!showTable" class="line__body">
      <svg class="line__svg" :viewBox="`0 0 ${W} ${H}`" role="img"
        :aria-label="`${title}. ${valueLabel}`" tabindex="0" @pointermove="trackPointer"
        @pointerleave="hovered = -1" @keydown.left.prevent="stepHover(-1)" @keydown.right.prevent="stepHover(1)"
        @blur="hovered = -1">
        <defs>
          <linearGradient v-for="serie in plotted" :id="`line-fade-${serie.index}`" :key="`grad-${serie.index}`"
            x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="`var(--chart-${serie.index + 1})`" stop-opacity=".26" />
            <stop offset="100%" :stop-color="`var(--chart-${serie.index + 1})`" stop-opacity="0" />
          </linearGradient>
        </defs>

        <!-- The baseline is drawn by the axis, so it is not also a gridline. -->
        <g class="line__grid">
          <line v-for="tick in yTicks.slice(1)" :key="`grid-${tick.value}`" :x1="PAD.left"
            :x2="W - PAD.right" :y1="tick.y" :y2="tick.y" />
        </g>

        <g class="line__frame">
          <path :d="axisPath" />
          <polygon :points="upHead" />
          <polygon :points="rightHead" />
        </g>

        <g class="line__axis">
          <text v-for="tick in yTicks" :key="`ylab-${tick.value}`" :x="PAD.left - 8" :y="tick.y + 3.5"
            text-anchor="end">{{ formatValue(tick.value) }}</text>
          <text v-for="tick in xTicks" :key="`xlab-${tick.at}`" :x="tick.x" :y="H - 8" :text-anchor="tick.anchor">
            {{ formatX(tick.at) }}
          </text>
        </g>

        <line v-if="readout" class="line__crosshair" :x1="readout.x" :x2="readout.x" :y1="PAD.top"
          :y2="PAD.top + PLOT_H" />

        <g v-for="serie in plotted" :key="`serie-${serie.index}`" :class="`line__serie line__serie--${serie.index}`"
          :style="{ '--len': serie.length, '--i': serie.index }">
          <path v-if="single && serie.area" class="line__area" :d="serie.area"
            :fill="`url(#line-fade-${serie.index})`" />
          <path class="line__stroke" :d="serie.line" />
          <circle v-for="dot in (serie.dots.length <= 6 ? serie.dots : [])" :key="`dot-${dot.at}`"
            class="line__lone" :cx="dot.x" :cy="dot.y" r="4" />
        </g>

        <g v-if="readout" class="line__marks">
          <circle v-for="row in readout.rows" :key="`mark-${row.index}`" :class="`line__mark line__mark--${row.index}`"
            :cx="row.dot.x" :cy="row.dot.y" r="5" />
        </g>
      </svg>

      <div v-if="readout" class="line__tip" :class="`is-${readoutSide}`"
        :style="{ left: `${(readout.x / W) * 100}%` }">
        <span class="line__tip-when">{{ formatX(readout.at) }}</span>
        <span v-for="row in readout.rows" :key="`tip-${row.index}`" class="line__tip-row">
          <span class="line__swatch" :class="`line__swatch--${row.index}`"></span>
          <span class="line__tip-label">{{ row.label }}</span>
          <span class="line__tip-value">{{ formatValue(row.dot.value) }}</span>
        </span>
      </div>

      <!-- Two or more series, so identity never rests on colour alone. -->
      <ul v-if="plotted.length > 1" class="line__legend">
        <li v-for="serie in plotted" :key="`key-${serie.index}`" class="line__key">
          <span class="line__swatch" :class="`line__swatch--${serie.index}`"></span>
          <span class="line__key-label">{{ serie.label }}</span>
        </li>
      </ul>
    </div>

    <div v-else class="line__scroll">
      <table class="line__table">
        <thead>
          <tr>
            <th scope="col">{{ valueLabel }}</th>
            <th v-for="serie in plotted" :key="`th-${serie.index}`" scope="col" class="line__num">
              {{ serie.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="at in stamps" :key="`tr-${at}`">
            <td>{{ formatX(at) }}</td>
            <td v-for="serie in plotted" :key="`td-${serie.index}-${at}`" class="line__num">
              {{ valueAt(serie, at) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>

<style scoped>
.line {
  margin: 0;
}

.line__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 10px;
}

.line__title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.line__caption {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.line__toggle {
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
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.line__toggle:hover {
  background: color-mix(in srgb, var(--text) 13%, transparent);
  color: var(--text);
}

.line__empty {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.line__body {
  position: relative;
}

.line__svg {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 560 / 184;
  overflow: visible;
  touch-action: none;
}

.line__svg:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 8px;
}

/* Recessive: the data is the only thing meant to be read first. */
.line__grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.line__frame path {
  fill: none;
  stroke: color-mix(in srgb, var(--text) 22%, transparent);
  stroke-width: 1;
  stroke-linecap: square;
  vector-effect: non-scaling-stroke;
}

.line__frame polygon {
  fill: color-mix(in srgb, var(--text) 22%, transparent);
}

.line__axis text {
  fill: var(--muted);
  font-family: inherit;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.line__crosshair {
  stroke: color-mix(in srgb, var(--text) 26%, transparent);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}

.line__stroke {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: var(--len);
  stroke-dashoffset: var(--len);
  animation: line-draw 900ms var(--ease-out) both;
  animation-delay: calc(var(--i) * 120ms);
}

.line__area {
  animation: line-fade 700ms var(--ease-out) both;
  animation-delay: calc(240ms + var(--i) * 120ms);
}

.line__lone,
.line__mark {
  stroke: var(--chart-surface, var(--surface-2));
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.line__serie--0 .line__stroke { stroke: var(--chart-1); }
.line__serie--1 .line__stroke { stroke: var(--chart-2); }
.line__serie--2 .line__stroke { stroke: var(--chart-3); }
.line__serie--3 .line__stroke { stroke: var(--chart-4); }

.line__serie--0 .line__lone { fill: var(--chart-1); }
.line__serie--1 .line__lone { fill: var(--chart-2); }
.line__serie--2 .line__lone { fill: var(--chart-3); }
.line__serie--3 .line__lone { fill: var(--chart-4); }

.line__mark--0 { fill: var(--chart-1); }
.line__mark--1 { fill: var(--chart-2); }
.line__mark--2 { fill: var(--chart-3); }
.line__mark--3 { fill: var(--chart-4); }

.line__swatch--0 { background: var(--chart-1); }
.line__swatch--1 { background: var(--chart-2); }
.line__swatch--2 { background: var(--chart-3); }
.line__swatch--3 { background: var(--chart-4); }

.line__tip {
  position: absolute;
  top: 4px;
  display: grid;
  gap: 3px;
  min-width: 96px;
  padding: 7px 9px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--surface) 94%, var(--text));
  box-shadow: 0 8px 24px rgba(0, 0, 0, .22);
  pointer-events: none;
  animation: line-tip var(--dur-base) var(--ease-out) both;
}

.line__tip.is-right {
  transform: translateX(10px);
}

.line__tip.is-left {
  transform: translateX(calc(-100% - 10px));
}

.line__tip-when {
  font-size: 11px;
  color: var(--muted);
}

.line__tip-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.line__tip-label {
  color: var(--muted);
}

.line__tip-value {
  margin-left: auto;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.line__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.line__key {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.line__key-label {
  color: var(--muted);
}

.line__swatch {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

/* The SVG scales to its box, so its text scales down with it. On a phone the
   box is not much over half the coordinate space, which would take the axis
   labels under seven pixels; the plot is given more height and the labels
   more units to compensate. */
@media (max-width: 760px) {

  .line__svg {
    aspect-ratio: 560 / 236;
  }

  .line__axis text {
    font-size: 15px;
  }
}

.line__scroll {
  overflow-x: auto;
}

.line__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.line__table th,
.line__table td {
  padding: 5px 0;
  text-align: left;
  white-space: nowrap;
  color: var(--text);
}

.line__table th {
  color: var(--muted);
  font-weight: 500;
}

.line__table tbody tr + tr td {
  border-top: 1px solid var(--line);
}

.line__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@keyframes line-draw {
  from { stroke-dashoffset: var(--len); }
  to { stroke-dashoffset: 0; }
}

@keyframes line-fade {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes line-tip {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {

  .line__stroke {
    animation: none;
    stroke-dasharray: none;
    stroke-dashoffset: 0;
  }

  .line__area,
  .line__tip {
    animation: none;
  }
}
</style>
