/* ═══════════════════════════════════════════════════════════════════════
   WorldMapController — Top-down 2D vector editor for rooms and doors
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import type { ViewportManager } from './ViewportManager';
import type { WorldProject, RoomData, Vec2 } from '../types/scene';
import { createDefaultRoom } from '../types/scene';

const SNAP_GRID = 0.5;
const EDGE_SNAP_THRESHOLD = 2.0;

export class WorldMapController {
  private viewport: ViewportManager;
  private sceneGroup: THREE.Group = new THREE.Group();
  private points: THREE.Vector3[] = [];
  private activeLine: THREE.Line | null = null;
  private previewLine: THREE.Line | null = null;
  
  private world: WorldProject;
  private onRoomSelect: (roomId: string) => void;
  private onDoorCreated: ((doorId: string, midX: number, midZ: number, room1Id: string, room2Id: string | null, dirX: number, dirZ: number, halfLen: number) => void) | null = null;

  private isDrawing = false;
  private currentTool: string = 'select';
  private roomMeshes: Map<string, THREE.Object3D> = new Map();

  private draggingRoomId: string | null = null;
  private draggingVertexIndex: number = -1;
  private dragLastPos: THREE.Vector3 | null = null;
  private didDrag = false;

  // Round tool state
  private roundingVertexIndex: number = -1;
  private roundingVertexPos: { x: number; y: number } | null = null;
  private roundingDidDrag = false;
  private radiusLabel: HTMLElement;

  private vertexGroups: THREE.Group = new THREE.Group();

  constructor(viewport: ViewportManager, world: WorldProject, onRoomSelect: (roomId: string) => void) {
    this.viewport = viewport;
    this.world = world;
    this.onRoomSelect = onRoomSelect;

    this.sceneGroup.name = '__world_map_group';
    this.viewport.scene.add(this.sceneGroup);
    this.sceneGroup.visible = false;

    this.sceneGroup.add(this.vertexGroups);

    // Radius indicator label (DOM overlay)
    this.radiusLabel = document.createElement('div');
    this.radiusLabel.style.cssText = [
      'position:fixed', 'pointer-events:none', 'display:none',
      'background:rgba(0,0,0,0.75)', 'color:#58a6ff', 'font-size:11px',
      'font-family:"JetBrains Mono",monospace', 'padding:2px 6px',
      'border-radius:4px', 'border:1px solid #58a6ff', 'z-index:9999',
    ].join(';');
    document.body.appendChild(this.radiusLabel);
  }

  public setOnDoorCreated(cb: (doorId: string, midX: number, midZ: number, room1Id: string, room2Id: string | null, dirX: number, dirZ: number, halfLen: number) => void) {
    this.onDoorCreated = cb;
  }

  public activate() {
    this.sceneGroup.visible = true;
    this.viewport.setOrthographicMode(true);
    this.rebuildRooms();
  }

  public deactivate() {
    this.sceneGroup.visible = false;
    this.viewport.setOrthographicMode(false);
    this.cancelDrawing();
  }

  public setWorld(world: WorldProject) {
    this.world = world;
    if (this.sceneGroup.visible) {
      this.rebuildRooms();
    }
  }

  public setTool(tool: string) {
    this.currentTool = tool;
    this.cancelDrawing();
  }

  // ── Drawing Events ──

  public handlePointerDown(e: PointerEvent) {
    if (!this.sceneGroup.visible || e.button !== 0) return;

    if (this.currentTool === 'select') {
      const hit = this.raycastRooms(e.clientX, e.clientY);
      if (hit) {
        this.onRoomSelect(hit);
      }
      return;
    }

    if (this.currentTool === 'translate') {
      const vHit = this.raycastVertices(e.clientX, e.clientY);
      const pos = this.viewport.screenToFloor(e.clientX, e.clientY);
      
      if (vHit !== -1) {
        this.draggingVertexIndex = vHit;
        this.dragLastPos = pos;
        this.draggingRoomId = this.world.activeRoomId ?? null;
        return;
      }

      const hit = this.raycastRooms(e.clientX, e.clientY);
      if (hit) {
        if (pos) {
          this.draggingRoomId = hit;
          this.dragLastPos = pos;
          this.didDrag = false;
        }
      }
      return;
    }

    if (this.currentTool === 'round') {
      const vHit = this.raycastVertices(e.clientX, e.clientY);
      if (vHit !== -1) {
        const room = this.world.rooms.find(r => r.id === this.world.activeRoomId);
        if (room) {
          this.roundingVertexIndex = vHit;
          this.roundingVertexPos = { x: room.outline[vHit].x, y: room.outline[vHit].y };
          this.roundingDidDrag = false;
        }
      }
      return;
    }

    if (this.currentTool !== 'room' && this.currentTool !== 'door') return;

    const pos = this.viewport.screenToFloor(e.clientX, e.clientY);
    if (!pos) return;

    // ── Wall Snapping Logic ──
    let bestSnap: THREE.Vector3 | null = null;
    let minSnapDist = EDGE_SNAP_THRESHOLD; // Snap threshold

    for (const room of this.world.rooms) {
      for (let i = 0; i < room.outline.length; i++) {
        const p1 = room.outline[i];
        const p2 = room.outline[(i+1)%room.outline.length];
        
        const v = p1, w = p2, p = { x: pos.x, y: pos.z };
        const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 === 0) continue;
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const closestX = v.x + t * (w.x - v.x);
        const closestY = v.y + t * (w.y - v.y);
        const d2 = (p.x - closestX)**2 + (p.y - closestY)**2;
        
        if (d2 < minSnapDist**2) {
          minSnapDist = Math.sqrt(d2);
          bestSnap = new THREE.Vector3(closestX, 0, closestY);
        }
      }
    }

    if (bestSnap) {
      pos.copy(bestSnap);
    } else {
      // Fallback: Snap to grid
      pos.x = Math.round(pos.x / SNAP_GRID) * SNAP_GRID;
      pos.z = Math.round(pos.z / SNAP_GRID) * SNAP_GRID;
    }

    if (!this.isDrawing) {
      this.isDrawing = true;
      this.points = [pos.clone()];
    } else {
      if (this.currentTool === 'door') {
        this.points.push(pos.clone());
        this.finishDrawingDoor();
      } else if (this.currentTool === 'room') {
        if (this.points.length > 2 && pos.distanceTo(this.points[0]) < 1.0) {
          this.finishDrawingRoom();
        } else {
          this.points.push(pos.clone());
        }
      }
    }
    this.updateDrawingLines();
  }

  public handlePointerMove(e: PointerEvent) {
    if (!this.sceneGroup.visible) return;

    // Round tool drag — update corner radius
    if (this.roundingVertexIndex !== -1 && this.roundingVertexPos) {
      const pos = this.viewport.screenToFloor(e.clientX, e.clientY);
      if (pos) {
        const room = this.world.rooms.find(r => r.id === this.world.activeRoomId);
        if (room) {
          if (!room.cornerRadii) room.cornerRadii = new Array(room.outline.length).fill(0);
          const dx = pos.x - this.roundingVertexPos.x;
          const dz = pos.z - this.roundingVertexPos.y;
          const dist = Math.sqrt(dx * dx + dz * dz);
          room.cornerRadii[this.roundingVertexIndex] = dist;
          this.roundingDidDrag = true;
          this.radiusLabel.style.display = 'block';
          this.radiusLabel.style.left = (e.clientX + 14) + 'px';
          this.radiusLabel.style.top = (e.clientY - 8) + 'px';
          this.radiusLabel.textContent = `r = ${dist.toFixed(2)}`;
          this.rebuildRooms();
        }
      }
      return;
    }

    if (this.draggingRoomId && this.dragLastPos) {
      const pos = this.viewport.screenToFloor(e.clientX, e.clientY);
      if (pos) {
        const dx = pos.x - this.dragLastPos.x;
        const dz = pos.z - this.dragLastPos.z;
        
        if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
          const room = this.world.rooms.find(r => r.id === this.draggingRoomId);
          if (room) {
            if (this.draggingVertexIndex !== -1) {
              const p = room.outline[this.draggingVertexIndex];
              p.x += dx;
              p.y += dz;
            } else {
              room.outline.forEach(p => {
                p.x += dx;
                p.y += dz;
              });
            }
            this.dragLastPos = pos;
            this.didDrag = true;
            this.rebuildRooms();
          }
        }
      }
      return;
    }

    if (!this.isDrawing) return;

    const pos = this.viewport.screenToFloor(e.clientX, e.clientY);
    if (!pos) return;

    pos.x = Math.round(pos.x * 2) / 2;
    pos.z = Math.round(pos.z * 2) / 2;

    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      
      if (!this.previewLine) {
        const mat = new THREE.LineDashedMaterial({ color: this.currentTool === 'door' ? 0xff0000 : 0xffaa00, dashSize: 0.5, gapSize: 0.2 });
        const geo = new THREE.BufferGeometry().setFromPoints([last, pos]);
        this.previewLine = new THREE.Line(geo, mat);
        this.previewLine.computeLineDistances();
        this.sceneGroup.add(this.previewLine);
      } else {
        this.previewLine.geometry.setFromPoints([last, pos]);
        this.previewLine.computeLineDistances();
      }
    }
  }

  public handlePointerUp(e: PointerEvent) {
     // Round tool: if no drag → reset radius to 0
     if (this.roundingVertexIndex !== -1) {
       if (!this.roundingDidDrag) {
         const room = this.world.rooms.find(r => r.id === this.world.activeRoomId);
         if (room && room.cornerRadii) {
           room.cornerRadii[this.roundingVertexIndex] = 0;
           this.rebuildRooms();
         }
       }
       this.roundingVertexIndex = -1;
       this.roundingVertexPos = null;
       this.roundingDidDrag = false;
       this.radiusLabel.style.display = 'none';
       return;
     }

     if (this.draggingRoomId) {
        this.draggingRoomId = null;
        this.draggingVertexIndex = -1;
        this.dragLastPos = null;
     }
  }

  public handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.cancelDrawing();
    }
  }

  // ── Logic ──

  private finishDrawingRoom() {
    const roomId = 'room_' + Date.now();
    const room = createDefaultRoom(roomId);
    
    // Convert 3D points to 2D outline (x, z -> x, y)
    room.outline = this.points.map(p => ({ x: p.x, y: p.z }));
    room.cornerRadii = new Array(room.outline.length).fill(0);
    this.world.rooms.push(room);

    this.cancelDrawing();
    this.rebuildRooms();
    this.onRoomSelect(roomId);
  }

  private finishDrawingDoor() {
    if (this.points.length < 2) return;

    // Compute wall direction from the two drawn endpoints
    const rawDx = this.points[1].x - this.points[0].x;
    const rawDz = this.points[1].z - this.points[0].z;
    const len = Math.sqrt(rawDx * rawDx + rawDz * rawDz);
    const dirX = len > 0.001 ? rawDx / len : 1;
    const dirZ = len > 0.001 ? rawDz / len : 0;
    const halfLen = len / 2;

    const door = {
      id: 'door_' + Date.now(),
      points: [
         { x: this.points[0].x, y: this.points[0].z },
         { x: this.points[1].x, y: this.points[1].z }
      ] as [Vec2, Vec2],
      room1Id: '',
      room2Id: null as string | null,
      width: 1,
      texture: 'door_default'
    };

    // Calculate which rooms the door touches
    // Simple point-in-polygon logic for endpoints
    const pointInPolygon = (pt: Vec2, polygon: Vec2[]) => {
      let isInside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
            (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
      }
      return isInside;
    };

    // To be generous, we check a slightly expanded radius or just check if endpoints fall in any room.
    // Or simpler: find shortest distance from door center to room centers or boundaries.
    // Let's just do point-in-polygon on the door center for now.
    const cx = (this.points[0].x + this.points[1].x) / 2;
    const cy = (this.points[0].z + this.points[1].z) / 2;
    
    // We'll assign door to ANY two rooms whose bounds are near the door.
    // Actually, user draws door ON the shared edge. 
    // Which means it might be EXACTLY on the edge, making point-in-polygon fail.
    // Better heuristic: find all rooms where distance from door center to polygon edge is < 1.0.
    
    const distToSegmentSquared = (p: Vec2, v: Vec2, w: Vec2) => {
      const l2 = (v.x - w.x)*(v.x - w.x) + (v.y - w.y)*(v.y - w.y);
      if (l2 === 0) return (p.x - v.x)*(p.x - v.x) + (p.y - v.y)*(p.y - v.y);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
    };

    let touchedRooms: string[] = [];
    for (const room of this.world.rooms) {
      // check distance to edges
      let minH = Infinity;
      for (let i = 0; i < room.outline.length; i++) {
        const p1 = room.outline[i];
        const p2 = room.outline[(i+1)%room.outline.length];
        const d = distToSegmentSquared({x: cx, y: cy}, p1, p2);
        if (d < minH) minH = d;
      }
      if (minH < 1.5) {
         touchedRooms.push(room.id);
      }
    }

    door.room1Id = touchedRooms[0] || '';
    door.room2Id = touchedRooms[1] || null;

    this.world.doors.push(door);
    this.cancelDrawing();
    this.rebuildRooms();

    if (this.onDoorCreated) {
      this.onDoorCreated(door.id, cx, cy, door.room1Id, door.room2Id, dirX, dirZ, halfLen);
    }
  }

  private cancelDrawing() {
    this.isDrawing = false;
    this.points = [];
    if (this.activeLine) {
      this.sceneGroup.remove(this.activeLine);
      this.activeLine = null;
    }
    if (this.previewLine) {
      this.sceneGroup.remove(this.previewLine);
      this.previewLine = null;
    }
  }

  private updateDrawingLines() {
    if (this.points.length < 2) return;

    if (!this.activeLine) {
      const mat = new THREE.LineBasicMaterial({ color: 0x00aaff, linewidth: 2 });
      const geo = new THREE.BufferGeometry().setFromPoints(this.points);
      this.activeLine = new THREE.Line(geo, mat);
      this.sceneGroup.add(this.activeLine);
    } else {
      this.activeLine.geometry.setFromPoints(this.points);
    }
  }

  rebuildRooms() {
    // Clear old
    for (const mesh of this.roomMeshes.values()) {
      this.sceneGroup.remove(mesh);
    }
    this.roomMeshes.clear();
    this.vertexGroups.clear();

    for (const room of this.world.rooms) {
      if (room.outline.length < 3) continue;

      // Expand outline using corner radii for smooth display
      const displayOutline = WorldMapController.expandOutline(room.outline, room.cornerRadii);

      // Draw Filled Shape
      const shape = new THREE.Shape();
      shape.moveTo(displayOutline[0].x, displayOutline[0].y);
      for (let i = 1; i < displayOutline.length; i++) {
        shape.lineTo(displayOutline[i].x, displayOutline[i].y);
      }
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);
      const isSelected = this.world.activeRoomId === room.id;
      const mat = new THREE.MeshBasicMaterial({ 
        color: isSelected ? 0x0088ff : 0x444444, 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5 
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2; // Lay flat on XZ plane
      mesh.position.y = 0.01; // Slightly above ground
      mesh.userData = { roomId: room.id };
      
      // Draw Stroke – Line directly from display outline avoids triangulation artifacts
      const strokePts = displayOutline.map(p => new THREE.Vector3(p.x, p.y, -0.002));
      strokePts.push(new THREE.Vector3(strokePts[0].x, strokePts[0].y, -0.002));
      const strokeGeo = new THREE.BufferGeometry().setFromPoints(strokePts);
      const lineMat = new THREE.LineBasicMaterial({ color: isSelected ? 0xffffff : 0x888888 });
      const lineMesh = new THREE.Line(strokeGeo, lineMat);
      mesh.add(lineMesh);

      this.sceneGroup.add(mesh);
      this.roomMeshes.set(room.id, mesh);

      // Draw Vertices for active room (translate or round tool)
      if (isSelected && (this.currentTool === 'translate' || this.currentTool === 'round')) {
        for (let i = 0; i < room.outline.length; i++) {
          const hasRadius = (room.cornerRadii?.[i] ?? 0) > 0.01;
          const vGeo = new THREE.SphereGeometry(0.25, 8, 8);
          const vColor = this.currentTool === 'round'
            ? (hasRadius ? 0x00ccff : 0xff8800)
            : 0x0088ff;
          const vMat = new THREE.MeshBasicMaterial({ color: vColor });
          const vMesh = new THREE.Mesh(vGeo, vMat);
          vMesh.position.set(room.outline[i].x, 0.05, room.outline[i].y);
          vMesh.userData = { vertexIndex: i };
          this.vertexGroups.add(vMesh);
        }
      }
    }

    // Draw doors
    for (const door of this.world.doors) {
      if (door.points.length !== 2) continue;
      
      const v1 = new THREE.Vector3(door.points[0].x, 0.02, door.points[0].y);
      const v2 = new THREE.Vector3(door.points[1].x, 0.02, door.points[1].y);
      const geo = new THREE.BufferGeometry().setFromPoints([v1, v2]);
      const mat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 4 });
      const mesh = new THREE.Line(geo, mat);
      
      this.sceneGroup.add(mesh);
      this.roomMeshes.set(door.id, mesh); // So it gets cleared later
    }
  }

  /**
   * Expand the polygon outline by rounding corners with quadratic Bezier arcs.
   * cornerRadii[i] is the rounding radius at outline[i]. 0 = sharp.
   */
  public static expandOutline(outline: Vec2[], radii?: number[]): Vec2[] {
    const n = outline.length;
    if (!radii || radii.every(r => r <= 0) || n < 3) return outline;
    const result: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const r = radii[i] ?? 0;
      if (r <= 0.001) { result.push(outline[i]); continue; }
      const prev = outline[(i - 1 + n) % n];
      const curr = outline[i];
      const next = outline[(i + 1) % n];
      const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
      const toNext = { x: next.x - curr.x, y: next.y - curr.y };
      const lenPrev = Math.sqrt(toPrev.x ** 2 + toPrev.y ** 2);
      const lenNext = Math.sqrt(toNext.x ** 2 + toNext.y ** 2);
      if (lenPrev < 0.001 || lenNext < 0.001) { result.push(curr); continue; }
      const uPrev = { x: toPrev.x / lenPrev, y: toPrev.y / lenPrev };
      const uNext = { x: toNext.x / lenNext, y: toNext.y / lenNext };
      // Clamp radius so tangent points stay on their edges (45% of edge length)
      const maxR = Math.min(r, lenPrev * 0.45, lenNext * 0.45);
      if (maxR < 0.01) { result.push(curr); continue; }
      const t1 = { x: curr.x + uPrev.x * maxR, y: curr.y + uPrev.y * maxR };
      const t2 = { x: curr.x + uNext.x * maxR, y: curr.y + uNext.y * maxR };
      // Quadratic Bezier arc from t1 to t2 with curr as control point
      const STEPS = 16;
      result.push(t1);
      for (let s = 1; s < STEPS; s++) {
        const tt = s / STEPS;
        result.push({
          x: (1 - tt) ** 2 * t1.x + 2 * (1 - tt) * tt * curr.x + tt ** 2 * t2.x,
          y: (1 - tt) ** 2 * t1.y + 2 * (1 - tt) * tt * curr.y + tt ** 2 * t2.y,
        });
      }
      result.push(t2);
    }
    return result;
  }

  private raycastVertices(clientX: number, clientY: number): number {
    const ndc = this.viewport.getNDC(clientX, clientY);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.viewport.activeCamera);

    const hit = raycaster.intersectObjects(this.vertexGroups.children, false);
    if (hit.length > 0) {
      return hit[0].object.userData.vertexIndex;
    }
    return -1;
  }

  private raycastRooms(clientX: number, clientY: number): string | null {
    const ndc = this.viewport.getNDC(clientX, clientY);
    const raycaster = new THREE.Raycaster();
    // we use the orthographic camera here if it's active
    raycaster.setFromCamera(ndc, this.viewport.activeCamera);

    const meshes = Array.from(this.roomMeshes.values());
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      return hits[0].object.userData.roomId;
    }
    return null;
  }
}
