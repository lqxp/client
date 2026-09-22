/**
 * The shape WorldMap plots.
 *
 * It lives beside the component rather than inside it so a caller can name a
 * point without importing the map: a type that can only be reached through an
 * SFC is a type half the toolchain cannot resolve.
 */
export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  role?: "guard" | "middle" | "exit";
  color?: string;
}
