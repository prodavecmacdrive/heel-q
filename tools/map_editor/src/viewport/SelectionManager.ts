/* ═══════════════════════════════════════════════════════════════════════
   SelectionManager — raycaster picking + selection state
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import type { ViewportManager } from './ViewportManager';

export type SelectionCallback = (entityId: string | null) => void;

export class SelectionManager {
  private viewport: ViewportManager;
  private raycaster = new THREE.Raycaster();
  private listeners: SelectionCallback[] = [];

  /** The currently selected Three.js object (has userData.entityId) */
  public selectedObject: THREE.Object3D | null = null;

  /** When false, pointer clicks are ignored (e.g. in world/height map modes) */
  public enabled = true;

  /** Oriented wireframe highlight — lives as a child of the selected object so
   *  it automatically inherits position, rotation, and scale (true OBB display). */
  private highlight: THREE.LineSegments | null = null;

  /** Hover highlight — shown when the entity is moused over in the outliner */
  private hoverHighlight: THREE.LineSegments | null = null;

  constructor(viewport: ViewportManager) {
    this.viewport = viewport;
  }

  /** Register click handler on the canvas */
  public attach(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  /** Add a listener for selection changes */
  public onSelectionChange(cb: SelectionCallback) {
    this.listeners.push(cb);
  }

  /** Programmatically select an entity by its Three.js object */
  public select(obj: THREE.Object3D | null) {
    // Remove old highlight from whichever parent it lived in
    if (this.highlight) {
      if (this.highlight.parent) this.highlight.parent.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }

    this.selectedObject = obj;

    if (obj) {
      // Add oriented highlight as a child so it inherits the object's full transform.
      // This means doors (and any rotated entity) show an OBB, not a world AABB.
      this.highlight = this.buildOrientedHighlight(obj);
      obj.add(this.highlight);
    }

    const entityId = obj?.userData?.entityId ?? null;
    for (const cb of this.listeners) cb(entityId);
  }

  /** Deselect everything */
  public deselect() {
    this.select(null);
  }

  /** No-op: the oriented highlight is a child of the selected object and
   *  automatically tracks its parent transform each frame. */
  public update() {}

  /**
   * Build a wireframe box matched to obj's LOCAL bounding box.
   * The returned LineSegments is added as a child of obj so it inherits
   * all transforms including rotation, giving a true oriented bounding box.
   */
  /** Highlight an entity by id when hovered in the scene outliner */
  public setHover(entityId: string | null): void {
    if (this.hoverHighlight) {
      if (this.hoverHighlight.parent) this.hoverHighlight.parent.remove(this.hoverHighlight);
      this.hoverHighlight.geometry.dispose();
      (this.hoverHighlight.material as THREE.Material).dispose();
      this.hoverHighlight = null;
    }
    if (!entityId) return;

    let target: THREE.Object3D | null = null;
    this.viewport.scene.traverse(child => {
      if (!target && child.userData?.entityId === entityId && !child.userData.__selectionHighlight)
        target = child;
    });
    if (!target || target === this.selectedObject) return;

    this.hoverHighlight = this.buildOrientedHighlight(target as THREE.Object3D, 0x88ccff);
    (this.hoverHighlight.material as THREE.LineBasicMaterial).opacity = 0.55;
    (this.hoverHighlight.material as THREE.LineBasicMaterial).transparent = true;
    (target as THREE.Object3D).add(this.hoverHighlight);
  }

  private buildOrientedHighlight(obj: THREE.Object3D, color: number = 0x58a6ff): THREE.LineSegments {
    // Force all world matrices current before we compute bounds
    obj.updateWorldMatrix(true, true);

    // Inverse of obj's world matrix — projects world-space points into obj's local space
    const worldToLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();

    const box = new THREE.Box3();
    obj.traverse(child => {
      // Skip existing highlight meshes to avoid feedback loops
      if (child.userData.__selectionHighlight) return;
      if (child instanceof THREE.Mesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const geoBBox = child.geometry.boundingBox;
        if (!geoBBox || geoBBox.isEmpty()) return;
        // Transform: geometry-local → world → obj-local
        const m = new THREE.Matrix4().multiplyMatrices(worldToLocal, child.matrixWorld);
        box.union(geoBBox.clone().applyMatrix4(m));
      }
    });

    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    }

    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    // Small outward padding so the highlight sits just outside the geometry
    const pad = 0.05;

    const geo  = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size.x + pad, size.y + pad, size.z + pad)
    );
    const mat  = new THREE.LineBasicMaterial({ color });
    const lines = new THREE.LineSegments(geo, mat);
    lines.position.copy(center);
    lines.userData.__selectionHighlight = true;
    // Override raycast so this helper is never accidentally picked by the raycaster
    lines.raycast = () => {};
    return lines;
  }

  /** Find a selectable object under the pointer */
  private onPointerDown(e: PointerEvent) {
    // Only left-click, only when not dragging gizmo
    if (e.button !== 0) return;
    if (!this.enabled) return;

    const ndc = this.viewport.getNDC(e.clientX, e.clientY);
    this.raycaster.setFromCamera(ndc, this.viewport.camera);

    // Collect selectable objects (those with userData.entityId)
    const selectables: THREE.Object3D[] = [];
    this.viewport.scene.traverse((child) => {
      if (child.userData?.entityId && child.visible) {
        selectables.push(child);
      }
    });

    const intersects = this.raycaster.intersectObjects(selectables, true);
    if (intersects.length > 0) {
      // Walk up to find the entity root (the one with userData.entityId)
      let hit = intersects[0].object;
      while (hit && !hit.userData?.entityId && hit.parent) {
        hit = hit.parent;
      }
      if (hit?.userData?.entityId) {
        this.select(hit);
        return;
      }
    }

    // Clicked empty space → deselect
    this.deselect();
  }
}
