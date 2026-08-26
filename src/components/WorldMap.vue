<script setup lang="ts">
// A real world map rendered from embedded country boundaries (world-atlas
// TopoJSON → GeoJSON), so no network tiles are ever requested — the entire map
// is bundled. Shows the live Tor circuit (guard → middle → exit) as markers
// connected by a line.
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
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
  /** Draw a line connecting the points in order (for the circuit path). */
  connect?: boolean;
}>();

const container = ref<HTMLElement | null>(null);
let map: L.Map | null = null;

const ROLE_COLOR: Record<string, string> = {
  guard: "#2090ea",
  middle: "#8b5cf6",
  exit: "#f43f5e",
};

function render() {
  const el = container.value;
  if (!el) return;

  if (map) {
    map.remove();
    map = null;
  }

  map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 1,
    maxZoom: 6,
    worldCopyJump: true,
  });

  // Embedded country borders (no network).
  try {
    const geo = feature(
      worldTopo as unknown as Topology,
      (worldTopo as unknown as Topology).objects.countries as GeometryCollection,
    );
    L.geoJSON(geo as any, {
      style: {
        color: "#b7c0cc",
        weight: 0.6,
        fillColor: "#d9dfe6",
        fillOpacity: 0.6,
      },
    }).addTo(map);
  } catch {
    // Fall back to a plain gray background if the geometry fails to load.
    el.style.background = "#d9dfe6";
  }

  const lats = props.points.map((p) => p.lat);
  const lngs = props.points.map((p) => p.lng);

  if (props.points.length === 1) {
    map.setView([props.points[0].lat, props.points[0].lng], 3);
  } else if (props.points.length > 1) {
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40], maxZoom: 5 },
    );
  } else {
    map.setView([20, 0], 2);
    return;
  }

  for (const p of props.points) {
    const color = p.color || ROLE_COLOR[p.role || ""] || "#2090ea";
    const icon = L.divIcon({
      className: "",
      html: `<span style="width:12px;height:12px;border-radius:50%;background:${color};display:block;border:2px solid #fff;box-shadow:0 0 0 2px ${color}55;"></span>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    const marker = L.marker([p.lat, p.lng], { icon, title: p.label });
    marker.addTo(map);
    if (p.label) marker.bindTooltip(p.label, { direction: "top", offset: [0, -6] });
  }

  if (props.connect && props.points.length > 1) {
    L.polyline(
      props.points.map((p) => [p.lat, p.lng] as [number, number]),
      { color: "#607080", weight: 1.5, dashArray: "4 3" },
    ).addTo(map);
  }
}

onMounted(() => render());
watch(() => props.points, () => render(), { deep: true });
onBeforeUnmount(() => {
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
  background: #d9dfe6;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
</style>
