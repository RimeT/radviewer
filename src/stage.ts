import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { planesFromAxes, screenToVoxel, voxelToScreen } from './planes.ts';
import { classColor } from './palette.ts';
import { blitFragment, blitVertex, volumeFragment, volumeVertex } from './shaders.ts';
import { renderSlice, sampleValue } from './slice.ts';
import type { Axis, ClassMesh, PlaneMap, PreparedStudy } from './types.ts';

export type ViewId = 'axial' | 'sagittal' | 'coronal' | 'volume';

export interface CellRect {
  id: ViewId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewState {
  cursor: [number, number, number];
  center: number;
  width: number;
}

interface MprView {
  id: 'axial' | 'sagittal' | 'coronal';
  plane: PlaneMap;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
  texture: THREE.DataTexture;
  pixels: Uint8ClampedArray;
  horizontal: THREE.Line;
  vertical: THREE.Line;
  zoom: number;
  panX: number;
  panY: number;
  dirty: boolean;
}

const VOLUME_CLEAR = 0x071018;

function line(): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({
    color: 0x7ee0ff,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  }));
}

function setLine(target: THREE.Line, ax: number, ay: number, bx: number, by: number): void {
  const positions = target.geometry.getAttribute('position') as THREE.BufferAttribute;
  positions.setXYZ(0, ax, ay, 0.2);
  positions.setXYZ(1, bx, by, 0.2);
  positions.needsUpdate = true;
}

/**
 * One WebGL2 context for three orthogonal slices and a raymarched volume.
 * Slice textures stay full resolution; the volume pass renders at half resolution.
 */
