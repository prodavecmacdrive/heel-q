/* ═══════════════════════════════════════════════════════════════════════
   CameraPreviewPanel — live camera preview using the main WebGL renderer
   Renders a scissored sub-viewport in the bottom-right corner of the canvas.
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import type { CameraEntity, EditorEntity } from '../types/entities';

// Preview box size in CSS pixels
const PREVIEW_W = 320;
const PREVIEW_H = 180;
const HEADER_H  = 34;
const MARGIN    = 12;

export class CameraPreviewPanel {
  private panel: HTMLElement;
  private select: HTMLSelectElement = document.createElement('select');
  private noSignalEl: HTMLElement = document.createElement('div');

  private previewCamera: THREE.PerspectiveCamera;
  private entityMap: Map<string, CameraEntity> = new Map();
  private selectedId = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
  ) {
    this.previewCamera = new THREE.PerspectiveCamera(60, PREVIEW_W / PREVIEW_H, 0.1, 500);

    this.panel = this.buildDOM();
    this.container.appendChild(this.panel);
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Rebuild the camera dropdown from the current room entity list. */
  public updateCameraList(entities: EditorEntity[]): void {
    const cameras = entities.filter(e => e.type === 'camera') as CameraEntity[];
    const prevId = this.selectedId;

    this.entityMap.clear();
    cameras.forEach(c => this.entityMap.set(c.id, c));

    this.select.innerHTML = '';

    if (cameras.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— no cameras —';
      this.select.appendChild(opt);
      this.selectedId = '';
      this.noSignalEl.style.display = 'flex';
      return;
    }

    cameras.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      this.select.appendChild(opt);
    });

    // Keep previous selection if still valid, else prefer the default camera
    const defaultCam = cameras.find(c => c.isDefault);
    if (prevId && this.entityMap.has(prevId)) {
      this.select.value = prevId;
      this.selectedId = prevId;
    } else if (defaultCam) {
      this.select.value = defaultCam.id;
      this.selectedId = defaultCam.id;
    } else {
      this.selectedId = cameras[0].id;
      this.select.value = this.selectedId;
    }

    this.noSignalEl.style.display = 'none';
    this.syncCamera();
  }

  /**
   * Called once per frame AFTER the main scene render.
   * Draws the selected camera's view into a scissored sub-region of the main canvas.
   */
  public render(): void {
    if (this.panel.style.display === 'none') return;
    if (!this.selectedId || !this.entityMap.has(this.selectedId)) return;

    // Always sync so gizmo-dragging a camera updates the preview live
    this.syncCamera();

    const canvas = this.renderer.domElement;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw <= 0 || ch <= 0) return;

    // In WebGL the Y origin is at the BOTTOM-LEFT of the canvas.
    // MARGIN positions the bottom of the preview body area from the canvas bottom.
    const x = cw - PREVIEW_W - MARGIN;
    const y = MARGIN; // from canvas bottom

    this.renderer.setViewport(x, y, PREVIEW_W, PREVIEW_H);
    this.renderer.setScissor(x, y, PREVIEW_W, PREVIEW_H);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, this.previewCamera);

    // Restore the full-canvas viewport for subsequent draws
    this.renderer.setViewport(0, 0, cw, ch);
    this.renderer.setScissor(0, 0, cw, ch);
    this.renderer.setScissorTest(false);
  }

  public show(): void { this.panel.style.display = 'block'; }
  public hide(): void { this.panel.style.display = 'none'; }
  public setVisible(v: boolean): void { v ? this.show() : this.hide(); }

  public dispose(): void { this.panel.remove(); }

  // ── Private helpers ────────────────────────────────────────────────

  private buildDOM(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'cam-preview-panel';
    panel.style.display = 'none';

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'cam-preview-header';

    const iconSvg = `<svg class="cam-preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>`;
    const label = document.createElement('span');
    label.className = 'cam-preview-label';
    label.innerHTML = iconSvg + ' Camera Preview';

    this.select = document.createElement('select');
    this.select.className = 'cam-preview-select';
    this.select.title = 'Select camera entity';
    this.select.addEventListener('change', () => {
      this.selectedId = this.select.value;
      this.syncCamera();
    });

    header.appendChild(label);
    header.appendChild(this.select);
    panel.appendChild(header);

    // ── Body (transparent — Three.js draws here) ──
    const body = document.createElement('div');
    body.className = 'cam-preview-body';

    this.noSignalEl = document.createElement('div');
    this.noSignalEl.className = 'cam-preview-nosignal';
    this.noSignalEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
        <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        <line x1="2" y1="2" x2="22" y2="22" stroke-width="1.5"/>
      </svg>
      <span>No cameras in room</span>
    `;
    body.appendChild(this.noSignalEl);
    panel.appendChild(body);

    return panel;
  }

  private syncCamera(): void {
    const entity = this.entityMap.get(this.selectedId);
    if (!entity) return;

    const t = entity.transform;
    this.previewCamera.fov    = entity.fov  > 0  ? entity.fov  : 60;
    this.previewCamera.near   = entity.near > 0  ? entity.near : 0.1;
    this.previewCamera.far    = entity.far  > 0  ? entity.far  : 500;
    this.previewCamera.aspect = PREVIEW_W / PREVIEW_H;

    this.previewCamera.position.set(t.position.x, t.position.y, t.position.z);
    this.previewCamera.rotation.set(
      THREE.MathUtils.degToRad(t.rotation.x),
      THREE.MathUtils.degToRad(t.rotation.y),
      THREE.MathUtils.degToRad(t.rotation.z),
      'YXZ',
    );
    this.previewCamera.updateProjectionMatrix();
  }

  public static get PANEL_H(): number { return PREVIEW_H + HEADER_H; }
  public static get PANEL_W(): number { return PREVIEW_W; }
  public static get PANEL_MARGIN(): number { return MARGIN; }
  public static get HEADER_H(): number { return HEADER_H; }
}
