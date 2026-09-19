import * as THREE from "three/webgpu";
import { float, length as tslLength, mix as tslMix, positionLocal, smoothstep as tslSmoothstep, texture as tslTexture, uniform, uv, vec2 } from "three/tsl";

const GROUND_RESOLUTION_AT_ZOOM_0 = 156543.03392;

const METRES_PER_DEG_LAT = 111_320;

function decodeDemHeight(r: number, g: number, b: number): number {
  return -10000 + 0.1 * (r * 65536 + g * 256 + b);
}

const DEM_TILESET = "mapbox.mapbox-terrain-dem-v1";
const DEM_MAX_ZOOM = 14;
const SATELLITE_TILESET = "mapbox.satellite";
const SATELLITE_MAX_ZOOM = 22;

const TARGET_METRES_PER_PIXEL = 0.5;

const MAX_IMAGERY_PX = 4096;
const MIN_IMAGERY_PX = 1024;

function targetImageryPx(widthM: number): number {
  const ideal = widthM / TARGET_METRES_PER_PIXEL;
  return Math.max(MIN_IMAGERY_PX, Math.min(MAX_IMAGERY_PX, 2 ** Math.ceil(Math.log2(ideal))));
}

const DETAIL_RADIUS_M = 350;

const DETAIL_METRES_PER_PIXEL = 0.15;
const MAX_DETAIL_PX = 2048;

const DETAIL_MIN_SITE_RADIUS_M = 500;

const MAX_TERRAIN_SEGMENTS = 192;

export interface SiteTerrainRequest {
  latitude: number;
  longitude: number;
  radiusM: number;
  terrainEnabled: boolean;
  imageryEnabled: boolean;
  accessToken: string;
  signal?: AbortSignal;
}

export interface SiteTerrainResult {
  mesh: THREE.Mesh;
  brightnessUniform: { value: number } | null;
  halfExtentM: number;
  centreElevationM: number;
  reliefM: { min: number; max: number };
  dispose: () => void;
}

function lngLatToTile(lngDeg: number, latDeg: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (latDeg * Math.PI) / 180;
  return {
    x: ((lngDeg + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

function metresPerPixel(zoom: number, latDeg: number, tilePx: number): number {
  return (GROUND_RESOLUTION_AT_ZOOM_0 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom / (tilePx / 256);
}

function siteBounds(latitude: number, longitude: number, radiusM: number) {
  const dLat = radiusM / METRES_PER_DEG_LAT;
  const dLng = radiusM / (METRES_PER_DEG_LAT * Math.cos((latitude * Math.PI) / 180));
  return {
    north: latitude + dLat,
    south: latitude - dLat,
    east: longitude + dLng,
    west: longitude - dLng,
    widthM: radiusM * 2,
  };
}

async function fetchImageBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

async function buildImageryTexture(
  bounds: ReturnType<typeof siteBounds>,
  latitude: number,
  accessToken: string,
  signal?: AbortSignal,
  targetPxOverride?: number
): Promise<THREE.Texture | null> {
  const targetPx = targetPxOverride ?? targetImageryPx(bounds.widthM);
  let zoom = SATELLITE_MAX_ZOOM;
  for (let z = SATELLITE_MAX_ZOOM; z >= 10; z--) {
    if (bounds.widthM / metresPerPixel(z, latitude, 512) <= targetPx) {
      zoom = z;
      break;
    }
  }

  const topLeft = lngLatToTile(bounds.west, bounds.north, zoom);
  const bottomRight = lngLatToTile(bounds.east, bounds.south, zoom);
  const minX = Math.floor(topLeft.x);
  const maxX = Math.floor(bottomRight.x);
  const minY = Math.floor(topLeft.y);
  const maxY = Math.floor(bottomRight.y);

  const tilePx = 512;
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const canvas = document.createElement("canvas");
  canvas.width = cols * tilePx;
  canvas.height = rows * tilePx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const jobs: Promise<void>[] = [];
  let drew = 0;
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const url = `https://api.mapbox.com/v4/${SATELLITE_TILESET}/${zoom}/${tx}/${ty}@2x.jpg90?access_token=${accessToken}`;
      jobs.push(
        fetchImageBitmap(url, signal).then((bmp) => {
          if (!bmp) return;
          ctx.drawImage(bmp, (tx - minX) * tilePx, (ty - minY) * tilePx, tilePx, tilePx);
          bmp.close();
          drew += 1;
        })
      );
    }
  }
  await Promise.all(jobs);
  if (drew === 0) return null;

  const cropX = (topLeft.x - minX) * tilePx;
  const cropY = (topLeft.y - minY) * tilePx;
  const cropW = (bottomRight.x - topLeft.x) * tilePx;
  const cropH = (bottomRight.y - topLeft.y) * tilePx;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cropW));
  out.height = Math.max(1, Math.round(cropH));
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);
  canvas.width = 0;
  canvas.height = 0;

  const texture = new THREE.CanvasTexture(out);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

async function buildHeightGrid(
  bounds: ReturnType<typeof siteBounds>,
  accessToken: string,
  signal?: AbortSignal
): Promise<{ data: Float32Array; width: number; height: number } | null> {
  const zoom = DEM_MAX_ZOOM;
  const tilePx = 512;
  const topLeft = lngLatToTile(bounds.west, bounds.north, zoom);
  const bottomRight = lngLatToTile(bounds.east, bounds.south, zoom);
  const minX = Math.floor(topLeft.x);
  const maxX = Math.floor(bottomRight.x);
  const minY = Math.floor(topLeft.y);
  const maxY = Math.floor(bottomRight.y);
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  const canvas = document.createElement("canvas");
  canvas.width = cols * tilePx;
  canvas.height = rows * tilePx;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const jobs: Promise<void>[] = [];
  let drew = 0;
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const url = `https://api.mapbox.com/v4/${DEM_TILESET}/${zoom}/${tx}/${ty}@2x.pngraw?access_token=${accessToken}`;
      jobs.push(
        fetchImageBitmap(url, signal).then((bmp) => {
          if (!bmp) return;
          ctx.drawImage(bmp, (tx - minX) * tilePx, (ty - minY) * tilePx, tilePx, tilePx);
          bmp.close();
          drew += 1;
        })
      );
    }
  }
  await Promise.all(jobs);
  if (drew === 0) return null;

  const cropX = Math.round((topLeft.x - minX) * tilePx);
  const cropY = Math.round((topLeft.y - minY) * tilePx);
  const cropW = Math.max(2, Math.round((bottomRight.x - topLeft.x) * tilePx));
  const cropH = Math.max(2, Math.round((bottomRight.y - topLeft.y) * tilePx));
  const pixels = ctx.getImageData(cropX, cropY, cropW, cropH).data;
  canvas.width = 0;
  canvas.height = 0;

  const data = new Float32Array(cropW * cropH);
  for (let i = 0; i < cropW * cropH; i++) {
    const p = i * 4;
    data[i] = pixels[p + 3] === 0 ? 0 : decodeDemHeight(pixels[p], pixels[p + 1], pixels[p + 2]);
  }
  return { data, width: cropW, height: cropH };
}

