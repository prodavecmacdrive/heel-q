/* ═══════════════════════════════════════════════════════════════════════
   ViewportManager — Three.js scene, camera, renderer, orbit controls
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class ViewportManager {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly orthoCamera: THREE.OrthographicCamera;
  public activeCamera: THREE.Camera;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly controls: OrbitControls;

  private container: HTMLElement;
  private animationId: number = 0;
  private onRenderCallbacks: Array<() => void> = [];
  private onPostRenderCallbacks: Array<() => void> = [];
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.container = container;

    // ── Scene ──
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0e12');
    this.scene.fog = new THREE.FogExp2('#0a0e12', 0.015);

    const aspect = container.clientWidth / container.clientHeight;

    // ── Cameras ──
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
    this.camera.position.set(-8, 10, 12);
    this.camera.lookAt(0, 0, 0);

    const viewSize = 20;
    this.orthoCamera = new THREE.OrthographicCamera(
      -viewSize * aspect, viewSize * aspect, viewSize, -viewSize, 0.1, 500
    );
    this.orthoCamera.position.set(0, 50, 0);
    this.orthoCamera.lookAt(0, 0, 0);
    this.activeCamera = this.camera;

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ── Lights ──
    this.scene.add(new THREE.AmbientLight('#6688aa', 0.5));
    const dirLight = new THREE.DirectionalLight('#ffffff', 1.0);
    dirLight.position.set(10, 15, 8);
    dirLight.castShadow = true;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 60;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    this.scene.add(dirLight);

    // ── Controls ──
    this.controls = new OrbitControls(this.activeCamera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.target.set(0, 0, 0);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  public setOrthographicMode(isOrtho: boolean) {
    if (isOrtho) {
      this.activeCamera = this.orthoCamera;
      this.controls.object = this.orthoCamera;
      this.controls.enableRotate = false; // keep it top-down
      this.controls.target.set(0, 0, 0);
      this.orthoCamera.position.set(0, 50, 0);
      this.scene.fog = null; // No fog in world map
    } else {
      this.activeCamera = this.camera;
      this.controls.object = this.camera;
      this.controls.enableRotate = true;
      this.scene.fog = new THREE.FogExp2('#0a0e12', 0.015);
    }
  }

  public onRender(cb: () => void) { this.onRenderCallbacks.push(cb); }
  public onPostRender(cb: () => void) { this.onPostRenderCallbacks.push(cb); }

  public start() {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);
      this.controls.update();
      for (const cb of this.onRenderCallbacks) cb();
      this.renderer.render(this.scene, this.activeCamera);
      for (const cb of this.onPostRenderCallbacks) cb();
    };

    loop();
  }

  public stop(){ cancelAnimationFrame(this.animationId); }

  public screenToFloor(clientX: number, clientY: number): THREE.Vector3 | null {
    const ndc = this.getNDC(clientX, clientY);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.activeCamera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, target);
    return hit;
  }

  public getNDC(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.container.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private handleResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const aspect = w / h;
    
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const viewSize = 20;
    this.orthoCamera.left = -viewSize * aspect;
    this.orthoCamera.right = viewSize * aspect;
    this.orthoCamera.top = viewSize;
    this.orthoCamera.bottom = -viewSize;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
  }

  public dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
