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

import { MenuBar, type MenuAction } from './ui/MenuBar';
import { TopPanel, type EditorMode } from './ui/TopPanel';
import { LeftPanel, type ToolType } from './ui/LeftPanel';
import { BottomPanel, type DragData } from './ui/BottomPanel';
import { RightPanel } from './ui/RightPanel';

import { SceneSerializer } from './export/SceneSerializer';

import type { EditorEntity, EntityType, PrimitiveEntity, CameraEntity, DoorEntity } from './types/entities';
import { createDefaultEntity } from './types/entities';
import type { WorldProject, RoomData } from './types/scene';
import { createDefaultWorld } from './types/scene';

export class EditorApp {
  // ── State ──
  private world: WorldProject;
  private activeRoom: RoomData | null = null;

  // ── Flight mode state ──
  private flightMode = false;
  private flightCameraEntity: CameraEntity | null = null;
  private savedCameraPos: THREE.Vector3 = new THREE.Vector3();
  private savedCameraRot: THREE.Euler = new THREE.Euler();
  private flightKeys: Record<string, boolean> = {};
  private flightKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private flightKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  
  private entityMap: Map<string, EditorEntity> = new Map();
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

  // ── UI ──
  private menuBar!: MenuBar;
  private topPanel!: TopPanel;
  private leftPanel!: LeftPanel;
  private bottomPanel!: BottomPanel;
  private rightPanel!: RightPanel;

  // ── Serialization ──
  private serializer: SceneSerializer = new SceneSerializer();

  // ── Room meshes ──
  private roomGroup = new THREE.Group();
  private floorMesh: THREE.Mesh | null = null;
  private wallsMesh: THREE.Mesh | null = null;

  private currentMode: EditorMode = 'world';

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

    this.bottomPanel = new BottomPanel(
      document.getElementById('bottom-panel')!
    );

    this.rightPanel = new RightPanel(
      document.getElementById('right-panel')!,
      (target) => { this.handleEntityChange(target); this.rebuildRoomView(); this.worldMapCtrl.rebuildRooms(); }, // generic refresh
      (entityId) => this.removeEntity(entityId),
      (roomId) => this.removeRoom(roomId),
      (roomId) => { this.selectRoom(roomId); this.topPanel.setMode('room'); },
      (cameraEntity, activate) => this.toggleFlightMode(cameraEntity, activate),
      () => this.activeRoom ? this.activeRoom.entities : []
    );

