/* ═══════════════════════════════════════════════════════════════════════
   HeightMapController — Non-destructive terrain sculpting viewport

   Manages a subdivided floor plane that deforms in real-time based on
   parametric modifiers (PointModifier, LineModifier). Serializes only the
   modifier parameters — no heavy mesh data is stored.
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { computeTerrainHeight } from '@heel-quest/shared-core';
import type { ViewportManager } from './ViewportManager';
import type {
  RoomData,
  HeightModifier,
  PointModifier,
  LineModifier,
  Vec2,
} from '../types/scene';

// ── Constants ────────────────────────────────────────────────────────────────

/** Subdivision count per axis for the terrain PlaneGeometry */
const TERRAIN_SEGMENTS = 64;

/** Padding added around the room AABB for the terrain mesh bounds */
const TERRAIN_PADDING = 1.5;

/** World-unit radius within which a click selects an existing modifier */
const PICK_RADIUS = 0.8;

const COLOR_POINT_DEFAULT = 0xff8844;
const COLOR_LINE_DEFAULT  = 0x44aaff;
const COLOR_SELECTED      = 0xffffff;

// ── HeightMapController ──────────────────────────────────────────────────────

export type HeightTool = 'height-point' | 'height-line' | 'height-select';

export class HeightMapController {
  private viewport: ViewportManager;

  /** Root group — all terrain objects live here */
  private group = new THREE.Group();

  /** Subdivided terrain mesh */
  private terrainMesh: THREE.Mesh | null = null;

  /** Wireframe overlay — shown on top of terrain so grid is visible */
  private wireframeMesh: THREE.Mesh | null = null;

  /** Room outline loop (floats 0.05 above terrain surface) */
  private outlineLine: THREE.Line | null = null;

  /** Gizmo sphere / line objects keyed by modifier id */
  private gizmoGroup = new THREE.Group();

  /** Cursor preview sphere (follows mouse in height mode) */
  private cursorSphere: THREE.Mesh;

  // ── State ─────────────────────────────────────────────────────────────────

  private isActive = false;
  private room: RoomData | null = null;
  private currentTool: HeightTool = 'height-point';
  private selectedModifierId: string | null = null;

  /** Waypoints collected while drawing a line modifier */
  private lineInProgress: Vec2[] = [];

  /** Dashed preview line shown while drawing */
  private linePreview: THREE.Line | null = null;

  /** Cached terrain AABB (world units) */
  private boundsMin: Vec2 = { x: -10, y: -10 };
  private boundsMax: Vec2 = { x:  10, y:  10 };

  // ── Callbacks ─────────────────────────────────────────────────────────────

  /** Fired when the selected modifier changes (null = nothing selected) */
  public onModifierSelected: ((m: HeightModifier | null) => void) | null = null;

  /** Fired after any modifier is added, removed, or updated */
  public onModifiersChanged: ((modifiers: HeightModifier[]) => void) | null = null;

  public onHistoryNeeded: (() => void) | null = null;

  // ── Event handlers (stored for removal) ───────────────────────────────────

