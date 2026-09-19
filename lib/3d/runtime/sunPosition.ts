export interface SunPosition {
  elevationDeg: number;
  azimuthDeg: number;
  isNight?: boolean;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function sunDirectionVector(pos: Pick<SunPosition, "elevationDeg" | "azimuthDeg">): { x: number; y: number; z: number } {
  const elevRad = toRad(pos.elevationDeg);
  const azRad = toRad(pos.azimuthDeg);
  return {
    x: Math.cos(elevRad) * Math.sin(azRad),
    y: Math.sin(elevRad),
    z: -Math.cos(elevRad) * Math.cos(azRad),
  };
}

export function sunColorForElevation(elevationDeg: number): number {
  const t = Math.max(0, Math.min(1, elevationDeg / 35));
  const warm = { r: 0xff, g: 0xa1, b: 0x5c };
  const white = { r: 0xff, g: 0xff, b: 0xff };
  const r = Math.round(warm.r + (white.r - warm.r) * t);
  const g = Math.round(warm.g + (white.g - warm.g) * t);
  const b = Math.round(warm.b + (white.b - warm.b) * t);
  return (r << 16) | (g << 8) | b;
}

const SUN_ARC_MAX_ELEVATION_DEG = 65;
const SUN_ARC_AZIMUTH_START_DEG = 85;
const SUN_ARC_AZIMUTH_END_DEG = 275;

export function sunPositionForHour(
  hour: number,
  minHour: number,
  maxHour: number
): { elevationDeg: number; azimuthDeg: number } {
  const clampedHour = Math.min(maxHour, Math.max(minHour, hour));
  const t = (clampedHour - minHour) / (maxHour - minHour);
  return {
    elevationDeg: SUN_ARC_MAX_ELEVATION_DEG * Math.sin(Math.PI * t),
    azimuthDeg: SUN_ARC_AZIMUTH_START_DEG + (SUN_ARC_AZIMUTH_END_DEG - SUN_ARC_AZIMUTH_START_DEG) * t,
  };
}

export interface SolarAnchor {
  id: string;
  timeHours: number;
  elevationDeg: number;
  azimuthDeg: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}

export function sunPositionForAnchors(hour: number, anchors: SolarAnchor[]): { elevationDeg: number; azimuthDeg: number } {
  if (anchors.length === 0) return { elevationDeg: 45, azimuthDeg: 180 };
  const sorted = [...anchors].sort((a, b) => a.timeHours - b.timeHours);
  if (sorted.length === 1) return { elevationDeg: sorted[0].elevationDeg, azimuthDeg: sorted[0].azimuthDeg };

  const h = ((hour % 24) + 24) % 24;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (h < first.timeHours) {
    const prevT = last.timeHours - 24;
    const t = first.timeHours === prevT ? 0 : (h - prevT) / (first.timeHours - prevT);
    return { elevationDeg: lerp(last.elevationDeg, first.elevationDeg, t), azimuthDeg: lerpAngleDeg(last.azimuthDeg, first.azimuthDeg, t) };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (h >= cur.timeHours && h <= next.timeHours) {
      const t = next.timeHours === cur.timeHours ? 0 : (h - cur.timeHours) / (next.timeHours - cur.timeHours);
      return { elevationDeg: lerp(cur.elevationDeg, next.elevationDeg, t), azimuthDeg: lerpAngleDeg(cur.azimuthDeg, next.azimuthDeg, t) };
    }
  }
  const nextT = first.timeHours + 24;
  const t = nextT === last.timeHours ? 0 : (h - last.timeHours) / (nextT - last.timeHours);
  return { elevationDeg: lerp(last.elevationDeg, first.elevationDeg, t), azimuthDeg: lerpAngleDeg(last.azimuthDeg, first.azimuthDeg, t) };
}

export function geographicSunPosition(
  date: Date,
  latDeg: number,
  lonDeg: number,
  hourUTC: number
): { elevationDeg: number; azimuthDeg: number } {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000);
  const declRad = toRad(23.45) * Math.sin(toRad((360 / 365) * (dayOfYear - 81)));

  const solarTime = hourUTC + lonDeg / 15;
  const hourAngleDeg = 15 * (solarTime - 12);
  const hourAngleRad = toRad(hourAngleDeg);
  const latRad = toRad(latDeg);

  const sinElev = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const elevRad = Math.asin(Math.max(-1, Math.min(1, sinElev)));

  const cosAz = (Math.sin(declRad) - Math.sin(elevRad) * Math.sin(latRad)) / (Math.cos(elevRad) * Math.cos(latRad) || 1e-9);
  const azRadRaw = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  const azDeg = hourAngleDeg > 0 ? 360 - (azRadRaw * 180) / Math.PI : (azRadRaw * 180) / Math.PI;

  return { elevationDeg: (elevRad * 180) / Math.PI, azimuthDeg: azDeg };
}