function sampleHeight(grid: { data: Float32Array; width: number; height: number }, u: number, v: number): number {
  const x = Math.min(grid.width - 1, Math.max(0, u * (grid.width - 1)));
  const y = Math.min(grid.height - 1, Math.max(0, v * (grid.height - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const h00 = grid.data[y0 * grid.width + x0];
  const h10 = grid.data[y0 * grid.width + x1];
  const h01 = grid.data[y1 * grid.width + x0];
  const h11 = grid.data[y1 * grid.width + x1];
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

export async function buildSiteTerrain(req: SiteTerrainRequest): Promise<SiteTerrainResult | null> {
  const bounds = siteBounds(req.latitude, req.longitude, req.radiusM);

  const wantsDetail = req.imageryEnabled && req.radiusM > DETAIL_MIN_SITE_RADIUS_M;
  const detailBounds = wantsDetail ? siteBounds(req.latitude, req.longitude, DETAIL_RADIUS_M) : null;
  const detailPx = Math.min(
    MAX_DETAIL_PX,
    2 ** Math.ceil(Math.log2((DETAIL_RADIUS_M * 2) / DETAIL_METRES_PER_PIXEL))
  );

  const [imagery, detail, grid] = await Promise.all([
    req.imageryEnabled ? buildImageryTexture(bounds, req.latitude, req.accessToken, req.signal) : Promise.resolve(null),
    detailBounds
      ? buildImageryTexture(detailBounds, req.latitude, req.accessToken, req.signal, detailPx)
      : Promise.resolve(null),
    req.terrainEnabled ? buildHeightGrid(bounds, req.accessToken, req.signal) : Promise.resolve(null),
  ]);
  if (req.signal?.aborted) {
    imagery?.dispose();
    detail?.dispose();
    return null;
  }

  const demSamplesAcross = grid ? Math.min(grid.width, grid.height) : 2;
  const segments = grid ? Math.max(8, Math.min(MAX_TERRAIN_SEGMENTS, demSamplesAcross)) : 1;

  const geometry = new THREE.PlaneGeometry(bounds.widthM, bounds.widthM, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  let centreElevationM = 0;
  let minRelief = 0;
  let maxRelief = 0;
  if (grid) {
    centreElevationM = sampleHeight(grid, 0.5, 0.5);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const half = bounds.widthM / 2;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const u = (x + half) / bounds.widthM;
      const v = (z + half) / bounds.widthM;
      const h = sampleHeight(grid, u, v) - centreElevationM;
      position.setY(i, h);
      if (h < minRelief) minRelief = h;
      if (h > maxRelief) maxRelief = h;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  const material = new THREE.MeshStandardNodeMaterial({
    color: imagery ? 0xffffff : 0x8d8f86,
    roughness: 0.96,
    metalness: 0,
  });

  const brightnessUniform = uniform(1);

  if (imagery) {
    const wide = tslTexture(imagery, uv());

    if (detail) {
      const half = float(DETAIL_RADIUS_M);
      const detailUv = vec2(
        positionLocal.x.add(half).div(half.mul(2)),
        half.sub(positionLocal.z).div(half.mul(2))
      );
      const sharp = tslTexture(detail, detailUv);
      const d = tslLength(positionLocal.xz);
      const blend = tslSmoothstep(half.mul(0.55), half.mul(0.9), d);
      material.colorNode = tslMix(sharp, wide, blend).mul(brightnessUniform);
    } else {
      material.colorNode = wide.mul(brightnessUniform);
    }
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "rz-site-terrain";
  mesh.renderOrder = -1;

  return {
    mesh,
    brightnessUniform: imagery ? brightnessUniform : null,
    halfExtentM: bounds.widthM / 2,
    centreElevationM,
    reliefM: { min: minRelief, max: maxRelief },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      imagery?.dispose();
      detail?.dispose();
    },
  };
}

