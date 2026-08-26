<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { feature, mesh } from "topojson-client";
import type { Topology } from "topojson-specification";
import worldTopo from "world-atlas/countries-110m.json";

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  role?: "guard" | "middle" | "exit";
  color?: string;
}

const props = defineProps<{
  points: MapPoint[];
  connect?: boolean;
}>();

const container = ref<HTMLElement | null>(null);

let map: L.Map | null = null;
let resizeObserver: ResizeObserver | null = null;

let worldLayer: L.LayerGroup | null = null;
let circuitLayer: L.LayerGroup | null = null;

const ROLE_COLOR: Record<string, string> = {
  guard: "#2090ea",
  middle: "#8b5cf6",
  exit: "#f43f5e",
};

function themeColors(): { accent: string; bg: string; surface: string } {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    accent: read("--accent", "#2090ea"),
    bg: read("--bg", "#1b1b1d"),
    surface: read("--surface", "#2c2c2e"),
  };
}

/**
 * Coupe un ring polygonal à l'antiméridien (±180°).
 *
 * Leaflet ne comprend pas les coordonnées sphériques : quand un polygone
 * (Russie, Fidji…) franchit ±180°, topojson-client produit un saut brutal
 * de longitude que Leaflet interprète comme une ligne droite à travers toute
 * la carte. La seule vraie correction est de couper géométriquement le ring
 * au bord ±180° en interpolant le point exact d'intersection, exactement
 * comme D3 le fait via d3.geoPath.
 */
function cutRingAtAntimeridian(ring: number[][]): number[][][] {
  const rings: number[][][] = [];
  let current: number[][] = [];

  for (let i = 0; i < ring.length; i++) {
    const curr = ring[i];
    current.push(curr);

    if (i === ring.length - 1) break;

    const next = ring[i + 1];
    const dx = next[0] - curr[0];

    if (Math.abs(dx) > 180) {
      // Interpolation au point de coupure exact sur ±180°
      const sign = dx > 0 ? -1 : 1;
      const x0 = sign * 180;
      const t = (x0 - curr[0]) / dx;
      const y0 = curr[1] + t * (next[1] - curr[1]);

      current.push([x0, y0]);
      current.push(current[0]); // fermer le ring
      rings.push(current);

      // Nouveau ring depuis le bord opposé
      current = [[-x0, y0]];
    }
  }

  if (current.length >= 3) {
    current.push(current[0]);
    rings.push(current);
  }

  return rings;
}

