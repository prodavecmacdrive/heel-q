/* ═══════════════════════════════════════════════════════════════════════
  CameraPreviewPanel — dev-only live camera preview using the running engine
  Embeds the engine app in an iframe and syncs room/camera state via postMessage.
  ═══════════════════════════════════════════════════════════════════════ */

import type { CameraEntity, EditorEntity } from '../types/entities';

// Preview box size in CSS pixels
const PREVIEW_W = 320;
const PREVIEW_H = 180;
const HEADER_H  = 34;
const MARGIN    = 12;

export class CameraPreviewPanel {
  private panel: HTMLElement;
  private frame: HTMLIFrameElement = document.createElement('iframe');
  private select: HTMLSelectElement = document.createElement('select');
  private refreshButton: HTMLButtonElement = document.createElement('button');
  private noSignalEl: HTMLElement = document.createElement('div');
  private readonly isDev = ['localhost', '127.0.0.1'].includes(window.location.hostname) || window.location.port === '3001';
  private readonly engineOrigin = `${window.location.protocol}//${window.location.hostname}:3000`;
  private entityMap: Map<string, CameraEntity> = new Map();
  private selectedId = '';
  private activeRoomId: string | null = null;
  private frameLoaded = false;
  private lastPayload = '';

  constructor(private readonly container: HTMLElement) {
    this.panel = this.buildDOM();
    this.container.appendChild(this.panel);
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Rebuild the camera dropdown from the current room entity list. */
  public updateCameraList(roomId: string | null, entities: EditorEntity[]): void {
    this.activeRoomId = roomId;
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
      this.postPreviewState();
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
    this.postPreviewState();
  }

  public syncPreview(enabled: boolean): void {
    if (!this.isDev || !enabled || this.panel.style.display === 'none') return;
    this.postPreviewState();
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
      this.postPreviewState();
    });

    this.refreshButton = document.createElement('button');
    this.refreshButton.className = 'cam-preview-refresh';
    this.refreshButton.type = 'button';
    this.refreshButton.title = this.isDev ? 'Reload engine preview' : 'Available in dev mode only';
    this.refreshButton.setAttribute('aria-label', 'Refresh camera preview');
    this.refreshButton.disabled = !this.isDev;
    this.refreshButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
        <polyline points="21 3 21 9 15 9"/>
      </svg>
    `;
    this.refreshButton.addEventListener('click', () => {
      this.reloadPreviewFrame();
    });

    header.appendChild(label);
    header.appendChild(this.select);
    header.appendChild(this.refreshButton);
    panel.appendChild(header);

    // ── Body (iframe — engine renders here) ──
    const body = document.createElement('div');
    body.className = 'cam-preview-body';

    this.frame = document.createElement('iframe');
    this.frame.className = 'cam-preview-frame';
    this.frame.title = 'Engine camera preview';
    this.frame.loading = 'eager';
    this.frame.referrerPolicy = 'no-referrer';
    if (this.isDev) {
      this.frame.src = `${this.engineOrigin}/?editorPreview=1`;
      this.frame.addEventListener('load', () => {
        this.frameLoaded = true;
        this.postPreviewState();
      });
    }
    body.appendChild(this.frame);

    this.noSignalEl = document.createElement('div');
    this.noSignalEl.className = 'cam-preview-nosignal';
    this.noSignalEl.innerHTML = this.isDev ? `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28">
        <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        <line x1="2" y1="2" x2="22" y2="22" stroke-width="1.5"/>
      </svg>
      <span>No cameras in room</span>
    ` : `
      <span>Camera preview is available in dev mode only.</span>
    `;
    body.appendChild(this.noSignalEl);
    panel.appendChild(body);

    return panel;
  }

  private postPreviewState(): void {
    if (!this.isDev) return;
    if (!this.frameLoaded || !this.frame.contentWindow) return;

    const entity = this.entityMap.get(this.selectedId);
    const payload = JSON.stringify({
      type: 'heelquest-editor-preview-sync',
      roomId: this.activeRoomId,
      cameraId: entity?.id ?? null,
      camera: entity ? {
        position: { ...entity.transform.position },
        rotation: {
          x: entity.transform.rotation.x * Math.PI / 180,
          y: entity.transform.rotation.y * Math.PI / 180,
          z: entity.transform.rotation.z * Math.PI / 180,
        },
        fov: entity.fov > 0 ? entity.fov : 60,
        near: entity.near > 0 ? entity.near : 0.1,
        far: entity.far > 0 ? entity.far : 500,
      } : null,
    });

    if (payload === this.lastPayload) return;
    this.lastPayload = payload;
    this.frame.contentWindow.postMessage(JSON.parse(payload), this.engineOrigin);
  }

  private reloadPreviewFrame(): void {
    if (!this.isDev) return;
    this.frameLoaded = false;
    this.lastPayload = '';
    this.frame.src = `${this.engineOrigin}/?editorPreview=1&t=${Date.now()}`;
  }

  public static get PANEL_H(): number { return PREVIEW_H + HEADER_H; }
  public static get PANEL_W(): number { return PREVIEW_W; }
  public static get PANEL_MARGIN(): number { return MARGIN; }
  public static get HEADER_H(): number { return HEADER_H; }
}