  private _clickHandler:     ((e: MouseEvent)    => void) | null = null;
  private _dblClickHandler:  ((e: MouseEvent)    => void) | null = null;
  private _mouseMoveHandler: ((e: MouseEvent)    => void) | null = null;
  private _keyDownHandler:   ((e: KeyboardEvent) => void) | null = null;

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(viewport: ViewportManager) {
    this.viewport = viewport;

    this.group.name = '__height_map';
    this.group.visible = false;
    this.group.add(this.gizmoGroup);
    this.viewport.scene.add(this.group);

    // Cursor sphere (hidden initially)
    const cursorGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    this.cursorSphere = new THREE.Mesh(cursorGeo, cursorMat);
    this.cursorSphere.visible = false;
    this.group.add(this.cursorSphere);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  public activate(room: RoomData): void {
    this.room = room;
    this.isActive = true;
    this.group.visible = true;

    // Ensure new rooms always have the array
    if (!room.heightModifiers) room.heightModifiers = [];

    this.computeBounds(room.outline);
    this.buildTerrainMesh();
    this.buildOutline(room.outline);
    this.applyAllModifiers();
    this.rebuildGizmos();

    const canvas = this.viewport.renderer.domElement;

    this._clickHandler = (e) => this.handleClick(e);
    this._dblClickHandler = (e) => this.handleDoubleClick(e);
    this._mouseMoveHandler = (e) => this.handleMouseMove(e);
    this._keyDownHandler = (e) => this.handleKeyDown(e);

    canvas.addEventListener('click', this._clickHandler);
    canvas.addEventListener('dblclick', this._dblClickHandler);
    canvas.addEventListener('mousemove', this._mouseMoveHandler);
    document.addEventListener('keydown', this._keyDownHandler);
  }

  public deactivate(): void {
    this.isActive = false;
    this.group.visible = false;
    this.cursorSphere.visible = false;

    this.cancelLine();

    const canvas = this.viewport.renderer.domElement;
    if (this._clickHandler)     canvas.removeEventListener('click',     this._clickHandler);
    if (this._dblClickHandler)  canvas.removeEventListener('dblclick',  this._dblClickHandler);
    if (this._mouseMoveHandler) canvas.removeEventListener('mousemove', this._mouseMoveHandler);
    if (this._keyDownHandler)   document.removeEventListener('keydown', this._keyDownHandler);

    this._clickHandler = this._dblClickHandler = this._mouseMoveHandler = this._keyDownHandler = null;
  }

  public setTool(tool: HeightTool): void {
    this.currentTool = tool;
    if (tool !== 'height-line') this.cancelLine();
  }

  /** Returns the ID of the currently selected modifier, or null */
  public getSelectedModifierId(): string | null {
    return this.selectedModifierId;
  }

  /** Programmatically select a modifier by ID (e.g. from the outliner) */
  public selectModifierById(id: string): void {
    if (!this.room) return;
    const mod = this.room.heightModifiers.find(m => m.id === id);
    if (!mod) return;
    this.selectedModifierId = id;
    this.rebuildGizmos();
    this.onModifierSelected?.(mod);
  }

  /** Called by EditorApp when the RightPanel modifier property changes */
  public updateModifier(updated: HeightModifier): void {
    if (!this.room) return;
    this.onHistoryNeeded?.();
    const idx = this.room.heightModifiers.findIndex(m => m.id === updated.id);
    if (idx < 0) return;
    this.room.heightModifiers[idx] = updated;
    this.applyAllModifiers();
    this.rebuildGizmos();
    this.onModifiersChanged?.(this.room.heightModifiers);
  }

  /** Delete the currently selected modifier */
  public deleteSelected(): void {
    if (!this.room || !this.selectedModifierId) return;
    this.onHistoryNeeded?.();
    this.room.heightModifiers = this.room.heightModifiers.filter(
      m => m.id !== this.selectedModifierId
    );
    this.selectedModifierId = null;
    this.applyAllModifiers();
    this.rebuildGizmos();
    this.onModifierSelected?.(null);
    this.onModifiersChanged?.(this.room.heightModifiers);
  }

  /** Finalize the in-progress line modifier (can also be called from editor with Enter key) */
  public finalizeLineModifier(): void {
    if (!this.room || this.lineInProgress.length < 2) {
      this.cancelLine();
      return;
    }

    this.onHistoryNeeded?.();
    const id = `lm_${Date.now()}`;
    const mod: LineModifier = {
      id,
      type: 'line',
      points: [...this.lineInProgress],
      elevationOffset: 1.5,
      width: 1.5,
      sharpness: 1.0,
    };

    this.room.heightModifiers.push(mod);
    this.selectedModifierId = id;
    this.lineInProgress = [];
    this.clearLinePreview();

    this.applyAllModifiers();
    this.rebuildGizmos();
    this.onModifierSelected?.(mod);
    this.onModifiersChanged?.(this.room.heightModifiers);
  }

  // ── Terrain mesh ──────────────────────────────────────────────────────────

  private computeBounds(outline: Vec2[]): void {
    if (outline.length === 0) {
      this.boundsMin = { x: -10, y: -10 };
      this.boundsMax = { x:  10, y:  10 };
      return;
    }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const v of outline) {
      minX = Math.min(minX, v.x); minZ = Math.min(minZ, v.y);
      maxX = Math.max(maxX, v.x); maxZ = Math.max(maxZ, v.y);
    }
    this.boundsMin = { x: minX - TERRAIN_PADDING, y: minZ - TERRAIN_PADDING };
    this.boundsMax = { x: maxX + TERRAIN_PADDING, y: maxZ + TERRAIN_PADDING };
  }

