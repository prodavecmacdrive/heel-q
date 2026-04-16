/* ═══════════════════════════════════════════════════════════════════════
   GizmoController — TransformControls wrapper for move/rotate/scale
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { ViewportManager } from './ViewportManager';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export class GizmoController {
  public readonly transformControls: TransformControls;
  private viewport: ViewportManager;
  private onChange: ((obj: THREE.Object3D) => void) | null = null;

  constructor(viewport: ViewportManager) {
    this.viewport = viewport;

    this.transformControls = new TransformControls(
      viewport.camera,
      viewport.renderer.domElement
    );

    // Style the gizmo
    this.transformControls.setSize(0.75);

    // Disable orbit controls while dragging gizmo
    this.transformControls.addEventListener('dragging-changed', (event) => {
      viewport.controls.enabled = !event.value;
    });

    // Emit changes
    this.transformControls.addEventListener('objectChange', () => {
      const obj = this.transformControls.object;
      if (obj && this.onChange) {
        this.onChange(obj);
      }
    });

    viewport.scene.add(this.transformControls);
  }

  /** Set the callback for when a gizmo transform changes */
  public setOnChange(cb: (obj: THREE.Object3D) => void) {
    this.onChange = cb;
  }

  /** Attach gizmo to an object */
  public attach(obj: THREE.Object3D) {
    this.transformControls.attach(obj);
  }

  /** Detach gizmo */
  public detach() {
    this.transformControls.detach();
  }

  /** Switch mode: translate / rotate / scale */
  public setMode(mode: GizmoMode) {
    this.transformControls.setMode(mode);
  }

  /** Get current mode */
  public getMode(): GizmoMode {
    return this.transformControls.getMode() as GizmoMode;
  }

  /** Toggle between local and world space */
  public toggleSpace() {
    this.transformControls.setSpace(
      this.transformControls.space === 'world' ? 'local' : 'world'
    );
  }

  public dispose() {
    this.transformControls.detach();
    this.transformControls.dispose();
  }
}
