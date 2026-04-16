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

  /** The outline / highlight helper */
  private highlightBox: THREE.BoxHelper | null = null;

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
    // Remove old highlight
    if (this.highlightBox) {
      this.viewport.scene.remove(this.highlightBox);
      this.highlightBox.dispose();
      this.highlightBox = null;
    }

    this.selectedObject = obj;

    if (obj) {
      // Add highlight box
      this.highlightBox = new THREE.BoxHelper(obj, 0x58a6ff);
      this.highlightBox.name = '__selection_highlight';
      this.viewport.scene.add(this.highlightBox);
    }

    const entityId = obj?.userData?.entityId ?? null;
    for (const cb of this.listeners) cb(entityId);
  }

  /** Deselect everything */
  public deselect() {
    this.select(null);
  }

  /** Update the highlight box geometry (call in render loop) */
  public update() {
    if (this.highlightBox && this.selectedObject) {
      this.highlightBox.update();
    }
  }

  /** Find a selectable object under the pointer */
  private onPointerDown(e: PointerEvent) {
    // Only left-click, only when not dragging gizmo
    if (e.button !== 0) return;

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
