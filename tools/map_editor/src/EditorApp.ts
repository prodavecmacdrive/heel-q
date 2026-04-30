/* ═══════════════════════════════════════════════════════════════════════
   EditorApp — Master orchestrator
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { ViewportManager } from './viewport/ViewportManager';
import { EditorGrid } from './viewport/EditorGrid';
import { GizmoController, type GizmoMode } from './viewport/GizmoController';
import { SelectionManager } from './viewport/SelectionManager';
import { EntityFactory } from './viewport/EntityFactory';
import { WorldMapController } from './viewport/WorldMapController';
import { HeightMapController, type HeightTool } from './viewport/HeightMapController';

import { MenuBar, type MenuAction } from './ui/MenuBar';
import { TopPanel, type EditorMode } from './ui/TopPanel';
import { LeftPanel, type ToolType } from './ui/LeftPanel';
import { BottomPanel, type DragData } from './ui/BottomPanel';
import { RightPanel } from './ui/RightPanel';
import { CameraPreviewPanel } from './ui/CameraPreviewPanel';
import { ContextMenu, type ContextMenuOption } from './ui/ContextMenu';

import { SceneSerializer } from './export/SceneSerializer';
import { HistoryManager } from './editor/HistoryManager';

const GRID_SNAP = 0.5;
const ROTATION_SNAP_DEGREES = 15;

import type { EditorEntity, EntityType, PrimitiveEntity, CameraEntity, DoorEntity, SpawnEntity } from './types/entities';
import { createDefaultEntity } from './types/entities';
import type { WorldProject, RoomData } from './types/scene';
import { createDefaultWorld } from './types/scene';

export class EditorApp {
  // ── State ──
  private world: WorldProject;
  private activeRoom: RoomData | null = null;
  private focusedObject: THREE.Object3D | null = null;
  private isolatedObjectId: string | null = null;
  private gizmoDragging = false;

  // ── Flight mode state ──
  private flightMode = false;
  private flightCameraEntity: CameraEntity | null = null;
  private savedCameraPos: THREE.Vector3 = new THREE.Vector3();
  private savedCameraRot: THREE.Euler = new THREE.Euler();
  private flightKeys: Record<string, boolean> = {};
  private flightKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private flightKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  private _flightMouseHandler: ((e: MouseEvent) => void) | null = null;
  
  private entityMap: Map<string, EditorEntity> = new Map();
  private clipboard: EditorEntity | null = null;
  private meshMap: Map<string, THREE.Object3D> = new Map();
  // Maps door entity ID → world door segment ID (for position syncing)
  private doorEntityToWorldDoor: Map<string, string> = new Map();

  // ── Viewport ──
  private viewport!: ViewportManager;
  private grid!: EditorGrid;
  private gizmo!: GizmoController;
  private selection!: SelectionManager;
  private factory: EntityFactory = new EntityFactory();
  private worldMapCtrl!: WorldMapController;
  private heightMapCtrl!: HeightMapController;

  // ── UI ──
  private menuBar!: MenuBar;
  private topPanel!: TopPanel;
  private leftPanel!: LeftPanel;
  private bottomPanel!: BottomPanel;
  private rightPanel!: RightPanel;
  private cameraPreview!: CameraPreviewPanel;
  private contextMenu: ContextMenu = new ContextMenu();

  // ── Serialization ──
  private serializer: SceneSerializer = new SceneSerializer();

  // ── Room meshes ──
  private roomGroup = new THREE.Group();
  private floorMesh: THREE.Mesh | null = null;
  private wallsMesh: THREE.Mesh | null = null;

  private currentMode: EditorMode = 'world';

  // ── History (undo/redo) ──
  private history = new HistoryManager();
  /** When true, captureHistory() is a no-op (used for multi-step atomic actions) */
  private _suppressHistory = false;

  constructor() {
    this.world = createDefaultWorld();
  }

  public init() {
    const canvas = document.getElementById('viewport-canvas') as HTMLCanvasElement;
    const container = document.getElementById('viewport-container') as HTMLElement;

    // ── Viewport ──
    this.viewport = new ViewportManager(canvas, container);
    this.grid = new EditorGrid(this.viewport.scene);
    this.gizmo = new GizmoController(this.viewport);
    this.selection = new SelectionManager(this.viewport);
    this.selection.attach(canvas);
    
    this.viewport.scene.add(this.roomGroup);

    this.worldMapCtrl = new WorldMapController(this.viewport, this.world, (id) => this.selectRoom(id));
    this.worldMapCtrl.setOnDoorCreated((doorId, midX, midZ, room1Id, room2Id, dirX, dirZ, halfLen) => {
      this.autoPlaceDoorEntities(doorId, midX, midZ, room1Id, room2Id, dirX, dirZ, halfLen);
    });
    this.worldMapCtrl.setOnHistoryNeeded(() => this.captureHistory());

    this.heightMapCtrl = new HeightMapController(this.viewport);
    this.heightMapCtrl.onHistoryNeeded = () => this.captureHistory();

    // ── UI Panels ──
    this.menuBar = new MenuBar(
      document.getElementById('menu-bar')!,
      (action) => this.handleMenuAction(action)
    );

    this.topPanel = new TopPanel(
      document.getElementById('top-panel')!,
      (mode) => this.handleModeChange(mode)
    );

    this.leftPanel = new LeftPanel(
      document.getElementById('left-panel')!,
      (tool) => this.handleToolChange(tool)
    );

    this.gizmo.transformControls.addEventListener('dragging-changed', (event) => {
      this.gizmoDragging = (event as any).value === true;
    });

    // Global right-click handler for context menu
    container.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY);
    });

    this.viewport.onRender(() => {
      if (this.focusedObject && !this.gizmoDragging) {
        this.viewport.controls.target.lerp(this.focusedObject.position, 0.1);
      }
    });

    this.bottomPanel = new BottomPanel(
      document.getElementById('bottom-panel')!
    );

    this.rightPanel = new RightPanel(
      document.getElementById('right-panel')!,
      // onChange: called on commit (blur/enter) — full update + autosave
      (target) => {
        if ('type' in target) {
          this.captureHistory();
          this.refreshEntityMesh(target as EditorEntity);
          this.worldMapCtrl.rebuildRooms();
        } else {
          // Room property changed
          this.worldMapCtrl.rebuildRooms();
        }
      },
      (entityId) => this.removeEntity(entityId),
      (roomId) => this.removeRoom(roomId),
      (roomId) => { this.selectRoom(roomId); this.topPanel.setMode('room'); },
      (cameraEntity, activate) => this.toggleFlightMode(cameraEntity, activate),
      () => this.activeRoom ? this.activeRoom.entities : []
    );

    this.rightPanel.onWorldDoorSelect = (doorId) => {
      this.selectWorldDoor(doorId);
    };

    // Wire height-modifier inspector callbacks
    this.rightPanel.onModifierChange = (m) => {
      this.heightMapCtrl.updateModifier(m);
    };
    this.rightPanel.onModifierDelete = (_id) => {
      this.heightMapCtrl.deleteSelected();
      this.rightPanel.inspectModifier(null);
    };

    // Wire outliner callbacks
    this.rightPanel.onEntitySelect = (entityId) => {
      const mesh = this.meshMap.get(entityId);
      if (mesh) this.selection.select(mesh);
    };
    this.rightPanel.onEntityHover = (entityId) => {
      this.selection.setHover(entityId);
    };
    // World-map outliner: clicking a room selects it
    this.rightPanel.onWorldRoomSelect = (roomId) => {
      this.selectRoom(roomId);
    };
    // Height-map outliner: clicking a modifier selects it in HeightMapController
    this.heightMapCtrl.onModifiersChanged = () => {
      // Re-apply terrain height to all room entities and floor mesh
      this.refreshEntityTerrainY();
      this.rebuildFloorAndWalls();
      if (this.currentMode === 'height') this.refreshOutliner();
    };

    // Capture history when a gizmo drag begins (before the transform changes)
    this.gizmo.transformControls.addEventListener('mouseDown', () => {
      this.captureHistory();
    });

    // ── Gizmo change ──
    this.gizmo.setOnChange((obj) => {
      const entityId = obj.userData?.entityId;
      if (!entityId) return;
      const entity = this.entityMap.get(entityId);
      if (!entity) return;

      // ── Position handling ──
      if (entity.type === 'door') {
        // Doors: project XZ position onto the wall line; Y stays at floor.
        const door = entity as DoorEntity;
        const t = (obj.position.x - door.wallAnchorX) * door.wallDirX + (obj.position.z - door.wallAnchorZ) * door.wallDirZ;
        const newX = parseFloat((door.wallAnchorX + t * door.wallDirX).toFixed(3));
        const newZ = parseFloat((door.wallAnchorZ + t * door.wallDirZ).toFixed(3));
        entity.transform.position.x = newX;
        entity.transform.position.y = 0;
        entity.transform.position.z = newZ;
        obj.position.set(newX, 0, newZ);
      } else {
        // All other entities: terrain-relative position.
        const terrainY = this.heightMapCtrl.getHeightAt(obj.position.x, obj.position.z);
        entity.transform.position.x = parseFloat(obj.position.x.toFixed(3));
        entity.transform.position.y = parseFloat((obj.position.y - terrainY).toFixed(3));
        entity.transform.position.z = parseFloat(obj.position.z.toFixed(3));
      }

      // All entities: rotation and scale handled identically.
      entity.transform.rotation.x = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(2));
      entity.transform.rotation.y = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(2));
      entity.transform.rotation.z = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(2));

      entity.transform.scale.x = parseFloat(obj.scale.x.toFixed(3));
      entity.transform.scale.y = parseFloat(obj.scale.y.toFixed(3));
      entity.transform.scale.z = parseFloat(obj.scale.z.toFixed(3));

      // Doors: keep the world-map segment in sync after position and scale are written.
      if (entity.type === 'door') {
        this.updateDoorWorldSegment(entity as DoorEntity);
      }

      this.rightPanel.refresh();
    });

    // ── Selection change ──
    this.selection.onSelectionChange((entityId) => {
      if (entityId) {
        const entity = this.entityMap.get(entityId);
        this.rightPanel.inspectEntity(entity ?? null);

        const mesh = this.meshMap.get(entityId);
        if (mesh && entity) {
          this.gizmo.attach(mesh);
          const tool = this.leftPanel.getTool();
          if (tool === 'translate' || tool === 'rotate' || tool === 'scale') {
            this.gizmo.setMode(tool as GizmoMode);
          }
          this.setGizmoSpaceForTool(this.leftPanel.getTool(), entity.type);
        } else {
          this.gizmo.detach();
        }
      } else {
        this.rightPanel.inspectEntity(null);
        this.gizmo.detach();
      }
    });

    // ── Input bindings for World Map ──
    canvas.addEventListener('pointerdown', (e) => {
      if (this.currentMode === 'world') {
         this.worldMapCtrl.handlePointerDown(e);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.currentMode === 'world') {
         this.worldMapCtrl.handlePointerMove(e);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.currentMode === 'world') {
         this.worldMapCtrl.handlePointerUp(e);
      }
    });

    this.setupDragDrop(container);
    this.bottomPanel.onAddEntity((dragData) => {
      this.addEntityFromBrowser(dragData);
    });

    this.viewport.onRender(() => {
      this.selection.update();
    });

    // ── Camera Preview Panel ──
    this.cameraPreview = new CameraPreviewPanel(
      container,
      this.viewport.renderer,
      this.viewport.scene,
    );
    this.viewport.onPostRender(() => {
      this.cameraPreview.render();
    });

    this.setupKeyboardShortcuts();

    this.tryRestoreWorld();
    this.fetchAndSetAssets();
    
    // Default to World Map
    this.topPanel.setMode('world');
    this.viewport.start();

    console.log('🗺️ Heel Quest Map Editor initialized');
  }

  // ═══════════════════════════════════════════════════════════════════

  private handleModeChange(mode: EditorMode) {
    this.currentMode = mode;
    this.selection.deselect();
    this.leftPanel.setMode(mode);
    this.rightPanel.inspectEntity(null);

    if (mode === 'world') {
      this.selection.enabled = false;
      this.roomGroup.visible = false;
      this.gizmo.detach();
      this.worldMapCtrl.activate();
      this.heightMapCtrl.deactivate();
      this.worldMapCtrl.setTool(this.leftPanel.getTool());
      if (this.floorMesh) this.floorMesh.visible = true;
      this.cameraPreview.hide();
      this.refreshOutliner();
      this.toast('Draw room shape outline on the grid', 'info');
    } else if (mode === 'height') {
      this.selection.enabled = false;
      this.worldMapCtrl.deactivate();
      this.gizmo.detach();
      this.roomGroup.visible = true;
      if (this.floorMesh) this.floorMesh.visible = false;
      if (!this.activeRoom && this.world.rooms.length > 0) {
        this.selectRoom(this.world.rooms[0].id);
      }
      if (this.activeRoom) {
        this.heightMapCtrl.activate(this.activeRoom);
      }
      this.cameraPreview.hide();
      this.refreshOutliner();
      this.toast('Click to add elevation nodes. Enter to finalize a ridge line.', 'info');
    } else {
      this.selection.enabled = true;
      this.worldMapCtrl.deactivate();
      this.heightMapCtrl.deactivate();
      this.roomGroup.visible = true;
      if (this.floorMesh) this.floorMesh.visible = true;
      if (!this.activeRoom && this.world.rooms.length > 0) {
        this.selectRoom(this.world.rooms[0].id);
      }
      this.refreshOutliner();
      this.cameraPreview.show();
    }
  }
  
  private selectRoom(id: string) {
    const room = this.world.rooms.find(r => r.id === id);
    if (!room) return;
    
    this.world.activeRoomId = id;
    this.activeRoom = room;
    this.heightMapCtrl.setRoom(room);
    this.menuBar.updateRoomInfo(room.name, room.id);
    
    // Rebuild room 3D meshes (precautionary)
    this.rebuildRoomView();
    this.refreshOutliner();
    
    if (this.currentMode === 'world') {
       this.rightPanel.inspectRoom(room);
       this.worldMapCtrl.rebuildRooms();
    } else {
       this.rightPanel.inspectEntity(null);
    }
  }

  private rebuildRoomView() {
    this.selection.deselect();
    // Clear old entities
    for (const [, mesh] of this.meshMap) {
      this.roomGroup.remove(mesh);
      this.disposeMesh(mesh);
    }
    this.meshMap.clear();
    this.entityMap.clear();

    if (!this.activeRoom) return;

    for (const entity of this.activeRoom.entities) {
      this.entityMap.set(entity.id, entity);
      const obj = this.factory.create(entity);
      // Offset mesh Y by terrain height at the entity's XZ position
      const terrainY = this.heightMapCtrl.getHeightAt(entity.transform.position.x, entity.transform.position.z);
      obj.position.y += terrainY;
      this.meshMap.set(entity.id, obj);
      this.roomGroup.add(obj);
    }

    this.rebuildFloorAndWalls();
  }

  /** Update all entity mesh Y-positions to reflect current terrain heights */
  private refreshEntityTerrainY() {
    if (!this.activeRoom) return;
    for (const entity of this.activeRoom.entities) {
      const mesh = this.meshMap.get(entity.id);
      if (!mesh) continue;
      const t = entity.transform;
      const terrainY = this.heightMapCtrl.getHeightAt(t.position.x, t.position.z);
      mesh.position.y = t.position.y + terrainY;
    }
  }

  private rebuildFloorAndWalls() {
    if (this.floorMesh) {
      this.roomGroup.remove(this.floorMesh);
      this.floorMesh.geometry.dispose();
      (this.floorMesh.material as THREE.Material).dispose();
      this.floorMesh = null;
    }
    if (this.wallsMesh) {
      this.roomGroup.remove(this.wallsMesh);
      this.wallsMesh.geometry.dispose();
      (this.wallsMesh.material as THREE.Material).dispose();
      this.wallsMesh = null;
    }

    if (!this.activeRoom || this.activeRoom.outline.length < 3) return;

    const outline = WorldMapController.expandOutline(
      this.activeRoom.outline,
      this.activeRoom.cornerRadii
    );

    // ── Terrain-displaced subdivided floor ─────────────────────────
    // Compute AABB of the outline
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const v of outline) {
      minX = Math.min(minX, v.x); minZ = Math.min(minZ, v.y);
      maxX = Math.max(maxX, v.x); maxZ = Math.max(maxZ, v.y);
    }
    const fw = maxX - minX + 1;
    const fd = maxZ - minZ + 1;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    const FLOOR_SEGS = 48;
    const floorGeo = new THREE.PlaneGeometry(fw, fd, FLOOR_SEGS, FLOOR_SEGS);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(cx, 0, cz);

    // Displace vertices by terrain height
    const posAttr = floorGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      posAttr.setY(i, this.heightMapCtrl.getHeightAt(vx, vz));
    }
    posAttr.needsUpdate = true;
    floorGeo.computeVertexNormals();

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a2030, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.receiveShadow = true;
    this.roomGroup.add(this.floorMesh);

    // ── Walls (unchanged — built from outline vertices) ────────────
    const wallHeight = 3;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x223344, side: THREE.DoubleSide });
    const N = outline.length;
    const wPos = new Float32Array(N * 2 * 3);
    const wUVs = new Float32Array(N * 2 * 2);
    const wIdx: number[] = [];
    const wSeg: number[] = [];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const dx = outline[j].x - outline[i].x, dy = outline[j].y - outline[i].y;
      wSeg.push(Math.sqrt(dx * dx + dy * dy));
    }
    let wLen = 0;
    for (let i = 0; i < N; i++) {
      const p = outline[i], u = wLen / wallHeight;
      const baseY = this.heightMapCtrl.getHeightAt(p.x, p.y);
      wPos[i*6]   = p.x; wPos[i*6+1] = baseY;              wPos[i*6+2] = p.y;
      wPos[i*6+3] = p.x; wPos[i*6+4] = baseY + wallHeight; wPos[i*6+5] = p.y;
      wUVs[i*4] = u; wUVs[i*4+1] = 0; wUVs[i*4+2] = u; wUVs[i*4+3] = 1;
      wLen += wSeg[i];
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, bl = i*2, tl = i*2+1, br = j*2, tr = j*2+1;
      wIdx.push(bl, br, tr,  bl, tr, tl);
    }
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
    wallGeo.setAttribute('uv',       new THREE.BufferAttribute(wUVs, 2));
    wallGeo.setIndex(wIdx);
    wallGeo.computeVertexNormals();
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    this.wallsMesh = wallMesh;
    this.roomGroup.add(wallMesh);
  }

  /**
   * Automatically place a DoorEntity in each room that shares a drawn door segment.
   * Called by WorldMapController after a door line is finalized.
   * Each room gets its own door entity with targetRoomId pointing to the other room.
   * The door is rotated to be parallel to the wall, sized to match the drawn segment,
   * and starts from the floor (position.y = 0).
   */
  private autoPlaceDoorEntities(
    doorId: string, midX: number, midZ: number,
    room1Id: string, room2Id: string | null,
    dirX: number, dirZ: number, halfLen: number
  ) {
    const roomIds = [room1Id, room2Id].filter(Boolean) as string[];
    if (roomIds.length === 0) return;

    // Rotation.y that aligns local-X of the box with the wall direction (dirX, 0, dirZ)
    // Formula: atan2(-dirZ, dirX) satisfies cos(θ)=dirX, sin(θ)=-dirZ in Three.js
    const wallAngleDeg = parseFloat(
      THREE.MathUtils.radToDeg(Math.atan2(-dirZ, dirX)).toFixed(2)
    );
    // Door width = full segment length; height = standard door; depth = thin
    const doorWidth = parseFloat((halfLen * 2).toFixed(3));

    for (const roomId of roomIds) {
      const room = this.world.rooms.find(r => r.id === roomId);
      if (!room) continue;

      const otherRoomId = roomIds.find(id => id !== roomId) ?? '';

      const entity = createDefaultEntity('door') as DoorEntity;
      entity.id = `${doorId}_${roomId}`;
      entity.name = 'Door';
      entity.targetRoomId = otherRoomId;
      entity.targetSpawnId = '';
      // Position at the door midpoint on the floor
      entity.transform.position = { x: midX, y: 0, z: midZ };
      // Rotate so the door is parallel to the wall
      entity.transform.rotation = { x: 0, y: wallAngleDeg, z: 0 };
      // Scale to match drawn segment: width, standard height, protrudes 0.175 on each side
      entity.transform.scale = { x: doorWidth, y: 2.5, z: 0.35 };
      // Store wall mounting metadata
      entity.wallDirX = dirX;
      entity.wallDirZ = dirZ;
      entity.wallAnchorX = midX;  // initial midpoint on the wall line acts as anchor
      entity.wallAnchorZ = midZ;
      entity.worldDoorId = doorId;

      // Track which world door this entity belongs to
      this.doorEntityToWorldDoor.set(entity.id, doorId);

      // Insert directly into the room's entity list
      room.entities.push(entity);
      this.entityMap.set(entity.id, entity);

      // If this room is the currently active room, also add the mesh
      if (room === this.activeRoom) {
        const obj = this.factory.create(entity);
        this.meshMap.set(entity.id, obj);
        this.roomGroup.add(obj);
      }
    }

    // Refresh scene if room view is active
    if (this.currentMode === 'room') {
      this.rebuildRoomView();
    }
    this.refreshOutliner();
  }

  public addEntity(entity: EditorEntity): THREE.Object3D {
    if (!this.activeRoom) throw new Error('No active room');

    this.entityMap.set(entity.id, entity);
    this.activeRoom.entities.push(entity);

    const obj = this.factory.create(entity);
    const terrainY = this.heightMapCtrl.getHeightAt(entity.transform.position.x, entity.transform.position.z);
    obj.position.y += terrainY;
    this.meshMap.set(entity.id, obj);
    this.roomGroup.add(obj);

    this.refreshOutliner();
    return obj;
  }

  public removeEntity(entityId: string) {
    if (!this.activeRoom) return;
    this.captureHistory();

    if (this.selection.selectedObject?.userData?.entityId === entityId) {
      this.selection.deselect();
      this.gizmo.detach();
      this.rightPanel.inspectEntity(null);
    }

    const mesh = this.meshMap.get(entityId);
    if (mesh) {
      this.roomGroup.remove(mesh);
      this.disposeMesh(mesh);
      this.meshMap.delete(entityId);
    }

    const entity = this.entityMap.get(entityId);
    if (entity?.type === 'door') {
      this.removeDoorByWorldDoorId((entity as DoorEntity).worldDoorId || entity.id);
    } else {
      this.entityMap.delete(entityId);
      this.activeRoom.entities = this.activeRoom.entities.filter((e) => e.id !== entityId);
    }

    this.cleanupOrphanedWorldDoors();
    this.refreshOutliner();
    this.worldMapCtrl.rebuildRooms();
    this.toast('Entity deleted', 'info');
  }

  private removeDoorByWorldDoorId(worldDoorId: string) {
    // Remove the world door segment first.
    this.world.doors = this.world.doors.filter((door) => door.id !== worldDoorId);

    for (const room of this.world.rooms) {
      const removed = room.entities.filter((e) => e.type === 'door' && (e as DoorEntity).worldDoorId === worldDoorId);
      for (const doorEntity of removed) {
        const mesh = this.meshMap.get(doorEntity.id);
        if (mesh) {
          this.roomGroup.remove(mesh);
          this.disposeMesh(mesh);
          this.meshMap.delete(doorEntity.id);
        }
        this.entityMap.delete(doorEntity.id);
      }
      room.entities = room.entities.filter((e) => !(e.type === 'door' && (e as DoorEntity).worldDoorId === worldDoorId));
    }

    this.cleanupOrphanedWorldDoors();

    if (this.activeRoom && this.activeRoom.entities.every((e) => e.type !== 'door' || (e as DoorEntity).worldDoorId !== worldDoorId)) {
      // If the active room lost a selected door, clear the selection.
      if (this.selection.selectedObject?.userData?.entityId) {
        const selectedId = this.selection.selectedObject.userData.entityId;
        const selectedEntity = this.entityMap.get(selectedId);
        if (!selectedEntity || selectedEntity.type === 'door') {
          this.selection.deselect();
          this.gizmo.detach();
          this.rightPanel.inspectEntity(null);
        }
      }
    }
  }

  private cleanupOrphanedWorldDoors() {
    const referencedDoorIds = new Set<string>();
    for (const room of this.world.rooms) {
      for (const entity of room.entities) {
        if (entity.type === 'door' && (entity as DoorEntity).worldDoorId) {
          referencedDoorIds.add((entity as DoorEntity).worldDoorId);
        }
      }
    }
    this.world.doors = this.world.doors.filter((door) => referencedDoorIds.has(door.id));
  }

  public removeRoom(roomId: string) {
    this.captureHistory();
    this.world.rooms = this.world.rooms.filter(r => r.id !== roomId);
    if (this.world.activeRoomId === roomId) {
        this.world.activeRoomId = '';
        this.activeRoom = null;
        this.rightPanel.inspectRoom(null);
    }
    this.worldMapCtrl.rebuildRooms();
    this.rebuildRoomView();
    this.refreshOutliner();
    this.toast('Room deleted', 'info');
  }

  private handleMenuAction(action: MenuAction) {
    if (action === 'new') this.newWorld();
    if (action === 'save') this.saveWorld();
    if (action === 'load') this.loadWorld();
    if (action === 'export') this.exportWorld();
  }

  private handleToolChange(tool: ToolType) {
    if (this.currentMode === 'world') {
       this.worldMapCtrl.setTool(tool);
    }

    if (this.currentMode === 'height') {
      if (tool === 'height-point' || tool === 'height-line') {
        this.heightMapCtrl.setTool(tool as HeightTool);
      } else if (tool === 'select') {
        this.heightMapCtrl.setTool('height-select');
      }
    }

    if (tool === 'select') this.gizmo.detach();
    if (['translate', 'rotate', 'scale'].includes(tool)) {
      this.gizmo.setMode(tool as GizmoMode);
      if (this.selection.selectedObject) {
        this.gizmo.attach(this.selection.selectedObject);
        const selectedId = this.selection.selectedObject.userData?.entityId;
        const selectedEntity = selectedId ? this.entityMap.get(selectedId) : null;
        this.setGizmoSpaceForTool(tool, selectedEntity?.type);
      }
    }
  }

  private selectWorldDoor(worldDoorId: string) {
    const matching = this.world.rooms
      .map((room) => ({ room, door: room.entities.find((e) => e.type === 'door' && (e as DoorEntity).worldDoorId === worldDoorId) }))
      .filter((entry) => entry.door) as Array<{ room: RoomData; door: DoorEntity }>;

    if (matching.length === 0) {
      this.toast('Door not found in any room', 'error');
      return;
    }

    const { room, door } = matching[0];
    this.selectRoom(room.id);
    this.topPanel.setMode('room');

    const mesh = this.meshMap.get(door.id);
    if (mesh) {
      this.selection.select(mesh);
      this.gizmo.attach(mesh);
    }
  }

  private setGizmoSpaceForTool(tool: string, entityType?: string) {
    if (tool === 'rotate' || tool === 'scale') {
      this.gizmo.transformControls.setSpace('local');
      return;
    }

    this.gizmo.transformControls.setSpace('world');
  }

  private handleEntityChange(entity: EditorEntity) {
    const mesh = this.meshMap.get(entity.id);
    if (!mesh) return;

    const t = entity.transform;
    // entity.position.y is offset above terrain; add terrain height to get world Y
    const terrainY = this.heightMapCtrl.getHeightAt(t.position.x, t.position.z);
    mesh.position.set(t.position.x, t.position.y + terrainY, t.position.z);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(t.rotation.x),
      THREE.MathUtils.degToRad(t.rotation.y),
      THREE.MathUtils.degToRad(t.rotation.z)
    );
    mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
    mesh.visible = entity.visible;

    if (entity.type === 'door') {
      this.updateDoorWorldSegment(entity as DoorEntity);
    }
  }

  /**
   * Updates the world.doors segment endpoints to match this door entity's
   * current position and scale. No partner sync — each door is independent.
   */
  private updateDoorWorldSegment(door: DoorEntity) {
    if (!door.worldDoorId) return;
    const worldDoor = this.world.doors.find((d) => d.id === door.worldDoorId);
    if (!worldDoor) return;

    const halfLen = Math.abs(door.transform.scale.x) / 2;
    const midX = door.transform.position.x;
    const midZ = door.transform.position.z;
    worldDoor.points = [
      { x: parseFloat((midX - door.wallDirX * halfLen).toFixed(3)), y: parseFloat((midZ - door.wallDirZ * halfLen).toFixed(3)) },
      { x: parseFloat((midX + door.wallDirX * halfLen).toFixed(3)), y: parseFloat((midZ + door.wallDirZ * halfLen).toFixed(3)) }
    ];
    this.worldMapCtrl.rebuildRooms();

    for (const room of this.world.rooms) {
      for (const entity of room.entities) {
        if (entity.type === 'door' && entity.id !== door.id && (entity as DoorEntity).worldDoorId === door.worldDoorId) {
          const partner = entity as DoorEntity;
          partner.transform.scale.x = door.transform.scale.x;
          partner.transform.scale.y = door.transform.scale.y;
          partner.transform.scale.z = door.transform.scale.z;

          const partnerMesh = this.meshMap.get(partner.id);
          if (partnerMesh) {
            partnerMesh.scale.set(partner.transform.scale.x, partner.transform.scale.y, partner.transform.scale.z);
          }
        }
      }
    }
  }

  private addEntityFromBrowser(dragData: DragData) {
    if (!this.activeRoom) return this.toast('Select a room first!', 'error');

    this.captureHistory();

    const entity = createDefaultEntity(dragData.entityType as EntityType);
    const target = this.viewport.controls.target;
    entity.transform.position.x = Math.round(target.x * 2) / 2;
    entity.transform.position.z = Math.round(target.z * 2) / 2;

    if (entity.type === 'primitive' && dragData.subType) {
      (entity as PrimitiveEntity).geometryType = dragData.subType as any;
      // If asset path provided, apply texture
      if (dragData.assetPath) {
        (entity as PrimitiveEntity).materialType = 'textured';
        (entity as PrimitiveEntity).textureSource = dragData.assetPath;
      }
    }

    if (entity.type === 'spawn' && dragData.subType === 'customer') {
      entity.name = 'Customer Spawn';
      (entity as SpawnEntity).spawnId = 'spawn_customer';
    }

    if (entity.type === 'door' && dragData.assetPath) {
      (entity as DoorEntity).textureSource = dragData.assetPath;
      (entity as DoorEntity).materialType = 'textured';
    }

    const obj = this.addEntity(entity);
    this.selection.select(obj);
    this.toast(`Added ${entity.type}`, 'success');
  }

  private setupDragDrop(container: HTMLElement) {
    container.addEventListener('dragover', (e) => { e.preventDefault(); container.classList.add('drag-over'); });
    container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      container.classList.remove('drag-over');
      if (this.currentMode !== 'room') return this.toast('Switch to Room Map to add entities', 'error');

      const raw = e.dataTransfer?.getData('application/json');
      if (!raw) return;

      let dragData: DragData;
      try { dragData = JSON.parse(raw); } catch { return; }

      const pos = this.viewport.screenToFloor(e.clientX, e.clientY);
      if (!pos) return;
      pos.x = Math.round(pos.x * 2) / 2;
      pos.z = Math.round(pos.z * 2) / 2;

      const entity = createDefaultEntity(dragData.entityType as EntityType);
      entity.transform.position.x = pos.x;
      entity.transform.position.z = pos.z;

      if (entity.type === 'primitive' && dragData.subType) {
        (entity as PrimitiveEntity).geometryType = dragData.subType as any;
        if (dragData.assetPath) {
          (entity as PrimitiveEntity).materialType = 'textured';
          (entity as PrimitiveEntity).textureSource = dragData.assetPath;
        }
      }
      if (entity.type === 'door' && dragData.assetPath) {
        (entity as DoorEntity).textureSource = dragData.assetPath;
        (entity as DoorEntity).materialType = 'textured';
      }
      const obj = this.addEntity(entity);
      this.selection.select(obj);
      this.toast(`Added ${entity.type}`, 'success');
    });
  }

  private setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (this.currentMode === 'world') {
          this.worldMapCtrl.handleKeyDown(e);
      }

      // Use e.code for layout-independent shortcuts (physical key position)
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyZ') {
        e.preventDefault(); this.redo(); return;
      }
      if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); this.undo(); return; }

      if (e.ctrlKey && e.code === 'KeyC') { e.preventDefault(); this.copySelected(); return; }
      if (e.ctrlKey && e.code === 'KeyV') { e.preventDefault(); this.paste(); return; }

      if (e.code === 'Delete' || e.code === 'Backspace') {
        const selected = this.selection.selectedObject;
        if (selected?.userData?.entityId) this.removeEntity(selected.userData.entityId);
      }
      if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); this.saveWorld(); }
      if (e.ctrlKey && e.code === 'KeyE') { e.preventDefault(); this.exportWorld(); }
      if (e.ctrlKey && e.code === 'KeyN') { e.preventDefault(); this.newWorld(); }
      if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
      if (e.code === 'KeyF') this.focusOnSelection();
      if (e.code === 'Escape') {
        this.focusedObject = null;
        this.isolatedObjectId = null;
        this.selection.isLocked = false;
        this.restoreAllObjectsVisibility();
        this.selection.select(null);
      }
    });
  }

  private newWorld() {
    if (this.world.rooms.length > 0 && !confirm('Create new world? Changes will be lost.')) return;
    this.world = createDefaultWorld();
    this.worldMapCtrl.setWorld(this.world);
    this.activeRoom = null;
    this.rebuildRoomView();
    this.toast('New world created', 'info');
  }

  private async saveWorld() {
    this.syncSpawnPoints();
    const result = await this.serializer.saveToStorage(this.world);
    this.menuBar.updateSaveStatus(result.localSaved, result.engineSynced, result.timestamp, result.error);
    if (result.engineSynced) {
      this.toast('World saved & synced', 'success');
    } else if (result.localSaved) {
      this.toast('World saved locally (sync failed)', 'info');
    }
  }

  private loadWorld() {
    const world = this.serializer.loadFromStorage();
    if (world) {
      this.world = world;
      this.worldMapCtrl.setWorld(this.world);
      if (this.world.activeRoomId) this.selectRoom(this.world.activeRoomId);
      this.toast('World loaded', 'success');
    } else {
      this.toast('No saved world found', 'error');
    }
  }

  private exportWorld() {
    this.syncSpawnPoints();
    this.serializer.downloadJSON(this.world);
    this.toast('Exported JSON', 'success');
  }

  private tryRestoreWorld() {
    const world = this.serializer.loadFromStorage();
    if (world && world.rooms.length > 0) {
      this.world = world;
      this.worldMapCtrl.setWorld(this.world);
      if (this.world.activeRoomId) this.selectRoom(this.world.activeRoomId);
    }
  }

  private syncSpawnPoints() {
    for (const room of this.world.rooms) {
      room.spawnPoints = room.entities
        .filter((e) => e.type === 'spawn')
        .map((e) => ({ id: (e as any).spawnId || 'spawn', position: { ...e.transform.position } }));
    }
  }

  private duplicateSelected() {
    if (!this.activeRoom) return;
    const selected = this.selection.selectedObject;
    if (!selected?.userData?.entityId) return;

    this.captureHistory();

    const sourceEntity = this.entityMap.get(selected.userData.entityId);
    if (!sourceEntity) return;

    const clone = createDefaultEntity(sourceEntity.type, `${sourceEntity.name} (copy)`);
    Object.assign(clone, { ...JSON.parse(JSON.stringify(sourceEntity)), id: clone.id, name: clone.name });
    clone.transform.position.x += 1;
    clone.transform.position.z += 1;

    const obj = this.addEntity(clone);
    this.selection.select(obj);
  }

  private copySelected() {
    const selected = this.selection.selectedObject;
    if (!selected?.userData?.entityId) return;

    const sourceEntity = this.entityMap.get(selected.userData.entityId);
    if (!sourceEntity) return;

    // Store a deep clone in internal clipboard
    this.clipboard = JSON.parse(JSON.stringify(sourceEntity));
    this.toast(`Copied ${sourceEntity.name}`, 'info');
  }

  private paste() {
    if (!this.activeRoom || !this.clipboard) return;

    this.captureHistory();

    // Use factory to get a fresh ID and common defaults if needed, then overlay clipboard data
    const clone = createDefaultEntity(this.clipboard.type, `${this.clipboard.name} (copy)`);
    Object.assign(clone, { ...JSON.parse(JSON.stringify(this.clipboard)), id: clone.id });
    
    // Offset slightly so it's not perfectly overlapping
    clone.transform.position.x += 1;
    clone.transform.position.z += 1;

    const obj = this.addEntity(clone);
    this.selection.select(obj);
    this.toast(`Pasted ${clone.name}`, 'info');
  }

  private focusOnSelection() {
    const s = this.selection.selectedObject;
    if (s) {
      this.focusedObject = s;
      this.selection.isLocked = true;
      this.toast('Selection locked & Camera focused (Escape to release)', 'info');
    } else {
      this.focusedObject = null;
      this.selection.isLocked = false;
      this.viewport.controls.target.set(0, 0, 0);
    }
  }

  private alignSelectionToGrid() {
    const selected = this.selection.selectedObject;
    if (!selected?.userData?.entityId) return;
    const entity = this.entityMap.get(selected.userData.entityId);
    if (!entity) return;

    this.captureHistory();
    entity.transform.position.x = parseFloat((Math.round(entity.transform.position.x / GRID_SNAP) * GRID_SNAP).toFixed(3));
    entity.transform.position.z = parseFloat((Math.round(entity.transform.position.z / GRID_SNAP) * GRID_SNAP).toFixed(3));
    entity.transform.rotation.y = parseFloat((Math.round(entity.transform.rotation.y / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES).toFixed(2));

    this.refreshEntityMesh(entity);
    this.worldMapCtrl.rebuildRooms();
    this.refreshOutliner();
    this.toast('Aligned to grid', 'success');
  }

  private toggleHideOthers() {
    const selected = this.selection.selectedObject;
    if (!selected?.userData?.entityId) return;

    if (this.isolatedObjectId === selected.userData.entityId) {
      this.isolatedObjectId = null;
      this.restoreAllObjectsVisibility();
      this.toast('Showing all objects', 'info');
      return;
    }

    this.isolatedObjectId = selected.userData.entityId;
    for (const [id, mesh] of this.meshMap) {
      mesh.visible = id === this.isolatedObjectId ? true : false;
    }
    this.toast('Hiding other objects', 'info');
  }

  private restoreAllObjectsVisibility() {
    if (!this.activeRoom) return;
    for (const entity of this.activeRoom.entities) {
      const mesh = this.meshMap.get(entity.id);
      if (!mesh) continue;
      mesh.visible = entity.visible;
    }
  }

  private dropSelectionToFloor() {
    const selected = this.selection.selectedObject;
    if (!selected?.userData?.entityId) return;
    const entity = this.entityMap.get(selected.userData.entityId);
    if (!entity) return;

    this.captureHistory();
    entity.transform.position.y = 0;
    this.refreshEntityMesh(entity);
    this.toast('Dropped to floor', 'success');
  }

  private selectPartnerDoor() {
    const selected = this.selection.selectedObject;
    if (!selected?.userData?.entityId) return;
    const entity = this.entityMap.get(selected.userData.entityId);
    if (!entity || entity.type !== 'door') return;

    const door = entity as DoorEntity;
    if (!door.worldDoorId) {
      this.toast('Door has no partner link', 'error');
      return;
    }

    let partner: EditorEntity | null = null;
    let partnerRoom: RoomData | null = null;
    for (const room of this.world.rooms) {
      for (const roomEntity of room.entities) {
        if (roomEntity.type === 'door' && (roomEntity as DoorEntity).worldDoorId === door.worldDoorId && roomEntity.id !== door.id) {
          partner = roomEntity;
          partnerRoom = room;
          break;
        }
      }
      if (partner) break;
    }

    if (!partner || !partnerRoom) {
      this.toast('No door partner found', 'error');
      return;
    }

    if (partnerRoom !== this.activeRoom) {
      this.selectRoom(partnerRoom.id);
    }

    const mesh = this.meshMap.get(partner.id);
    if (mesh) this.selection.select(mesh);
    this.toast(`Selected partner door in ${partnerRoom.name || partnerRoom.id}`, 'success');
  }

  private groupSelection() {
    this.toast('Group/Ungroup requires multi-selection support', 'info');
  }

  private showContextMenu(x: number, y: number) {
    const selected = this.selection.selectedObject;
    const hasSelection = !!selected;
    const selectedEntity = hasSelection ? this.entityMap.get(selected!.userData.entityId) : null;
    const isIsolated = selected?.userData?.entityId && this.isolatedObjectId === selected.userData.entityId;

    const options: ContextMenuOption[] = [
      {
        id: 'focus',
        label: 'Focus Camera',
        keyboardShortcut: 'F',
        disabled: !hasSelection,
        action: () => this.focusOnSelection()
      },
      {
        id: 'release-focus',
        label: 'Release Focus',
        keyboardShortcut: 'Esc',
        disabled: !this.focusedObject,
        action: () => {
          this.focusedObject = null;
          this.selection.isLocked = false;
          this.restoreAllObjectsVisibility();
        }
      },
      {
        id: 'align',
        label: 'Align to Grid',
        keyboardShortcut: 'G',
        disabled: !hasSelection,
        action: () => this.alignSelectionToGrid()
      },
      {
        id: 'hide-others',
        label: isIsolated ? 'Show Others' : 'Hide Others',
        keyboardShortcut: 'H',
        disabled: !hasSelection,
        action: () => this.toggleHideOthers()
      },
      {
        id: 'drop-to-floor',
        label: 'Drop to Floor',
        keyboardShortcut: 'D',
        disabled: !hasSelection,
        action: () => this.dropSelectionToFloor()
      },
      {
        id: 'select-partner',
        label: 'Select Partner',
        keyboardShortcut: 'P',
        disabled: !hasSelection || selectedEntity?.type !== 'door',
        action: () => this.selectPartnerDoor()
      },
      { id: 'divider-1', label: '', divider: true, action: () => {} },
      {
        id: 'copy',
        label: 'Copy',
        keyboardShortcut: 'Ctrl+C',
        disabled: !hasSelection,
        action: () => this.copySelected()
      },
      {
        id: 'paste',
        label: 'Paste',
        keyboardShortcut: 'Ctrl+V',
        disabled: !this.clipboard,
        action: () => this.paste()
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        keyboardShortcut: 'Ctrl+D',
        disabled: !hasSelection,
        action: () => this.duplicateSelected()
      },
      {
        id: 'group',
        label: 'Group / Ungroup',
        keyboardShortcut: 'Ctrl+G',
        disabled: true,
        action: () => this.groupSelection()
      },
      { id: 'divider-2', label: '', divider: true, action: () => {} },
      {
        id: 'undo',
        label: 'Undo',
        keyboardShortcut: 'Ctrl+Z',
        action: () => this.undo()
      },
      {
        id: 'redo',
        label: 'Redo',
        keyboardShortcut: 'Ctrl+Shift+Z',
        action: () => this.redo()
      },
      { id: 'divider-3', label: '', divider: true, action: () => {} },
      {
        id: 'delete',
        label: 'Delete',
        keyboardShortcut: 'Del',
        disabled: !hasSelection,
        action: () => {
          if (selected?.userData?.entityId) this.removeEntity(selected.userData.entityId);
        }
      }
    ];

    this.contextMenu.show(x, y, options);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Camera Flight Mode
  // ═══════════════════════════════════════════════════════════════════

  private toggleFlightMode(cameraEntity: CameraEntity, activate: boolean) {
    if (activate && !this.flightMode) {
      this.enterFlightMode(cameraEntity);
    } else if (this.flightMode) {
      this.exitFlightMode();
    }
  }

  private enterFlightMode(cameraEntity: CameraEntity) {
    this.flightMode = true;
    this.flightCameraEntity = cameraEntity;

    // Save editor camera state
    this.savedCameraPos.copy(this.viewport.camera.position);
    this.savedCameraRot.copy(this.viewport.camera.rotation);

    // Snap to camera entity transform
    const t = cameraEntity.transform;
    this.viewport.camera.position.set(t.position.x, t.position.y, t.position.z);
    this.viewport.camera.rotation.set(
      THREE.MathUtils.degToRad(t.rotation.x),
      THREE.MathUtils.degToRad(t.rotation.y),
      THREE.MathUtils.degToRad(t.rotation.z)
    );
    this.viewport.camera.fov = cameraEntity.fov;
    this.viewport.camera.updateProjectionMatrix();

    // Disable orbit controls
    this.viewport.controls.enabled = false;
    this.gizmo.detach();

    // Bind WASD + mouse look
    this.flightKeys = {};
    this.flightKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this.exitFlightMode(); return; }
      this.flightKeys[e.key.toLowerCase()] = true;
    };
    this.flightKeyUpHandler = (e: KeyboardEvent) => {
      this.flightKeys[e.key.toLowerCase()] = false;
    };
    document.addEventListener('keydown', this.flightKeyHandler);
    document.addEventListener('keyup', this.flightKeyUpHandler);

    // Mouse look
    const canvas = this.viewport.renderer.domElement;
    canvas.requestPointerLock();

    const mouseMoveHandler = (e: MouseEvent) => {
      if (!this.flightMode) return;
      const sensitivity = 0.002;
      this.viewport.camera.rotation.y -= e.movementX * sensitivity;
      this.viewport.camera.rotation.x -= e.movementY * sensitivity;
      this.viewport.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.viewport.camera.rotation.x));
    };
    document.addEventListener('mousemove', mouseMoveHandler);
    this._flightMouseHandler = mouseMoveHandler;

    // Flight update loop
    const flightUpdate = () => {
      if (!this.flightMode) return;
      const speed = 0.15;
      const forward = new THREE.Vector3();
      this.viewport.camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

      if (this.flightKeys['w']) this.viewport.camera.position.addScaledVector(forward, speed);
      if (this.flightKeys['s']) this.viewport.camera.position.addScaledVector(forward, -speed);
      if (this.flightKeys['a']) this.viewport.camera.position.addScaledVector(right, -speed);
      if (this.flightKeys['d']) this.viewport.camera.position.addScaledVector(right, speed);
      if (this.flightKeys['e'] || this.flightKeys[' ']) this.viewport.camera.position.y += speed;
      if (this.flightKeys['q']) this.viewport.camera.position.y -= speed;

      requestAnimationFrame(flightUpdate);
    };
    requestAnimationFrame(flightUpdate);

    this.toast('Flight mode ON — WASD to move, Mouse to look, ESC to exit', 'info');
  }

  private exitFlightMode() {
    if (!this.flightMode || !this.flightCameraEntity) return;

    // Save camera transform back to entity
    const cam = this.viewport.camera;
    const entity = this.flightCameraEntity;
    entity.transform.position.x = parseFloat(cam.position.x.toFixed(3));
    entity.transform.position.y = parseFloat(cam.position.y.toFixed(3));
    entity.transform.position.z = parseFloat(cam.position.z.toFixed(3));
    entity.transform.rotation.x = parseFloat(THREE.MathUtils.radToDeg(cam.rotation.x).toFixed(2));
    entity.transform.rotation.y = parseFloat(THREE.MathUtils.radToDeg(cam.rotation.y).toFixed(2));
    entity.transform.rotation.z = parseFloat(THREE.MathUtils.radToDeg(cam.rotation.z).toFixed(2));

    // Restore editor camera
    cam.position.copy(this.savedCameraPos);
    cam.rotation.copy(this.savedCameraRot);
    cam.fov = 50;
    cam.updateProjectionMatrix();

    // Re-enable controls
    this.viewport.controls.enabled = true;
    this.flightMode = false;

    // Clean up listeners
    if (this.flightKeyHandler) document.removeEventListener('keydown', this.flightKeyHandler);
    if (this.flightKeyUpHandler) document.removeEventListener('keyup', this.flightKeyUpHandler);
    if (this._flightMouseHandler) document.removeEventListener('mousemove', this._flightMouseHandler);
    this._flightMouseHandler = null;
    document.exitPointerLock();

    // Update mesh to match new entity transform
    const mesh = this.meshMap.get(entity.id);
    if (mesh) {
      mesh.position.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z);
      mesh.rotation.set(
        THREE.MathUtils.degToRad(entity.transform.rotation.x),
        THREE.MathUtils.degToRad(entity.transform.rotation.y),
        THREE.MathUtils.degToRad(entity.transform.rotation.z)
      );
    }

    // Refresh inspector
    this.rightPanel.inspectEntity(entity);

    this.flightCameraEntity = null;
    this.toast('Flight mode OFF — Camera transform saved', 'success');
  }

  private toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2000);
  }

  private disposeMesh(obj: THREE.Object3D) {
    obj.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.geometry?.dispose();
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material?.dispose();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // History — Undo / Redo
  // ═══════════════════════════════════════════════════════════════════

  private captureHistory(): void {
    if (this._suppressHistory) return;
    const snapshot = JSON.stringify(this.world);
    console.log('Capture history:', snapshot.length, 'bytes');
    this.history.push(snapshot);
  }

  private undo(): void {
    const current = JSON.stringify(this.world);
    const prev = this.history.undo(current);
    console.log('Undo. Has prev:', !!prev);
    if (prev) {
      this.restoreWorld(JSON.parse(prev));
      this.toast('Undo', 'info');
    }
  }

  private redo(): void {
    const current = JSON.stringify(this.world);
    const next = this.history.redo(current);
    console.log('Redo. Has next:', !!next);
    if (next) {
      this.restoreWorld(JSON.parse(next));
      this.toast('Redo', 'info');
    }
  }

  private restoreWorld(world: WorldProject): void {
    this.world = world;
    this.worldMapCtrl.setWorld(this.world);
    const roomId = this.world.activeRoomId;
    if (roomId && this.world.rooms.find(r => r.id === roomId)) {
      this.selectRoom(roomId);
    } else {
      this.activeRoom = null;
      this.rebuildRoomView();
      this.worldMapCtrl.rebuildRooms();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Mesh helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Recreate a single entity's Three.js mesh in-place.
   * Preserves selection state without triggering a full room rebuild.
   */
  private refreshEntityMesh(entity: EditorEntity): void {
    const oldMesh = this.meshMap.get(entity.id);
    const wasSelected = this.selection.selectedObject === oldMesh;

    if (wasSelected) this.gizmo.detach();

    if (oldMesh) {
      this.roomGroup.remove(oldMesh);
      this.disposeMesh(oldMesh);
    }

    const newMesh = this.factory.create(entity);
    const terrainY = this.heightMapCtrl.getHeightAt(
      entity.transform.position.x, entity.transform.position.z
    );
    newMesh.position.y += terrainY;
    this.meshMap.set(entity.id, newMesh);
    this.roomGroup.add(newMesh);

    if (wasSelected) {
      this.selection.select(newMesh);
      const tool = this.leftPanel.getTool();
      if (['translate', 'rotate', 'scale'].includes(tool)) {
        this.gizmo.setMode(tool as GizmoMode);
      }
      this.gizmo.attach(newMesh);
    }

    if (entity.type === 'door') {
      this.updateDoorWorldSegment(entity as DoorEntity);
    }

    this.refreshOutliner();
  }

  /** Update the scene outliner to reflect the active mode */
  private refreshOutliner(): void {
    if (this.currentMode === 'world') {
      this.rightPanel.updateWorldList(this.world.rooms, this.world.doors, this.world.activeRoomId ?? undefined);
    } else if (this.currentMode === 'height') {
      const modifiers = this.activeRoom?.heightModifiers ?? [];
      this.rightPanel.updateHeightList(modifiers, this.heightMapCtrl.getSelectedModifierId() ?? undefined);
    } else {
      const selectedId = this.selection.selectedObject?.userData?.entityId as string | undefined;
      this.rightPanel.updateEntityList(this.activeRoom?.entities ?? [], selectedId);
    }
    this.cameraPreview.updateCameraList(this.activeRoom?.entities ?? []);
  }

  /** Fetch asset list from the dev server and pass it to the inspector */
  private async fetchAndSetAssets(): Promise<void> {
    try {
      const res = await fetch('/api/assets');
      if (res.ok) {
        const data = await res.json();
        this.rightPanel.setAssets(data);
      }
    } catch { /* assets are optional */ }
  }
}
