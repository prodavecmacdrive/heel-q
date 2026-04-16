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

import type { EditorEntity, EntityType, PrimitiveEntity } from './types/entities';
import { createDefaultEntity } from './types/entities';
import type { WorldProject, RoomData } from './types/scene';
import { createDefaultWorld } from './types/scene';

export class EditorApp {
  // ── State ──
  private world: WorldProject;
  private activeRoom: RoomData | null = null;
  
  private entityMap: Map<string, EditorEntity> = new Map();
  private meshMap: Map<string, THREE.Object3D> = new Map();

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
      (roomId) => { this.selectRoom(roomId); this.topPanel.setMode('room'); }
    );

    // ── Gizmo change ──
    this.gizmo.setOnChange((obj) => {
      const entityId = obj.userData?.entityId;
      if (!entityId) return;
      const entity = this.entityMap.get(entityId);
      if (!entity) return;

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
          const tool = this.leftPanel.getTool();
          if (tool === 'translate' || tool === 'rotate' || tool === 'scale') {
            this.gizmo.setMode(tool as GizmoMode);
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

    // Synthesize door pseudo-entities so they are visible in Room Mode
    for (const door of this.world.doors) {
      if (door.room1Id === this.activeRoom.id || door.room2Id === this.activeRoom.id) {
        const cx = (door.points[0].x + door.points[1].x) / 2;
        const cz = (door.points[0].y + door.points[1].y) / 2;
        
        let tex = door.texture || 'door';
        if (tex === 'door_default') tex = 'door'; // fallback for defaults in WorldMapController

        const pseudoEntity: import('./types/entities').SpriteEntity = {
          id: door.id,
          type: 'sprite',
          name: 'Door ' + door.id,
          textureSource: tex,
          transform: {
            position: { x: cx, y: 0, z: cz },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
          },
          visible: true
        };
        
        const obj = this.factory.create(pseudoEntity);
        // Add to meshMap and roomGroup, but NOT entityMap (so it remains uneditable in Room mode)
        this.meshMap.set(door.id, obj);
        this.roomGroup.add(obj);
      }
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
    
    const outline = this.activeRoom.outline;
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
    
    // Walls
    const wallHeight = 3;
    const extrudeSettings = { depth: wallHeight, bevelEnabled: false };
    const extrudedGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    
    // Make wall mesh but only show the edges/sides? 
    // Actually, constructing wall planes manually is better for texturing
    const wallGroup = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x223344, side: THREE.DoubleSide });
    
    for (let i = 0; i < outline.length; i++) {
        const p1 = outline[i];
        const p2 = outline[(i+1) % outline.length];
        
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const angle = Math.atan2(-dy, dx);
        
        const wGeo = new THREE.PlaneGeometry(dist, wallHeight);
        const wMesh = new THREE.Mesh(wGeo, wallMat);
        wMesh.position.set(p1.x + dx/2, wallHeight/2, p1.y + dy/2);
        wMesh.rotation.y = angle;
        wMesh.castShadow = true;
        wMesh.receiveShadow = true;
        wallGroup.add(wMesh);
    }
    this.wallsMesh = wallGroup as any;
    this.roomGroup.add(wallGroup);
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