export class MedStage {
  readonly renderer: THREE.WebGLRenderer;
  private readonly mprs: MprView[] = [];
  private readonly volumeScene = new THREE.Scene();
  private readonly meshScene = new THREE.Scene();
  private readonly blitScene = new THREE.Scene();
  private readonly camera3 = new THREE.PerspectiveCamera(38, 1, 0.1, 10);
  private readonly volumeTarget: THREE.WebGLRenderTarget;
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly volumeMaterial: THREE.ShaderMaterial;
  private readonly volumeMesh: THREE.Mesh;
  private readonly marker: THREE.Group;
  private controls: OrbitControls | null = null;
  private study: PreparedStudy | null = null;
  private cells = new Map<ViewId, CellRect>();
  private cursor: [number, number, number] = [0, 0, 0];
  private center = 0;
  private width = 1;
  private opacity = 0.45;
  private hidden = new Set<number>();
  private roi = new Map<number, THREE.Mesh>();
  private frame = 0;
  private intro = 0;
  private disposed = false;
  private radius = 4;
  onChange: ((state: ViewState) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.autoClear = false;
    this.volumeTarget = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.volumeMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: volumeVertex,
      fragmentShader: volumeFragment,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uVolume: { value: null },
        uCamLocal: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector3(1, 1, 1) },
        uTexel: { value: new THREE.Vector3(1, 1, 1) },
        uCenter: { value: 0 },
        uWidth: { value: 1 },
      },
    });
    this.volumeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.volumeMaterial);
    this.volumeScene.add(this.volumeMesh);
    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: blitVertex,
      fragmentShader: blitFragment,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uTex: { value: this.volumeTarget.texture } },
    });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial));
    this.meshScene.add(new THREE.HemisphereLight(0xd6e8ff, 0x1b120e, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(1.1, 1.5, 0.8);
    const rim = new THREE.DirectionalLight(0x7ec8ff, 0.75);
    rim.position.set(-1.3, -0.3, -1);
    this.meshScene.add(key, rim);
    this.marker = new THREE.Group();
    this.marker.add(crossLine(), crossLine(), crossLine());
    this.meshScene.add(this.marker);
  }

  bindOrbit(element: HTMLElement): void {
    if (this.controls?.domElement === element) return;
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera3, element);
    this.controls.enableDamping = false;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('change', () => this.invalidate());
    this.controls.addEventListener('start', () => {
      this.intro = 0;
    });
    this.controls.update();
  }

  setStudy(study: PreparedStudy): void {
    this.clearStudy();
    this.study = study;
    const planes = planesFromAxes(study.volume.axisLps);
    for (const plane of planes) {
      const uCount = study.volume.dims[plane.uAxis];
      const vCount = study.volume.dims[plane.vAxis];
      const pixels = new Uint8ClampedArray(uCount * vCount * 4);
      const texture = new THREE.DataTexture(pixels, uCount, vCount);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.format = THREE.RGBAFormat;
      texture.type = THREE.UnsignedByteType;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = true;
      texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      const scene = new THREE.Scene();
      const horizontal = line();
      const vertical = line();
      scene.add(mesh, horizontal, vertical);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
      camera.position.z = 10;
      this.mprs.push({
        id: plane.id,
        plane,
        scene,
        camera,
        mesh,
        texture,
        pixels,
        horizontal,
        vertical,
        zoom: 1,
        panX: 0,
        panY: 0,
        dirty: true,
      });
    }
    const size = this.extent();
    this.volumeMesh.geometry.dispose();
    this.volumeMesh.geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const texture = new THREE.Data3DTexture(study.dvr.values, study.dvr.dims[0], study.dvr.dims[1], study.dvr.dims[2]);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    this.volumeMaterial.uniforms.uVolume!.value = texture;
    this.volumeMaterial.uniforms.uSize!.value.set(size.x, size.y, size.z);
    this.volumeMaterial.uniforms.uTexel!.value.set(1 / study.dvr.dims[0], 1 / study.dvr.dims[1], 1 / study.dvr.dims[2]);
    const linear = Boolean(this.renderer.getContext().getExtension('OES_texture_float_linear'));
    texture.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
    texture.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
    for (const mesh of study.meshes) this.addRoi(mesh, size);
    const dims = study.volume.dims;
    this.cursor = [Math.floor(dims[0] / 2), Math.floor(dims[1] / 2), Math.floor(dims[2] / 2)];
    this.center = study.volume.windowCenter;
    this.width = study.volume.windowWidth;
    this.opacity = 0.45;
    this.hidden = new Set();
    this.radius = size.length() * 0.72;
    this.camera3.near = Math.max(0.05, this.radius / 200);
    this.camera3.far = this.radius * 12;
    this.placeCamera(0.95);
    this.controls?.update();
    this.intro = performance.now();
    this.publish();
    this.invalidate();
  }

  setMask(opacity: number, hidden: ReadonlySet<number>): void {
    this.opacity = opacity;
    this.hidden = new Set(hidden);
    for (const view of this.mprs) view.dirty = true;
    for (const [classId, mesh] of this.roi) mesh.visible = !this.hidden.has(classId);
    this.invalidate();
  }

  setWindow(center: number, width: number): void {
    if (Math.abs(center - this.center) < 0.05 && Math.abs(width - this.width) < 0.05) return;
    this.center = center;
    this.width = Math.max(1, width);
    for (const view of this.mprs) view.dirty = true;
    this.volumeMaterial.uniforms.uCenter!.value = this.center;
    this.volumeMaterial.uniforms.uWidth!.value = this.width;
    this.publish();
    this.invalidate();
  }

  setCells(cells: readonly CellRect[]): void {
    this.cells = new Map(cells.map((cell) => [cell.id, cell]));
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width > 0 && height > 0) this.renderer.setSize(width, height, false);
    this.invalidate();
  }

  resize(): void {
    this.setCells([...this.cells.values()]);
  }

  windowBy(dx: number, dy: number): void {
    const scale = Math.max(this.width, 40) / 280;
    this.setWindow(this.center - dy * scale, this.width + dx * scale);
  }

  pan(id: ViewId, dx: number, dy: number): void {
    const view = this.mprs.find((item) => item.id === id);
    const cell = this.cells.get(id);
    if (!view || !cell || cell.w <= 0) return;
    const frustum = this.frustum(view, cell.w, cell.h);
    const worldX = (frustum.right - frustum.left) / cell.w;
    const worldY = (frustum.top - frustum.bottom) / cell.h;
    view.panX -= dx * worldX;
    view.panY += dy * worldY;
    this.invalidate();
  }

  zoom(id: ViewId, dy: number): void {
    const view = this.mprs.find((item) => item.id === id);
    if (!view) return;
    view.zoom = Math.min(14, Math.max(0.25, view.zoom * Math.exp(-dy * 0.006)));
    this.invalidate();
  }

  jump(id: ViewId, index: number): void {
    const view = this.mprs.find((item) => item.id === id);
    const study = this.study;
    if (!view || !study) return;
    const axis = view.plane.fixedAxis;
    const next = clamp(Math.round(index), 0, study.volume.dims[axis] - 1);
    if (next === this.cursor[axis]) return;
    this.cursor[axis] = next;
    view.dirty = true;
    this.publish();
    this.invalidate();
  }

  step(id: ViewId, delta: number): void {
    const view = this.mprs.find((item) => item.id === id);
    const study = this.study;
    if (!view || !study) return;
    const axis = view.plane.fixedAxis;
    const next = clamp(this.cursor[axis] + delta, 0, study.volume.dims[axis] - 1);
    if (next === this.cursor[axis]) return;
    this.cursor[axis] = next;
    view.dirty = true;
    this.publish();
    this.invalidate();
  }

  pick(id: ViewId, localX: number, localY: number): void {
    const view = this.mprs.find((item) => item.id === id);
    const cell = this.cells.get(id);
    const study = this.study;
    if (!view || !cell || !study || cell.w <= 0 || cell.h <= 0) return;
    const metrics = this.metrics(view);
    const frustum = this.frustum(view, cell.w, cell.h);
    const worldX = frustum.left + (localX / cell.w) * (frustum.right - frustum.left);
    const worldY = frustum.top - (localY / cell.h) * (frustum.top - frustum.bottom);
    if (Math.abs(worldX) > metrics.planeW / 2 || Math.abs(worldY) > metrics.planeH / 2) return;
    const sx = Math.round((worldX + metrics.planeW / 2) / metrics.uSpacing - 0.5);
    const sy = Math.round((metrics.planeH / 2 - worldY) / metrics.vSpacing - 0.5);
    if (sx < 0 || sy < 0 || sx >= metrics.uCount || sy >= metrics.vCount) return;
    const next = screenToVoxel(view.plane, this.cursor[view.plane.fixedAxis], sx, sy, study.volume.dims);
    const previous = [...this.cursor] as [number, number, number];
    this.cursor = [
      clamp(next[0], 0, study.volume.dims[0] - 1),
      clamp(next[1], 0, study.volume.dims[1] - 1),
      clamp(next[2], 0, study.volume.dims[2] - 1),
    ];
    for (const item of this.mprs) {
      if (this.cursor[item.plane.fixedAxis] !== previous[item.plane.fixedAxis]) item.dirty = true;
    }
    this.publish();
    this.invalidate();
  }

  reset(): void {
    const study = this.study;
    if (!study) return;
    for (const view of this.mprs) {
      view.zoom = 1;
      view.panX = 0;
      view.panY = 0;
      view.dirty = true;
    }
    const dims = study.volume.dims;
    this.cursor = [Math.floor(dims[0] / 2), Math.floor(dims[1] / 2), Math.floor(dims[2] / 2)];
    this.center = study.volume.windowCenter;
    this.width = study.volume.windowWidth;
    this.placeCamera(0.7);
    this.controls?.update();
    this.publish();
    this.invalidate();
  }

  snapshot(): ViewState {
    return { cursor: [...this.cursor], center: this.center, width: this.width };
  }

  valueAtCursor(): number {
    if (!this.study) return 0;
    return sampleValue(this.study.volume, this.cursor[0], this.cursor[1], this.cursor[2]);
  }

  invalidate(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.controls?.dispose();
    this.clearStudy();
    this.volumeMesh.geometry.dispose();
    this.volumeMaterial.dispose();
    this.blitMaterial.dispose();
    this.volumeTarget.dispose();
    this.renderer.dispose();
  }

  private publish(): void {
    this.onChange?.({ cursor: [...this.cursor], center: this.center, width: this.width });
  }

  private clearStudy(): void {
    for (const view of this.mprs) {
      view.texture.dispose();
      view.mesh.geometry.dispose();
      (view.mesh.material as THREE.Material).dispose();
      view.horizontal.geometry.dispose();
      (view.horizontal.material as THREE.Material).dispose();
      view.vertical.geometry.dispose();
      (view.vertical.material as THREE.Material).dispose();
    }
    this.mprs.length = 0;
    for (const mesh of this.roi.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.meshScene.remove(mesh);
    }
    this.roi.clear();
    const previous = this.volumeMaterial.uniforms.uVolume!.value as THREE.Data3DTexture | null;
    previous?.dispose();
    this.volumeMaterial.uniforms.uVolume!.value = null;
    this.study = null;
  }

  private addRoi(mesh: ClassMesh, size: THREE.Vector3): void {
    if (mesh.positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geometry.translate(-size.x / 2, -size.y / 2, -size.z / 2);
    const [r, g, b] = classColor(mesh.classId);
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(r / 255, g / 255, b / 255),
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 0.62,
      clearcoatRoughness: 0.2,
      emissive: new THREE.Color(r / 255, g / 255, b / 255),
      emissiveIntensity: 0.22,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const object = new THREE.Mesh(geometry, material);
    this.meshScene.add(object);
    this.roi.set(mesh.classId, object);
  }

  private extent(): THREE.Vector3 {
    const study = this.study!;
    return new THREE.Vector3(
      study.volume.dims[0] * study.volume.spacing[0],
      study.volume.dims[1] * study.volume.spacing[1],
      study.volume.dims[2] * study.volume.spacing[2],
    );
  }

  private metrics(view: MprView): { uCount: number; vCount: number; uSpacing: number; vSpacing: number; planeW: number; planeH: number } {
    const study = this.study!;
    const uCount = study.volume.dims[view.plane.uAxis];
    const vCount = study.volume.dims[view.plane.vAxis];
    const uSpacing = study.volume.spacing[view.plane.uAxis];
    const vSpacing = study.volume.spacing[view.plane.vAxis];
    return { uCount, vCount, uSpacing, vSpacing, planeW: uCount * uSpacing, planeH: vCount * vSpacing };
  }

  private frustum(view: MprView, cellW: number, cellH: number): { left: number; right: number; top: number; bottom: number } {
    const { planeW, planeH } = this.metrics(view);
    const aspect = cellW / Math.max(1, cellH);
    let viewW = planeW;
    let viewH = planeW / aspect;
    if (viewH < planeH) {
      viewH = planeH;
      viewW = planeH * aspect;
    }
    viewW /= view.zoom;
    viewH /= view.zoom;
    return {
      left: -viewW / 2 + view.panX,
      right: viewW / 2 + view.panX,
      top: viewH / 2 + view.panY,
      bottom: -viewH / 2 + view.panY,
    };
  }

  private paint(view: MprView): void {
    const study = this.study;
    if (!study) return;
    const fixed = clamp(this.cursor[view.plane.fixedAxis], 0, study.volume.dims[view.plane.fixedAxis] - 1);
    renderSlice(study.volume, study.labels?.data ?? null, view.plane, fixed, {
      center: this.center,
      width: this.width,
      opacity: this.opacity,
      hidden: this.hidden,
    }, view.pixels);
    view.texture.needsUpdate = true;
    view.dirty = false;
  }

  private placeCamera(theta: number): void {
    const phi = 1.08;
    this.camera3.position.set(
      Math.sin(phi) * Math.sin(theta) * this.radius,
      Math.cos(phi) * this.radius * 0.42,
      Math.sin(phi) * Math.cos(theta) * this.radius,
    );
    this.camera3.lookAt(0, 0, 0);
  }

  private draw(): void {
    if (this.disposed || !this.study) return;
    if (this.intro) {
      const t = Math.min(1, (performance.now() - this.intro) / 1100);
      const ease = 1 - (1 - t) ** 3;
      this.placeCamera(0.95 - ease * 0.48);
      this.controls?.update();
      if (t >= 1) this.intro = 0;
      else this.invalidate();
    }
    const canvas = this.renderer.domElement;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 2 || cssH < 2) return;
    this.syncSize();
    this.renderer.setRenderTarget(null);
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(0, 0, cssW, cssH);
    this.renderer.setScissor(0, 0, cssW, cssH);
    this.renderer.setClearColor(this.background(), 1);
    this.renderer.clear(true, true, true);
    this.volumeMaterial.uniforms.uCenter!.value = this.center;
    this.volumeMaterial.uniforms.uWidth!.value = this.width;

    for (const view of this.mprs) {
      const cell = this.cells.get(view.id);
      if (!cell || cell.w < 2 || cell.h < 2) continue;
      if (view.dirty) this.paint(view);
      const metrics = this.metrics(view);
      view.mesh.scale.set(metrics.planeW, metrics.planeH, 1);
      const screen = voxelToScreen(view.plane, this.cursor, this.study.volume.dims);
      const x = (screen.sx + 0.5) * metrics.uSpacing - metrics.planeW / 2;
      const y = metrics.planeH / 2 - (screen.sy + 0.5) * metrics.vSpacing;
      setLine(view.horizontal, -metrics.planeW / 2, y, metrics.planeW / 2, y);
      setLine(view.vertical, x, -metrics.planeH / 2, x, metrics.planeH / 2);
      const frustum = this.frustum(view, cell.w, cell.h);
      view.camera.left = frustum.left;
      view.camera.right = frustum.right;
      view.camera.top = frustum.top;
      view.camera.bottom = frustum.bottom;
      view.camera.updateProjectionMatrix();
      this.viewport(cell);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear(true, true, false);
      this.renderer.render(view.scene, view.camera);
    }

    const volumeCell = this.cells.get('volume');
    if (volumeCell && volumeCell.w > 2 && volumeCell.h > 2) {
      this.camera3.aspect = volumeCell.w / volumeCell.h;
      this.camera3.updateProjectionMatrix();
      this.viewport(volumeCell);
      const dpr = this.renderer.getPixelRatio();
      const halfW = Math.max(2, Math.floor(volumeCell.w * dpr / 2));
      const halfH = Math.max(2, Math.floor(volumeCell.h * dpr / 2));
      if (this.volumeTarget.width !== halfW || this.volumeTarget.height !== halfH) this.volumeTarget.setSize(halfW, halfH);
      this.volumeMaterial.uniforms.uCamLocal!.value.copy(this.camera3.position);
      this.renderer.setRenderTarget(this.volumeTarget);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, halfW / dpr, halfH / dpr);
      this.renderer.setClearColor(VOLUME_CLEAR, 1);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.volumeScene, this.camera3);
      this.renderer.setRenderTarget(null);
      this.renderer.setScissorTest(true);
      this.viewport(volumeCell);
      this.renderer.clear(false, true, false);
      this.renderer.render(this.blitScene, this.camera3);
      this.placeMarker();
      this.renderer.render(this.meshScene, this.camera3);
    }
  }

  private placeMarker(): void {
    const study = this.study;
    if (!study) return;
    const size = this.extent();
    const spacing = study.volume.spacing;
    const point = new THREE.Vector3(
      (this.cursor[0] + 0.5) * spacing[0] - size.x / 2,
      (this.cursor[1] + 0.5) * spacing[1] - size.y / 2,
      (this.cursor[2] + 0.5) * spacing[2] - size.z / 2,
    );
    const arm = Math.max(spacing[0], spacing[1], spacing[2]) * 4;
    const lines = this.marker.children as THREE.Line[];
    putCross(lines[0]!, point, arm, 0);
    putCross(lines[1]!, point, arm, 1);
    putCross(lines[2]!, point, arm, 2);
  }

  /** CSS pixels. WebGLRenderer multiplies by its pixel ratio when drawing to the screen. */
  private viewport(cell: CellRect): void {
    const cssH = this.renderer.domElement.clientHeight;
    const x = Math.max(0, cell.x);
    const y = Math.max(0, cssH - cell.y - cell.h);
    const w = Math.max(1, cell.w);
    const h = Math.max(1, cell.h);
    this.renderer.setViewport(x, y, w, h);
    this.renderer.setScissor(x, y, w, h);
  }

  private syncSize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 2 || height < 2) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);
    const targetW = Math.floor(width * this.renderer.getPixelRatio());
    const targetH = Math.floor(height * this.renderer.getPixelRatio());
    if (canvas.width !== targetW || canvas.height !== targetH) this.renderer.setSize(width, height, false);
  }

  private background(): THREE.Color {
    const color = getComputedStyle(this.renderer.domElement).backgroundColor;
    try {
      return new THREE.Color(color);
    } catch {
      return new THREE.Color(0x10141c);
    }
  }
}

function crossLine(): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  return new THREE.Line(geometry, new THREE.LineBasicMaterial({
    color: 0x9aefff,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  }));
}

function putCross(target: THREE.Line, point: THREE.Vector3, arm: number, axis: Axis): void {
  const positions = target.geometry.getAttribute('position') as THREE.BufferAttribute;
  const start = point.clone();
  const end = point.clone();
  start.setComponent(axis, point.getComponent(axis) - arm);
  end.setComponent(axis, point.getComponent(axis) + arm);
  positions.setXYZ(0, start.x, start.y, start.z);
  positions.setXYZ(1, end.x, end.y, end.z);
  positions.needsUpdate = true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
