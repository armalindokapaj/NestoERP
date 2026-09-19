import mapboxgl from "mapbox-gl";
import * as THREE from "three/webgpu";

export interface StudioBasemapLayerCallbacks {
  onRendererReady: (renderer: THREE.WebGPURenderer) => void;
  onRendererFailed: (error: unknown) => void;
  onFrame: () => void;
}

export class StudioBasemapLayer implements mapboxgl.CustomLayerInterface {
  id = "studio-basemap-layer";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private callbacks: StudioBasemapLayerCallbacks;
  private renderer: THREE.WebGPURenderer | null = null;

  constructor(callbacks: StudioBasemapLayerCallbacks) {
    this.callbacks = callbacks;
  }

  onAdd(map: mapboxgl.Map, gl: WebGL2RenderingContext) {
    const renderer = new THREE.WebGPURenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: false,
      forceWebGL: true,
    });
    renderer
      .init()
      .then(() => {
        this.renderer = renderer;
        this.callbacks.onRendererReady(renderer);
      })
      .catch((err: unknown) => this.callbacks.onRendererFailed(err));
  }

  onRemove() {
    this.renderer = null;
  }

  render() {
    if (!this.renderer) return;
    this.callbacks.onFrame();
  }
}

