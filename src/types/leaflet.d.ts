// Minimal ambient types for the Leaflet global loaded from a CDN in index.html.
// Avoids a full `@types/leaflet` dependency for the small surface we use.
declare global {
  interface Window {
    L: LeafletApi;
  }
}

interface LeafletMap {
  setView(center: [number, number], zoom: number): this;
  remove(): void;
  addLayer(layer: unknown): this;
  fitBounds(bounds: [[number, number], [number, number]], options?: { padding?: [number, number] }): this;
}

interface LeafletTileLayerOptions {
  attribution?: string;
  maxZoom?: number;
}

interface LeafletMarkerOptions {
  title?: string;
  alt?: string;
}

interface LeafletMarker {
  addTo(map: LeafletMap): this;
  bindTooltip(text: string, options?: unknown): this;
}

interface LeafletApi {
  map(el: HTMLElement, options?: { zoomControl?: boolean; attributionControl?: boolean }): LeafletMap;
  tileLayer(urlTemplate: string, options?: LeafletTileLayerOptions): unknown;
  marker(latlng: [number, number], options?: LeafletMarkerOptions): LeafletMarker;
  polyline(latlngs: [number, number][], options?: { color?: string; weight?: number; dashArray?: string }): unknown;
  divIcon(options: { className?: string; html?: string; iconSize?: [number, number]; iconAnchor?: [number, number] }): unknown;
}

export {};
