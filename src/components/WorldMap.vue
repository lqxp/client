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
let renderer: L.Renderer | null = null;
let themeObserver: MutationObserver | null = null;

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
 * Déplie un ring polygonal en coordonnées continues.
 *
 * world-atlas/topojson-client produit des rings dont certains points
 * sautent brutalement de +180° à -180° (ou l'inverse) à l'antiméridien.
 * Leaflet interprète ces sauts comme des lignes droites traversant la carte.
 *
 * La correction : propager un décalage cumulatif à chaque saut détecté,
 * de sorte que le ring devienne une courbe continue (ex: 170° → 190°
 * au lieu de 170° → -170°). Leaflet clippe ensuite proprement aux bords.
 *
 * Validé : 0 crossing restant sur tous les pays après traitement.
 */
function normalizeRing(ring: number[][]): number[][] {
  const result: number[][] = [[...ring[0]]];

  for (let i = 1; i < ring.length; i++) {
    const prev = result[i - 1];
    const curr = [...ring[i]];
    const dx = curr[0] - prev[0];

    if (dx > 180) curr[0] -= 360;
    else if (dx < -180) curr[0] += 360;

    result.push(curr);
  }

  return result;
}

function normalizeFeatureCollection(fc: any): any {
  return {
    ...fc,
    features: fc.features.map((f: any) => {
      const geom = f.geometry;
      if (!geom) return f;

      if (geom.type === "Polygon") {
        return {
          ...f,
          geometry: {
            type: "Polygon",
            coordinates: geom.coordinates.map(normalizeRing),
          },
        };
      }

      if (geom.type === "MultiPolygon") {
        return {
          ...f,
          geometry: {
            type: "MultiPolygon",
            coordinates: geom.coordinates.map((poly: number[][][]) =>
              poly.map(normalizeRing),
            ),
          },
        };
      }

      return f;
    }),
  };
}

function initMap() {
  const el = container.value;
  if (!el || map) return;

  map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 1,
    maxZoom: 6,
    worldCopyJump: false,
    maxBounds: [
      [-85, -180],
      [85, 180],
    ],
    maxBoundsViscosity: 1,
    preferCanvas: true,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  });

  worldLayer = L.layerGroup().addTo(map);
  circuitLayer = L.layerGroup().addTo(map);
  renderer = L.canvas({ padding: 0.5 });

  renderWorld();
  map.setView([20, 0], 2, { animate: false });
}

function renderWorld() {
  if (!map || !worldLayer || !renderer) return;

  const { accent, bg, surface } = themeColors();
  const el = container.value;
  if (el) el.style.background = bg;

  const layer = worldLayer;
  const canvas = renderer;
  layer.clearLayers();

  try {
    const topo = worldTopo as unknown as Topology;
    const objects = topo.objects as Record<string, any>;

    const countriesGeo = feature(topo, objects.countries);

    // Filtrer l'Antarctique + normaliser les rings à l'antiméridien
    const filtered = {
      ...countriesGeo,
      features: countriesGeo.features.filter((f: any) => f.id !== "010"),
    };
    const normalized = normalizeFeatureCollection(filtered);

    L.geoJSON(normalized as any, {
      renderer: canvas,
      style: {
        color: "transparent",
        weight: 0,
        fillColor: surface,
        fillOpacity: 0.9,
      },
    }).addTo(layer);

    // Bordures : filtrer les segments antiméridien (artefacts de mesh)
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
      renderer: canvas,
      style: {
        color: accent,
        weight: 0.7,
        opacity: 0.8,
        fill: false,
      },
    }).addTo(layer);
  } catch (error) {
    console.error("Failed to render world map:", error);
    if (el) el.style.background = surface;
  }
}

function applyTheme() {
  if (!map) return;
  renderWorld();
  updateCircuit();
}

function watchTheme() {
  if (typeof MutationObserver === "undefined") return;
  themeObserver = new MutationObserver(() => {
    applyTheme();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-accent"],
  });
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

    const marker = L.marker([point.lat, point.lng], {
      icon,
      title: point.label,
    });
    marker.addTo(circuitLayer);

    if (point.label) {
      marker.bindTooltip(point.label, { direction: "top", offset: [0, -6] });
    }
  }
}

onMounted(async () => {
  await nextTick();
  initMap();
  watchTheme();

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
  themeObserver?.disconnect();
  themeObserver = null;
  renderer = null;
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
