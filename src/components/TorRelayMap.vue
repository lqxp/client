<script setup lang="ts">
// Equirectangular world map showing where the currently-running Tor relays are
// located. Relays are aggregated by country (Onionoo returns `country`, not
// exact coordinates), so each marker is placed at the country's centroid and
// sized by relay count. Purely local SVG — no tile server, no network.
import { computed } from "vue";
import type { TorRelay } from "@/calls/torRelays";

const props = defineProps<{ relays: TorRelay[] }>();

// Equirectangular viewport.
const W = 800;
const H = 400;

function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return { x, y };
}

// Approximate country centroids (ISO 3166-1 alpha-2). Only countries that host
// relays need entries, but we keep a broad table so the map stays accurate.
const COUNTRY_COORDS: Record<string, [number, number]> = {
  // [lat, lng]
  AD: [42.5, 1.5], AE: [24.0, 54.0], AF: [33.0, 65.0], AG: [17.1, -61.8],
  AL: [41.0, 20.0], AM: [40.0, 45.0], AO: [-12.5, 18.5], AR: [-34.0, -64.0],
  AT: [47.5, 14.5], AU: [-25.0, 134.0], AZ: [40.5, 47.5], BA: [44.0, 18.0],
  BD: [24.0, 90.0], BE: [50.5, 4.0], BF: [12.0, -2.0], BG: [42.5, 25.5],
  BH: [26.0, 50.5], BI: [-3.5, 30.0], BJ: [9.5, 2.25], BN: [4.5, 114.5],
  BO: [-17.0, -65.0], BR: [-10.0, -52.0], BS: [24.0, -76.0], BT: [27.5, 90.5],
  BW: [-22.0, 24.0], BY: [53.0, 28.0], BZ: [17.25, -88.75], CA: [56.0, -106.0],
  CD: [0.0, 25.0], CF: [7.0, 21.0], CG: [-1.0, 15.0], CH: [46.8, 8.2],
  CI: [8.0, -5.0], CL: [-30.0, -71.0], CM: [6.0, 12.0], CN: [35.0, 105.0],
  CO: [4.0, -72.0], CR: [10.0, -84.0], CU: [21.5, -80.0], CY: [35.0, 33.0],
  CZ: [49.75, 15.5], DE: [51.0, 9.0], DJ: [11.5, 43.0], DK: [56.0, 10.0],
  DO: [19.0, -70.0], DZ: [28.0, 3.0], EC: [-2.0, -77.5], EE: [59.0, 26.0],
  EG: [27.0, 30.0], ER: [15.0, 39.0], ES: [40.0, -4.0], ET: [8.0, 38.0],
  FI: [64.0, 26.0], FJ: [-18.0, 175.0], FR: [46.0, 2.0], GA: [-1.0, 11.75],
  GB: [54.0, -2.0], GD: [12.0, -61.75], GE: [42.0, 43.5], GH: [8.0, -2.0],
  GM: [13.5, -16.0], GN: [11.0, -10.0], GQ: [1.5, 10.0], GR: [39.0, 22.0],
  GT: [15.5, -90.25], GY: [5.0, -59.0], HK: [22.3, 114.2], HN: [15.0, -86.5],
  HR: [45.1, 15.5], HT: [19.0, -72.4], HU: [47.0, 20.0], ID: [-2.0, 118.0],
  IE: [53.0, -8.0], IL: [31.5, 35.0], IN: [21.0, 78.0], IQ: [33.0, 44.0],
  IR: [32.0, 53.0], IS: [65.0, -18.0], IT: [42.5, 12.5], JM: [18.25, -77.5],
  JO: [31.0, 36.0], JP: [36.0, 138.0], KE: [1.0, 38.0], KG: [41.0, 75.0],
  KH: [12.0, 105.0], KR: [36.0, 128.0], KW: [29.0, 47.5], KZ: [48.0, 67.0],
  LA: [18.0, 105.0], LB: [33.9, 35.9], LK: [7.0, 81.0], LT: [55.0, 24.0],
  LU: [49.75, 6.0], LV: [57.0, 25.0], LY: [25.0, 17.0], MA: [32.0, -6.0],
  MD: [47.0, 29.0], ME: [42.5, 19.3], MG: [-20.0, 47.0], MK: [41.6, 21.7],
  ML: [17.0, -4.0], MM: [22.0, 98.0], MN: [46.0, 105.0], MT: [35.9, 14.4],
  MU: [-20.3, 57.5], MV: [3.2, 73.0], MW: [-13.5, 34.0], MX: [23.0, -102.0],
  MY: [4.0, 102.0], MZ: [-18.0, 35.0], NA: [-22.0, 17.0], NE: [16.0, 8.0],
  NG: [10.0, 8.0], NI: [13.0, -85.0], NL: [52.5, 5.75], NO: [62.0, 10.0],
  NP: [28.0, 84.0], NZ: [-41.0, 174.0], OM: [21.0, 57.0], PA: [9.0, -80.0],
  PE: [-10.0, -76.0], PG: [-6.0, 147.0], PH: [13.0, 122.0], PK: [30.0, 70.0],
  PL: [52.0, 20.0], PR: [18.2, -66.5], PS: [32.0, 35.25], PT: [39.5, -8.0],
  PY: [-23.0, -58.0], QA: [25.5, 51.0], RO: [46.0, 25.0], RS: [44.0, 21.0],
  RU: [60.0, 100.0], RW: [-2.0, 30.0], SA: [24.0, 45.0], SD: [15.0, 30.0],
  SE: [62.0, 15.0], SG: [1.3, 103.8], SI: [46.0, 15.0], SK: [48.7, 19.5],
  SL: [8.5, -11.5], SN: [14.0, -14.0], SO: [10.0, 49.0], SV: [13.8, -88.9],
  SY: [35.0, 38.0], SZ: [-26.5, 31.5], TD: [15.0, 19.0], TG: [8.0, 1.2],
  TH: [15.0, 100.0], TJ: [39.0, 71.0], TL: [-8.5, 125.5], TM: [40.0, 60.0],
  TN: [34.0, 9.0], TR: [39.0, 35.0], TT: [10.5, -61.5], TW: [23.5, 121.0],
  TZ: [-6.0, 35.0], UA: [49.0, 32.0], UG: [1.0, 32.0], US: [38.0, -97.0],
  UY: [-33.0, -56.0], UZ: [41.0, 64.0], VE: [8.0, -66.0], VN: [16.0, 108.0],
  YE: [15.0, 48.0], ZA: [-29.0, 24.0], ZM: [-15.0, 28.0], ZW: [-19.0, 29.0],
};