    // ── Gizmo change ──
    this.gizmo.setOnChange((obj) => {
      const entityId = obj.userData?.entityId;
      if (!entityId) return;
      const entity = this.entityMap.get(entityId);
      if (!entity) return;

      // ── Door constraint: project gizmo position directly onto the wall line ──
      // This avoids all delta/start-pos drift by computing the nearest point on the
      // infinite wall line from wherever TransformControls moved the object.
      if (entity.type === 'door') {
        const door = entity as DoorEntity;
        const dirX = door.wallDirX;
        const dirZ = door.wallDirZ;
        const ancX = door.wallAnchorX;
        const ancZ = door.wallAnchorZ;

        // Project obj's current world-XZ position onto the wall line:
        //   t = dot(obj_pos - anchor, wallDir)
        //   projected = anchor + t * wallDir
        const t = (obj.position.x - ancX) * dirX + (obj.position.z - ancZ) * dirZ;
        const newX = parseFloat((ancX + t * dirX).toFixed(3));
        const newZ = parseFloat((ancZ + t * dirZ).toFixed(3));
        const wallAngleRad = Math.atan2(-dirZ, dirX);

        // Update entity data
        entity.transform.position.x = newX;
        entity.transform.position.y = 0;
        entity.transform.position.z = newZ;
        entity.transform.rotation.x = 0;
        entity.transform.rotation.y = parseFloat(THREE.MathUtils.radToDeg(wallAngleRad).toFixed(2));
        entity.transform.rotation.z = 0;
        // Scale is intentionally not touched — stays as set at creation

        // Snap the Three.js object back so the gizmo reflects reality exactly
        obj.position.set(newX, 0, newZ);
        obj.rotation.set(0, wallAngleRad, 0);

        // Sync the world-map door segment midpoint
        const worldDoor = this.world.doors.find(d => d.id === door.worldDoorId);
        if (worldDoor) {
          const segHalfLen = Math.sqrt(
            (worldDoor.points[1].x - worldDoor.points[0].x) ** 2 +
            (worldDoor.points[1].y - worldDoor.points[0].y) ** 2
          ) / 2;
          worldDoor.points[0] = { x: newX - dirX * segHalfLen, y: newZ - dirZ * segHalfLen };
          worldDoor.points[1] = { x: newX + dirX * segHalfLen, y: newZ + dirZ * segHalfLen };
          this.worldMapCtrl.rebuildRooms();

          // Sync partner door entities in all other rooms
          for (const room of this.world.rooms) {
            if (room === this.activeRoom) continue;
            for (const e of room.entities) {
              if (e.type === 'door' && (e as DoorEntity).worldDoorId === door.worldDoorId) {
                e.transform.position.x = newX;
                e.transform.position.y = 0;
                e.transform.position.z = newZ;
              }
            }
          }
        }

        this.rightPanel.refresh();
        return;
      }

      entity.transform.position.x = parseFloat(obj.position.x.toFixed(3));
      entity.transform.position.y = parseFloat(obj.position.y.toFixed(3));
      entity.transform.position.z = parseFloat(obj.position.z.toFixed(3));

      entity.transform.rotation.x = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(2));
      entity.transform.rotation.y = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(2));
      entity.transform.rotation.z = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(2));

      entity.transform.scale.x = parseFloat(obj.scale.x.toFixed(3));
      entity.transform.scale.y = parseFloat(obj.scale.y.toFixed(3));
      entity.transform.scale.z = parseFloat(obj.scale.z.toFixed(3));

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
          // Doors are always in translate-only world-space mode; no rotate/scale.
          if (entity.type === 'door') {
            this.gizmo.transformControls.setMode('translate');
            this.gizmo.transformControls.setSpace('world');
          } else {
            const tool = this.leftPanel.getTool();
            if (tool === 'translate' || tool === 'rotate' || tool === 'scale') {
              this.gizmo.setMode(tool as GizmoMode);
            }
            this.gizmo.transformControls.setSpace('world');
          }
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

    this.setupKeyboardShortcuts();

    this.tryRestoreWorld();
    
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
    
    if (mode === 'world') {
      this.roomGroup.visible = false;
      this.gizmo.detach();
      this.worldMapCtrl.activate();
      // Ensure worldMapCtrl matches leftPanel tool
      this.worldMapCtrl.setTool(this.leftPanel.getTool());
      this.toast('Draw room shape outline on the grid', 'info');
    } else {
      this.worldMapCtrl.deactivate();
      this.roomGroup.visible = true;
      if (!this.activeRoom && this.world.rooms.length > 0) {
        this.selectRoom(this.world.rooms[0].id);
      }
    }
  }
  
  private selectRoom(id: string) {
    const room = this.world.rooms.find(r => r.id === id);
    if (!room) return;
    
    this.world.activeRoomId = id;
    this.activeRoom = room;
    this.menuBar.updateRoomInfo(room.name, room.id);
    
    // Rebuild room 3D meshes (precautionary)
    this.rebuildRoomView();
    
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
    for (const [id, mesh] of this.meshMap) {
      this.roomGroup.remove(mesh);
      this.disposeMesh(mesh);
    }
    this.meshMap.clear();
    this.entityMap.clear();
    
    if (!this.activeRoom) return;
    
    for (const entity of this.activeRoom.entities) {
      this.entityMap.set(entity.id, entity);
      const obj = this.factory.create(entity);
      this.meshMap.set(entity.id, obj);
      this.roomGroup.add(obj);
    }
    
    this.rebuildFloorAndWalls();
  }

  private rebuildFloorAndWalls() {
    if (this.floorMesh) {
      this.roomGroup.remove(this.floorMesh);
      this.floorMesh = null;
    }
    if (this.wallsMesh) {
      this.roomGroup.remove(this.wallsMesh);
      this.wallsMesh = null;
    }
    
    if (!this.activeRoom || this.activeRoom.outline.length < 3) return;
    
    const outline = WorldMapController.expandOutline(
      this.activeRoom.outline,
      this.activeRoom.cornerRadii
    );
    const shape = new THREE.Shape();
    shape.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i++) {
       shape.lineTo(outline[i].x, outline[i].y);
    }
    shape.closePath();
    
    // Floor
    const floorGeo = new THREE.ShapeGeometry(shape);
    const floorMat = new THREE.MeshStandardMaterial({ 
      color: 0x1a2030, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.roomGroup.add(this.floorMesh);
    
    // Walls – single BufferGeometry with shared vertices so rounded corners shade smoothly
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
      wPos[i*6]   = p.x; wPos[i*6+1] = 0;          wPos[i*6+2] = p.y;
      wPos[i*6+3] = p.x; wPos[i*6+4] = wallHeight;  wPos[i*6+5] = p.y;
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
  }

  public addEntity(entity: EditorEntity): THREE.Object3D {
    if (!this.activeRoom) throw new Error("No active room");
    
    this.entityMap.set(entity.id, entity);
    this.activeRoom.entities.push(entity);

    const obj = this.factory.create(entity);
    this.meshMap.set(entity.id, obj);
    this.roomGroup.add(obj);

    return obj;
  }

  public removeEntity(entityId: string) {
    if (!this.activeRoom) return;

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

    this.entityMap.delete(entityId);
    this.activeRoom.entities = this.activeRoom.entities.filter((e) => e.id !== entityId);

    this.toast('Entity deleted', 'info');
  }

  public removeRoom(roomId: string) {
    this.world.rooms = this.world.rooms.filter(r => r.id !== roomId);
    if (this.world.activeRoomId === roomId) {
        this.world.activeRoomId = '';
        this.activeRoom = null;
        this.rightPanel.inspectRoom(null);
    }
    this.worldMapCtrl.rebuildRooms();
    this.rebuildRoomView();
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
    
    if (tool === 'select') this.gizmo.detach();
    if (['translate', 'rotate', 'scale'].includes(tool)) {
      this.gizmo.setMode(tool as GizmoMode);
      if (this.selection.selectedObject) this.gizmo.attach(this.selection.selectedObject);
    }
  }

  private handleEntityChange(entity: EditorEntity) {
    const mesh = this.meshMap.get(entity.id);
    if (!mesh) return;

    const t = entity.transform;
    mesh.position.set(t.position.x, t.position.y, t.position.z);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(t.rotation.x),
      THREE.MathUtils.degToRad(t.rotation.y),
      THREE.MathUtils.degToRad(t.rotation.z)
    );
    mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
    mesh.visible = entity.visible;
  }

  private addEntityFromBrowser(dragData: DragData) {
    if (!this.activeRoom) return this.toast('Select a room first!', 'error');

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

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = this.selection.selectedObject;
        if (selected?.userData?.entityId) this.removeEntity(selected.userData.entityId);
      }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.saveWorld(); }
      if (e.ctrlKey && e.key === 'e') { e.preventDefault(); this.exportWorld(); }
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.newWorld(); }
      if (e.ctrlKey && e.key === 'd') { e.preventDefault(); this.duplicateSelected(); }
      if (e.key === 'f' || e.key === 'F') this.focusOnSelection();
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

  private saveWorld() {
    this.syncSpawnPoints();
    this.serializer.saveToStorage(this.world);
    this.toast('World saved to localStorage', 'success');
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

    const sourceEntity = this.entityMap.get(selected.userData.entityId);
    if (!sourceEntity) return;

    const clone = createDefaultEntity(sourceEntity.type, `${sourceEntity.name} (copy)`);
    Object.assign(clone, { ...JSON.parse(JSON.stringify(sourceEntity)), id: clone.id, name: clone.name });
    clone.transform.position.x += 1;
    clone.transform.position.z += 1;

    const obj = this.addEntity(clone);
    this.selection.select(obj);
  }

  private focusOnSelection() {
    const s = this.selection.selectedObject;
    if (s) this.viewport.controls.target.copy(s.position);
    else this.viewport.controls.target.set(0, 0, 0);
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
    (this as any)._flightMouseHandler = mouseMoveHandler;

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
    if ((this as any)._flightMouseHandler) document.removeEventListener('mousemove', (this as any)._flightMouseHandler);
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
}