  private buildTerrainMesh(): void {
    if (this.terrainMesh) {
      this.group.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.wireframeMesh) {
      this.group.remove(this.wireframeMesh);
      this.wireframeMesh.geometry.dispose();
      (this.wireframeMesh.material as THREE.Material).dispose();
    }

    const w  = this.boundsMax.x - this.boundsMin.x;
    const d  = this.boundsMax.y - this.boundsMin.y;
    const cx = (this.boundsMin.x + this.boundsMax.x) / 2;
    const cz = (this.boundsMin.y + this.boundsMax.y) / 2;

    const geo = new THREE.PlaneGeometry(w, d, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2); // XZ plane
    geo.translate(cx, 0, cz);  // center over room

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a3040,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.name = '__terrain_solid';
    this.group.add(this.terrainMesh);

    // Wireframe overlay for grid visibility
    const wireGeo = geo.clone();
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x2a4455,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    this.wireframeMesh = new THREE.Mesh(wireGeo, wireMat);
    this.wireframeMesh.position.y = 0.001; // Z-offset to avoid fighting
    this.wireframeMesh.name = '__terrain_wire';
    this.group.add(this.wireframeMesh);
  }

  private buildOutline(outline: Vec2[]): void {
    if (this.outlineLine) {
      this.group.remove(this.outlineLine);
      this.outlineLine.geometry.dispose();
    }
    if (outline.length < 2) return;

    const pts = [...outline, outline[0]].map(v =>
      new THREE.Vector3(v.x, this.getHeightAt(v.x, v.y) + 0.08, v.y)
    );
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x58a6ff });
    this.outlineLine = new THREE.Line(geo, mat);
    this.group.add(this.outlineLine);
  }

  // ── Displacement ──────────────────────────────────────────────────────────

  /**
   * Iterate every vertex of the terrain mesh and set its Y to the sum of
   * all modifier contributions at that XZ position.
   */
  private applyAllModifiers(): void {
    if (!this.terrainMesh || !this.room) return;

    const geo   = this.terrainMesh.geometry;
    const pos   = geo.attributes.position as THREE.BufferAttribute;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      pos.setY(i, this.getHeightAt(wx, wz));
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // Sync wireframe and outline
    if (this.wireframeMesh) {
      const wPos = this.wireframeMesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        wPos.setY(i, pos.getY(i) + 0.001);
      }
      wPos.needsUpdate = true;
    }

    if (this.room) this.buildOutline(this.room.outline);
  }

  /**
   * Public: compute the terrain Y displacement at any world XZ position.
   * Returns 0 when no room is active or room has no modifiers.
   */
  public setRoom(room: RoomData | null): void {
    this.room = room;
    if (this.room && !this.room.heightModifiers) this.room.heightModifiers = [];
  }

  public getHeightAt(wx: number, wz: number): number {
    return computeTerrainHeight(this.room?.heightModifiers ?? [], wx, wz);
  }

  // ── Gizmo rendering ───────────────────────────────────────────────────────

  private rebuildGizmos(): void {
    // Dispose existing gizmos
    while (this.gizmoGroup.children.length > 0) {
      const child = this.gizmoGroup.children[0] as THREE.Mesh | THREE.Line;
      this.gizmoGroup.remove(child);
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        (child.material as THREE.Material)?.dispose();
      }
    }

    if (!this.room) return;

    for (const mod of this.room.heightModifiers) {
      const isSelected = mod.id === this.selectedModifierId;
      const col = isSelected
        ? COLOR_SELECTED
        : mod.type === 'point' ? COLOR_POINT_DEFAULT : COLOR_LINE_DEFAULT;

      if (mod.type === 'point') {
        this.buildPointGizmo(mod, col);
      } else {
        this.buildLineGizmo(mod, col);
      }
    }
  }

  private buildPointGizmo(mod: PointModifier, color: number): void {
    const cy = this.getHeightAt(mod.position.x, mod.position.y);

    // Center sphere
    const sGeo = new THREE.SphereGeometry(0.22, 10, 10);
    const sMat = new THREE.MeshBasicMaterial({ color });
    const sphere = new THREE.Mesh(sGeo, sMat);
    sphere.position.set(mod.position.x, cy + 0.22, mod.position.y);
    sphere.userData.modifierId = mod.id;
    this.gizmoGroup.add(sphere);

    // Radius ring (flat disc on XZ plane)
    const rInner = Math.max(0, mod.radius - 0.06);
    const rGeo   = new THREE.RingGeometry(rInner, mod.radius + 0.06, 40);
    const rMat   = new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.35,
    });
    const ring = new THREE.Mesh(rGeo, rMat);
    ring.position.set(mod.position.x, cy + 0.02, mod.position.y);
    ring.rotation.x = -Math.PI / 2;
    this.gizmoGroup.add(ring);
  }

  private buildLineGizmo(mod: LineModifier, color: number): void {
    if (mod.points.length < 2) return;

    // Central line
    const pts = mod.points.map(p =>
      new THREE.Vector3(p.x, this.getHeightAt(p.x, p.y) + 0.06, p.y)
    );
    const lGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lMat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(lGeo, lMat);
    line.userData.modifierId = mod.id;
    this.gizmoGroup.add(line);

    // Endpoint spheres
    for (const p of mod.points) {
      const cy = this.getHeightAt(p.x, p.y);
      const sGeo = new THREE.SphereGeometry(0.18, 8, 8);
      const sMat = new THREE.MeshBasicMaterial({ color });
      const sp   = new THREE.Mesh(sGeo, sMat);
      sp.position.set(p.x, cy + 0.18, p.y);
      sp.userData.modifierId = mod.id;
      this.gizmoGroup.add(sp);
    }
  }

  // ── Input handling ────────────────────────────────────────────────────────

  /** Tracks whether a pending single-click should be treated as a dblclick second hit */
  private _pendingClickTimer: ReturnType<typeof setTimeout> | null = null;

  private handleClick(e: MouseEvent): void {
    if (!this.isActive || !this.room) return;

    const xz = this.screenToXZ(e.clientX, e.clientY);
    if (!xz) return;

    if (this.currentTool === 'height-point' || this.currentTool === 'height-select') {
      const existing = this.findModifierAt(xz);
      if (existing) {
        this.selectedModifierId = existing.id;
        this.rebuildGizmos();
        this.onModifierSelected?.(existing);
        return;
      }

      if (this.currentTool === 'height-point') {
        this.placePointModifier(xz);
      } else {
        this.selectedModifierId = null;
        this.rebuildGizmos();
        this.onModifierSelected?.(null);
      }

    } else if (this.currentTool === 'height-line') {
      // Use a short timer to distinguish single vs double click
      // Double-click fires click × 2 then dblclick; we swallow the 2nd click.
      if (this._pendingClickTimer !== null) return; // already waiting on dblclick
      this._pendingClickTimer = setTimeout(() => {
        this._pendingClickTimer = null;
        this.addLinePoint(xz);
      }, 180);
    }
  }

  private handleDoubleClick(e: MouseEvent): void {
    if (!this.isActive || this.currentTool !== 'height-line') return;
    if (this._pendingClickTimer !== null) {
      clearTimeout(this._pendingClickTimer);
      this._pendingClickTimer = null;
    }
    this.finalizeLineModifier();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isActive) return;
    const xz = this.screenToXZ(e.clientX, e.clientY);
    if (!xz) {
      this.cursorSphere.visible = false;
      return;
    }
    const cy = this.getHeightAt(xz.x, xz.y);
    this.cursorSphere.position.set(xz.x, cy + 0.15, xz.y);
    this.cursorSphere.visible = true;

    // Update live line preview tip
    if (this.currentTool === 'height-line' && this.lineInProgress.length > 0) {
      this.updateLinePreview(xz);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isActive) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (e.key === 'Enter') {
      this.finalizeLineModifier();
    } else if (e.key === 'Escape') {
      if (this.lineInProgress.length > 0) {
        this.cancelLine();
      } else {
        this.selectedModifierId = null;
        this.rebuildGizmos();
        this.onModifierSelected?.(null);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if ((e.target as HTMLElement).tagName !== 'INPUT') {
        this.deleteSelected();
      }
    }
  }

  // ── Placement helpers ─────────────────────────────────────────────────────

  private placePointModifier(pos: Vec2): void {
    if (!this.room) return;

    this.onHistoryNeeded?.();
    const id: string  = `pm_${Date.now()}`;
    const mod: PointModifier = {
      id,
      type: 'point',
      position: this.snap(pos),
      elevationOffset: 1.5,
      radius: 2.0,
      sharpness: 1.0,
    };

    this.room.heightModifiers.push(mod);
    this.selectedModifierId = id;
    this.applyAllModifiers();
    this.rebuildGizmos();
    this.onModifierSelected?.(mod);
    this.onModifiersChanged?.(this.room.heightModifiers);
  }

  private addLinePoint(pos: Vec2): void {
    this.lineInProgress.push(this.snap(pos));
    if (this.lineInProgress.length >= 2) {
      this.updateLinePreview(null);
    }
  }

  private updateLinePreview(tip: Vec2 | null): void {
    this.clearLinePreview();

    const pts = [...this.lineInProgress];
    if (tip) pts.push(tip);
    if (pts.length < 2) return;

    const threePts = pts.map(p =>
      new THREE.Vector3(p.x, this.getHeightAt(p.x, p.y) + 0.1, p.y)
    );
    const geo  = new THREE.BufferGeometry().setFromPoints(threePts);
    const mat  = new THREE.LineDashedMaterial({
      color: COLOR_LINE_DEFAULT,
      dashSize: 0.35,
      gapSize: 0.15,
    });
    this.linePreview = new THREE.Line(geo, mat);
    (this.linePreview as THREE.Line).computeLineDistances();
    this.group.add(this.linePreview);
  }

  private cancelLine(): void {
    this.lineInProgress = [];
    this.clearLinePreview();
  }

  private clearLinePreview(): void {
    if (this.linePreview) {
      this.group.remove(this.linePreview);
      this.linePreview.geometry.dispose();
      (this.linePreview.material as THREE.Material).dispose();
      this.linePreview = null;
    }
  }

  // ── Picking ───────────────────────────────────────────────────────────────

  /** Find the nearest modifier within PICK_RADIUS of the given XZ floor position */
  private findModifierAt(pos: Vec2): HeightModifier | null {
    if (!this.room) return null;

    let best: HeightModifier | null = null;
    let bestDist = PICK_RADIUS;

    for (const mod of this.room.heightModifiers) {
      let dist = Infinity;
      if (mod.type === 'point') {
        const dx = pos.x - mod.position.x, dz = pos.y - mod.position.y;
        dist = Math.sqrt(dx * dx + dz * dz);
      } else {
        dist = this.distToPolyline(pos.x, pos.y, mod.points);
      }
      if (dist < bestDist) { bestDist = dist; best = mod; }
    }

    return best;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /** Project screen coords to XZ floor plane via the active camera */
  private screenToXZ(clientX: number, clientY: number): Vec2 | null {
    const hit = this.viewport.screenToFloor(clientX, clientY);
    if (!hit) return null;
    return { x: hit.x, y: hit.z };
  }

  /** Snap XZ to 0.25-unit grid */
  private snap(pos: Vec2): Vec2 {
    const SNAP = 0.25;
    return {
      x: parseFloat((Math.round(pos.x / SNAP) * SNAP).toFixed(2)),
      y: parseFloat((Math.round(pos.y / SNAP) * SNAP).toFixed(2)),
    };
  }

  /** Minimum distance from point (px, pz) to a polyline defined by Vec2[] */
  private distToPolyline(px: number, pz: number, pts: Vec2[]): number {
    if (pts.length === 0) return Infinity;
    if (pts.length === 1) {
      const dx = px - pts[0].x, dz = pz - pts[0].y;
      return Math.sqrt(dx * dx + dz * dz);
    }
    let min = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      min = Math.min(min, this.distToSegment(px, pz, pts[i], pts[i + 1]));
    }
    return min;
  }

  /** Minimum distance from point (px, pz) to a line segment [a, b] */
  private distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
    const ax = b.x - a.x, az = b.y - a.y;
    const len2 = ax * ax + az * az;
    if (len2 < 1e-10) {
      const dx = px - a.x, dz = pz - a.y;
      return Math.sqrt(dx * dx + dz * dz);
    }
    const t  = Math.max(0, Math.min(1, ((px - a.x) * ax + (pz - a.y) * az) / len2));
    const cx = a.x + t * ax, cz = a.y + t * az;
    const dx = px - cx, dz = pz - cz;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