// Aggregated relay counts per country, with flags + counts for legend/labels.
interface CountryCluster {
  code: string;
  name: string;
  count: number;
  lat: number;
  lng: number;
  hasExit: boolean;
  hasGuard: boolean;
}

const clusters = computed<CountryCluster[]>(() => {
  const map = new Map<string, CountryCluster>();
  for (const r of props.relays) {
    const code = (r.country || "").toUpperCase();
    if (!code || !COUNTRY_COORDS[code]) continue;
    const [lat, lng] = COUNTRY_COORDS[code];
    const existing = map.get(code);
    const isExit = r.flags.includes("Exit");
    const isGuard = r.flags.includes("Guard");
    if (existing) {
      existing.count += 1;
      existing.hasExit ||= isExit;
      existing.hasGuard ||= isGuard;
    } else {
      map.set(code, {
        code,
        name: r.countryName || code,
        count: 1,
        lat,
        lng,
        hasExit: isExit,
        hasGuard: isGuard,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
});

function markerRadius(count: number): number {
  return Math.min(12, 3 + Math.sqrt(count) * 1.6);
}

function markerColor(c: CountryCluster): string {
  // Exit relays (most sensitive, most interesting) in accent red.
  if (c.hasExit) return "#f43f5e";
  if (c.hasGuard) return "#8b5cf6";
  return "#2090ea";
}

// A compact, recognizable equirectangular coastline path (approximate) drawn
// once; markers are overlaid on top. Keeps the component fully self-contained.
const CONTINENTS =
  "M90 175 L140 165 L150 130 L165 125 L175 95 L185 90 L195 60 L210 55 L220 65 L235 60 L245 70 L250 90 L260 95 L270 88 L280 100 L295 98 L300 108 L315 105 L325 115 L335 112 L345 122 L340 130 L350 140 L340 150 L335 160 L345 170 L340 185 L330 190 L335 205 L325 210 L315 205 L310 210 L315 220 L305 225 L295 220 L290 230 L280 235 L270 230 L265 238 L255 235 L250 242 L245 250 L235 248 L230 255 L225 250 L220 242 L210 245 L205 238 L195 240 L190 250 L180 248 L175 255 L185 268 L178 278 L170 275 L165 285 L155 290 L150 300 L140 305 L135 315 L125 318 L120 312 L110 315 L105 308 L100 312 L90 310 z M420 105 L440 98 L455 105 L465 115 L470 128 L475 140 L468 150 L472 165 L465 175 L455 172 L445 180 L435 175 L425 182 L418 175 L420 165 L415 155 L418 145 L412 138 L415 128 L410 118 z M500 90 L515 82 L530 88 L540 95 L545 108 L550 120 L545 132 L550 145 L545 155 L535 152 L528 158 L520 152 L512 158 L505 150 L510 140 L505 130 L508 118 L500 112 z M560 175 L590 168 L605 172 L615 180 L620 195 L615 210 L605 220 L595 225 L585 222 L578 228 L568 225 L562 230 L555 222 L558 212 L552 200 z M640 185 L660 178 L675 185 L682 200 L678 215 L670 225 L658 228 L648 222 L642 210 L645 198 z M700 150 L715 142 L730 148 L738 160 L735 175 L725 185 L712 182 L704 172 L706 160 z M150 200 L180 195 L200 200 L215 210 L220 225 L212 240 L200 248 L185 250 L172 245 L160 250 L150 240 L145 225 z M250 230 L275 225 L295 232 L305 245 L300 260 L290 272 L275 278 L258 275 L248 265 L245 250 z";

function countryFlag(code: string): string {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🏳️";
  const offset = 0x1f1e6;
  return String.fromCodePoint(...[...c].map((ch) => offset + ch.charCodeAt(0) - 65));
}
</script>

<template>
  <div class="tor-map">
    <svg :viewBox="`0 0 ${W} ${H}`" class="tor-map__svg" role="img"
      :aria-label="`${clusters.length} country locations`" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" :width="W" :height="H" class="tor-map__ocean" />

      <!-- graticule -->
      <g class="tor-map__graticule">
        <line v-for="lat in [0, 45, -45]" :key="`lat-${lat}`" x1="0" :y1="project(lat, 0).y" :x2="W" :y2="project(lat, 0).y" />
        <line v-for="lng in [-150, -100, -50, 0, 50, 100, 150]" :key="`lng-${lng}`" :x1="project(0, lng).x" y1="0" :x2="project(0, lng).x" :y2="H" />
      </g>

      <path :d="CONTINENTS" class="tor-map__land" />

      <g v-for="c in clusters" :key="c.code">
        <circle :cx="project(c.lat, c.lng).x" :cy="project(c.lat, c.lng).y"
          :r="markerRadius(c.count)" :fill="markerColor(c)" class="tor-map__dot"
          :opacity="0.85">
          <title>{{ c.name }} — {{ c.count }} relay{{ c.count > 1 ? 's' : '' }}</title>
        </circle>
      </g>
    </svg>

    <div v-if="clusters.length" class="tor-map__legend">
      <span class="tor-map__legend-item" v-for="c in clusters.slice(0, 12)" :key="c.code">
        <span class="tor-map__legend-dot" :style="{ background: markerColor(c) }"></span>
        <span class="tor-map__legend-flag">{{ countryFlag(c.code) }}</span>
        {{ c.name }} · {{ c.count }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.tor-map {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.tor-map__svg {
  width: 100%;
  height: auto;
  border-radius: 10px;
  overflow: hidden;
  background: #0e1219;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.tor-map__ocean {
  fill: #0e1219;
}
.tor-map__land {
  fill: #1d2733;
  stroke: rgba(255, 255, 255, 0.05);
  stroke-width: 0.5;
}
.tor-map__graticule line {
  stroke: rgba(255, 255, 255, 0.03);
  stroke-width: 0.5;
}
.tor-map__dot {
  stroke: rgba(0, 0, 0, 0.4);
  stroke-width: 0.7;
  transition: opacity 120ms ease;
}
.tor-map__dot:hover {
  opacity: 1;
}
.tor-map__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.tor-map__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted, #8a8a90);
}
.tor-map__legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tor-map__legend-flag {
  font-size: 13px;
}
</style>