export interface SunTimeline {
  sunriseHour: number | null;
  sunsetHour: number | null;
  solarNoonHour: number;
  alwaysUp: boolean;
  alwaysDown: boolean;
}

const SUN_TIMELINE_SAMPLES = 24 * 12;

export function computeSunTimeline(elevationAt: (hour: number) => number): SunTimeline {
  const samples: number[] = [];
  for (let i = 0; i <= SUN_TIMELINE_SAMPLES; i++) samples.push(elevationAt((i / SUN_TIMELINE_SAMPLES) * 24));

  let peakIdx = 0;
  for (let i = 1; i <= SUN_TIMELINE_SAMPLES; i++) {
    if (samples[i] > samples[peakIdx]) peakIdx = i;
  }
  const solarNoonHour = (peakIdx / SUN_TIMELINE_SAMPLES) * 24;
  const alwaysUp = samples.every((v) => v > 0);
  const alwaysDown = samples.every((v) => v <= 0);
  if (alwaysUp || alwaysDown) {
    return { sunriseHour: null, sunsetHour: null, solarNoonHour, alwaysUp, alwaysDown };
  }

  const hourAt = (i: number) => (i / SUN_TIMELINE_SAMPLES) * 24;
  let sunriseHour: number | null = null;
  for (let i = peakIdx; i > 0; i--) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      const t = samples[i - 1] / (samples[i - 1] - samples[i]);
      sunriseHour = hourAt(i - 1) + t * (hourAt(i) - hourAt(i - 1));
      break;
    }
  }
  let sunsetHour: number | null = null;
  for (let i = peakIdx; i < SUN_TIMELINE_SAMPLES; i++) {
    if (samples[i] > 0 && samples[i + 1] <= 0) {
      const t = samples[i] / (samples[i] - samples[i + 1]);
      sunsetHour = hourAt(i) + t * (hourAt(i + 1) - hourAt(i));
      break;
    }
  }
  return { sunriseHour, sunsetHour, solarNoonHour, alwaysUp: false, alwaysDown: false };
}

export interface SunTimePreset {
  id: "morning" | "noon" | "goldenHour" | "evening";
  hour: number;
}

export function sunTimelinePresets(timeline: SunTimeline): SunTimePreset[] {
  const presets: SunTimePreset[] = [{ id: "noon", hour: timeline.solarNoonHour }];
  if (timeline.sunriseHour != null) presets.unshift({ id: "morning", hour: timeline.sunriseHour + 2 });
  if (timeline.sunsetHour != null) {
    presets.push({ id: "goldenHour", hour: timeline.sunsetHour - 0.75 });
    presets.push({ id: "evening", hour: timeline.sunsetHour + 1 / 3 });
  }
  return presets;
}

export interface SunTimeWindow {
  startHours: number;
  endHours: number;
  stepHours: number;
}

export function snapSunTimeHours(hours: number, window: SunTimeWindow): number {
  const step = Math.max(1, Math.round(window.stepHours));
  const clamped = Math.min(Math.max(hours, window.startHours), window.endHours);
  const snapped = window.startHours + Math.round((clamped - window.startHours) / step) * step;
  return Math.min(Math.max(snapped, window.startHours), window.endHours);
}

export function snapSunTimePresets(presets: SunTimePreset[], window: SunTimeWindow): SunTimePreset[] {
  const byStop = new Map<number, { preset: SunTimePreset; drift: number; order: number }>();
  presets.forEach((preset, order) => {
    const hour = snapSunTimeHours(preset.hour, window);
    const drift = Math.abs(preset.hour - hour);
    const held = byStop.get(hour);
    if (!held || drift < held.drift) byStop.set(hour, { preset: { id: preset.id, hour }, drift, order });
  });
  return [...byStop.values()].sort((a, b) => a.order - b.order).map((entry) => entry.preset);
}