function splitFeaturesAtAntimeridian(fc: any): any {
  const newFeatures: any[] = [];

  for (const f of fc.features) {
    const geom = f.geometry;

    if (!geom) {
      newFeatures.push(f);
      continue;
    }

    if (geom.type === "Polygon") {
      const newRings = geom.coordinates.flatMap(cutRingAtAntimeridian);
      for (const ring of newRings) {
        newFeatures.push({
          ...f,
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      }
    } else if (geom.type === "MultiPolygon") {
      const allRings = geom.coordinates
        .flat()
        .flatMap(cutRingAtAntimeridian);
      for (const ring of allRings) {
        newFeatures.push({
          ...f,
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      }
    } else {
      newFeatures.push(f);
    }
  }

  return { ...fc, features: newFeatures };
}

function initMap() {
  const el = container.value;
  if (!el || map) return;

  const { accent, bg, surface } = themeColors();

  el.style.background = bg;

  map = L.map(el, {
    zoomControl: false,
    attributionControl: false,

    minZoom: 1,
    maxZoom: 6,

    worldCopyJump: false,
    maxBounds: [[-85, -180], [85, 180]],
    maxBoundsViscosity: 1,
    preferCanvas: true,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  });

  worldLayer = L.layerGroup().addTo(map);
  circuitLayer = L.layerGroup().addTo(map);

  const renderer = L.canvas({ padding: 0.5 });

  try {
    const topo = worldTopo as unknown as Topology;
    const objects = topo.objects as Record<string, any>;

    // On utilise countries (pas land) pour éviter l'inversion terre/océan,
    // on filtre l'Antarctique (id 010), puis on coupe à l'antiméridien.
    const countriesGeo = feature(topo, objects.countries);
    const filtered = {
      ...countriesGeo,
      features: countriesGeo.features.filter((f: any) => f.id !== "010"),
    };
    const splitCountries = splitFeaturesAtAntimeridian(filtered);

    L.geoJSON(splitCountries as any, {
      renderer,

      style: {
        color: "transparent",
        weight: 0,
        fillColor: surface,
        fillOpacity: 0.9,
      },
    }).addTo(worldLayer);

    // Pour les bordures : mesh() produit des MultiLineString.
    // On filtre simplement les segments qui sautent l'antiméridien
    // (ce sont des artefacts de couture, pas des vraies frontières).
    const borders = mesh(topo, objects.countries, (a: any, b: any) => a !== b);
    const cleanBorders = {
      ...borders,
      coordinates: (borders.coordinates as number[][][]).filter((line) =>
        line.every(
          (pt, i) => i === 0 || Math.abs(pt[0] - line[i - 1][0]) <= 180,
        ),
      ),
    };

    L.geoJSON(cleanBorders as any, {
      renderer,

      style: {
        color: accent,
        weight: 0.7,
        opacity: 0.8,
        fill: false,
      },
    }).addTo(worldLayer);
  } catch (error) {
    console.error("Failed to render world map:", error);

    el.style.background = surface;
  }

  map.setView([20, 0], 2, { animate: false });
}

function updateCircuit() {
  if (!map || !circuitLayer) return;

  circuitLayer.clearLayers();

  const points = props.points;

  if (points.length === 0) {
    map.setView([20, 0], 2, { animate: false });
    return;
  }

  const { accent } = themeColors();

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);

  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 3, { animate: false });
  } else {
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    );
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 5, animate: false });
  }

  if (props.connect && points.length > 1) {
    L.polyline(
      points.map((p) => [p.lat, p.lng] as [number, number]),
      {
        color: accent,
        weight: 1.5,
        dashArray: "4 3",
        opacity: 0.6,
      },
    ).addTo(circuitLayer);
  }

  for (const point of points) {
    const color = point.color || ROLE_COLOR[point.role || ""] || accent;

    const icon = L.divIcon({
      className: "",
      html: `
        <span
          style="
            width:12px;
            height:12px;
            border-radius:50%;
            background:${color};
            display:block;
            border:2px solid #fff;
            box-shadow:0 0 0 2px ${color}55;
          "
        ></span>
      `,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    const marker = L.marker([point.lat, point.lng], { icon, title: point.label });
    marker.addTo(circuitLayer);

    if (point.label) {
      marker.bindTooltip(point.label, { direction: "top", offset: [0, -6] });
    }
  }
}

onMounted(async () => {
  await nextTick();

  initMap();

  requestAnimationFrame(() => {
    if (!map) return;
    map.invalidateSize({ animate: false, pan: false });
    updateCircuit();
  });

  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!map) return;

      requestAnimationFrame(() => {
        map?.invalidateSize({ animate: false, pan: false });
      });
    });

    resizeObserver.observe(container.value);
  }
});

watch(
  () => [props.points, props.connect],
  () => {
    if (!map) return;

    nextTick(() => {
      requestAnimationFrame(() => {
        updateCircuit();
      });
    });
  },
  { deep: true },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;

  worldLayer = null;
  circuitLayer = null;

  if (map) {
    map.remove();
    map = null;
  }
});
</script>

<template>
  <div ref="container" class="world-map"></div>
</template>

<style scoped>
.world-map {
  width: 100%;
  height: 260px;

  border-radius: 10px;
  overflow: hidden;

  background: var(--bg, #1b1b1d);
  border: 1px solid var(--line, rgba(255, 255, 255, 0.04));

  contain: layout paint;
}
</style>
