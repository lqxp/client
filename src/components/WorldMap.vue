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

function themeColors(): {
  accent: string;
  bg: string;
  surface: string;
} {
  const style = getComputedStyle(document.documentElement);

  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };

  return {
    accent: read("--accent", "#2090ea"),
    bg: read("--bg", "#1b1b1d"),
    surface: read("--surface", "#2c2c2e"),
  };
}

/**
 * Initialise Leaflet ONCE.
 *
 * Important:
 * - Canvas renderer avoids the SVG transform artifacts.
 * - We don't destroy/recreate the map when the circuit changes.
 */
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

    maxBounds: [
      [-85, -180],
      [85, 180],
    ],

    maxBoundsViscosity: 1,

    // Important: use Canvas globally.
    preferCanvas: true,

    // Avoid Leaflet transition/compositing artifacts.
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  });

  worldLayer = L.layerGroup().addTo(map);
  circuitLayer = L.layerGroup().addTo(map);

  const renderer = L.canvas({
    padding: 0.5,
  });

  try {
    const topo = worldTopo as unknown as Topology;
    const objects = topo.objects as Record<string, any>;

    /**
     * Country fill.
     * On utilise objects.countries (et non objects.land) pour éviter
     * les artefacts de polygone inversé / ruban autour de l'antiméridien
     * et du tropique du Capricorne.
     */
    const countriesGeo = feature(topo, objects.countries);
    const filteredCountries = {
      ...countriesGeo,
      features: countriesGeo.features.filter((f: any) => f.id !== "010"),
    };

    L.geoJSON(filteredCountries as any, {
      renderer,

      style: {
        color: "transparent",
        weight: 0,
        fillColor: surface,
        fillOpacity: 0.9,
      },
    }).addTo(worldLayer);

    /**
     * Country borders.
     *
     * mesh() is kept here because it produces clean internal borders
     * without the problematic polygon seams from feature(countries).
     */
    const borders = mesh(topo, objects.countries, (a: any, b: any) => a !== b);

    L.geoJSON(borders as any, {
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

  map.setView([20, 0], 2, {
    animate: false,
  });
}

/**
 * Update only the circuit.
 *
 * The actual Leaflet map and world geometry stay alive.
 */
function updateCircuit() {
  if (!map || !circuitLayer) return;

  circuitLayer.clearLayers();

  const points = props.points;

  if (points.length === 0) {
    map.setView([20, 0], 2, {
      animate: false,
    });

    return;
  }

  const { accent } = themeColors();

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);

  /**
   * Fit the map to the circuit.
   *
   * Do this AFTER Leaflet knows the container dimensions.
   */
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 3, {
      animate: false,
    });
  } else {
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    );

    map.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 5,
      animate: false,
    });
  }

  /**
   * Circuit line.
   */
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

  /**
   * Circuit markers.
   */
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
      marker.bindTooltip(point.label, {
        direction: "top",
        offset: [0, -6],
      });
    }
  }
}

onMounted(async () => {
  await nextTick();

  initMap();

  /**
   * Leaflet must receive the real container size before fitting bounds.
   */
  requestAnimationFrame(() => {
    if (!map) return;

    map.invalidateSize({
      animate: false,
      pan: false,
    });

    updateCircuit();
  });

  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      if (!map) return;

      requestAnimationFrame(() => {
        map?.invalidateSize({
          animate: false,
          pan: false,
        });
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
  {
    deep: true,
  },
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

  /*
   * Prevent browsers from trying to do weird subpixel compositing
   * on the Leaflet pane.
   */
  contain: layout paint;
}
</style>
