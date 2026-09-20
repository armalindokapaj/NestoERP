import mapboxgl from "mapbox-gl";

export interface BasemapAnchor {
  latitude: number;
  longitude: number;
  headingDeg: number;
  scale: number;
}

export interface LocalCameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fovDeg: number;
  viewportHeightPx: number;
}

export interface MapboxCameraState {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

const GROUND_RESOLUTION_AT_ZOOM_0 = 156543.03392;

const MIN_ZOOM = 0;
const MAX_ZOOM = 22;
const DEFAULT_MAX_PITCH_DEG = 80;

const MIN_FOCUS_DISTANCE_M = 0.5;

function offsetLngLat(anchor: BasemapAnchor, eastM: number, northM: number): [number, number] {
  const anchorMercator = mapboxgl.MercatorCoordinate.fromLngLat(
    { lng: anchor.longitude, lat: anchor.latitude },
    0
  );
  const metersToMercator = anchorMercator.meterInMercatorCoordinateUnits();
  const mercator = new mapboxgl.MercatorCoordinate(
    anchorMercator.x + eastM * metersToMercator,
    anchorMercator.y - northM * metersToMercator,
    anchorMercator.z
  );
  const lngLat = mercator.toLngLat();
  return [lngLat.lng, lngLat.lat];
}

function rotateByHeading(localEastM: number, localNorthM: number, headingDeg: number): [number, number] {
  const rad = (headingDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const trueEast = localEastM * cos + localNorthM * sin;
  const trueNorth = -localEastM * sin + localNorthM * cos;
  return [trueEast, trueNorth];
}

export function computeMapboxCameraFromLocal(
  local: LocalCameraState,
  anchor: BasemapAnchor,
  opts?: { maxPitchDeg?: number }
): MapboxCameraState {
  const maxPitchDeg = opts?.maxPitchDeg ?? DEFAULT_MAX_PITCH_DEG;

  const dx = (local.target.x - local.position.x) * anchor.scale;
  const dy = (local.target.y - local.position.y) * anchor.scale;
  const dz = (local.target.z - local.position.z) * anchor.scale;
  const horizontalDist = Math.hypot(dx, dz);
  const focusDist = Math.max(MIN_FOCUS_DISTANCE_M, Math.hypot(dx, dy, dz));

  const [localEast, localNorth] = [local.target.x * anchor.scale, -local.target.z * anchor.scale];
  const [trueEast, trueNorth] = rotateByHeading(localEast, localNorth, anchor.headingDeg);
  const center = offsetLngLat(anchor, trueEast, trueNorth);

  const localBearingDeg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const bearing = normalizeBearing(localBearingDeg + anchor.headingDeg);

  const lookDownDeg = (Math.atan2(-dy, horizontalDist) * 180) / Math.PI;
  const pitch = clamp(90 - lookDownDeg, 0, maxPitchDeg);

  const fovRad = (local.fovDeg * Math.PI) / 180;
  const visibleWorldHeightM = 2 * focusDist * Math.tan(fovRad / 2);
  const metersPerPixel = visibleWorldHeightM / Math.max(1, local.viewportHeightPx);
  const latRad = (center[1] * Math.PI) / 180;
  const zoomRaw = Math.log2((GROUND_RESOLUTION_AT_ZOOM_0 * Math.cos(latRad)) / Math.max(1e-6, metersPerPixel));
  const zoom = clamp(zoomRaw, MIN_ZOOM, MAX_ZOOM);

  return { center, zoom, pitch, bearing };
}

function normalizeBearing(deg: number): number {
  let b = deg % 360;
  if (b > 180) b -= 360;
  if (b < -180) b += 360;
  return b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

