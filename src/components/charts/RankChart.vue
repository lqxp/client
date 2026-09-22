<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "@/composables/useI18n";

export interface RankRow {
  label: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    rows: RankRow[];
    title: string;
    caption?: string;
    valueLabel: string;
    max?: number;
  }>(),
  { caption: "", max: 8 }
);

const { t } = inject<ReturnType<typeof useI18n>>("i18n") ?? useI18n();

const showTable = ref(false);
const hovered = ref(-1);

const visible = computed(() =>
  [...props.rows].sort((a, b) => b.value - a.value).slice(0, props.max)
);

const peak = computed(() => Math.max(1, ...visible.value.map((row) => row.value)));

function widthPct(value: number): number {
  return Math.max(1.5, (value / peak.value) * 100);
}
</script>

<template>
  <figure class="rank">
    <figcaption class="rank__head">
      <div>
        <span class="rank__title">{{ title }}</span>
        <span v-if="caption" class="rank__caption">{{ caption }}</span>
      </div>
      <button type="button" class="rank__toggle" :aria-pressed="showTable"
        @click="showTable = !showTable">{{ showTable ? t('chart.graph') : t('chart.table') }}</button>
    </figcaption>

    <p v-if="!visible.length" class="rank__empty">{{ t('chart.empty') }}</p>

    <ul v-else-if="!showTable" class="rank__list">
      <li v-for="(row, index) in visible" :key="row.label" class="rank__row"
        :class="{ 'is-hovered': hovered === index }" :style="{ '--i': index }"
        tabindex="0" :aria-label="`${row.label}: ${row.value} ${valueLabel}`"
        @pointerenter="hovered = index" @pointerleave="hovered = -1" @focus="hovered = index"
        @blur="hovered = -1">
        <span class="rank__label">{{ row.label }}</span>
        <span class="rank__track">
          <span class="rank__bar" :style="{ width: `${widthPct(row.value)}%` }"></span>
        </span>
        <span class="rank__value">{{ row.value }}</span>
      </li>
    </ul>

    <table v-else class="rank__table">
      <thead>
        <tr>
          <th scope="col">{{ title }}</th>
          <th scope="col" class="rank__num">{{ valueLabel }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in visible" :key="row.label">
          <td>{{ row.label }}</td>
          <td class="rank__num">{{ row.value }}</td>
        </tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
.rank {
  margin: 0;
}

.rank__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 10px;
}

.rank__title {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}

.rank__caption {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted);
}

.rank__toggle {
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

.rank__toggle:hover {
  background: color-mix(in srgb, var(--text) 13%, transparent);
  color: var(--text);
}

.rank__empty {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.rank__list {
  display: grid;
  /* The gap is the separator; no bar ever needs a border. */
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rank__row {
  display: grid;
  grid-template-columns: minmax(0, 8.5rem) 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 2px 4px;
  border-radius: 7px;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.rank__row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.rank__row.is-hovered {
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.rank__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text);
}

.rank__track {
  height: 10px;
  border-radius: 999px;
  background: var(--chart-track);
  overflow: hidden;
}

/* Square where it leaves the baseline, rounded at the data end. */
.rank__bar {
  display: block;
  height: 100%;
  border-radius: 0 4px 4px 0;
  background: var(--chart-1);
  transform-origin: left;
  animation: rank-grow 620ms var(--ease-out) both;
  animation-delay: calc(var(--i) * 45ms);
  transition: filter var(--dur-fast) var(--ease-out);
}

.rank__row.is-hovered .rank__bar {
  filter: brightness(1.14);
}

.rank__value {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.rank__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.rank__table th,
.rank__table td {
  padding: 5px 0;
  text-align: left;
  color: var(--text);
}

.rank__table th {
  color: var(--muted);
  font-weight: 500;
}

.rank__table tbody tr + tr td {
  border-top: 1px solid var(--line);
}

.rank__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@keyframes rank-grow {
  from { transform: scaleX(0); opacity: .4; }
  to { transform: scaleX(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .rank__bar {
    animation: none;
  }
}
</style>
