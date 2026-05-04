/* ═══════════════════════════════════════════════════════════════════════
   ArchetypeVisualEditorPanel — full-screen 3D visual editor for archetypes.

   An archetype is a wrapper with properties + visual children.
   This panel shows each child as a selectable, movable 3D object.

   Layout:
     ┌──────────────────────────────────────────────────────────────────┐
     │  Toolbar: title | gizmo modes | + Add Child | Close | Save       │
     ├────────────┬──────────────────────────────┬──────────────────────┤
     │  Outliner  │     3-D Viewport             │   Inspector          │
     │ (children) │     (Three.js canvas)        │  (transform + props) │
     └────────────┴──────────────────────────────┴──────────────────────┘

   Saves:
     - child.transform   when gizmo moves / rotate / scale a child
     - child.props[key]  when an inspector field changes
     - arch.children[]   when a child is added or removed
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import type {
  ArchetypeSchema,
  ArchetypeDef,
  ArchetypeChildDef,
  ChildEntityType,
} from '../types/entities';
import { createDefaultChildDef, createDefaultTransform } from '../types/entities';
import { EntityFactory } from '../viewport/EntityFactory';

// ── Types ──────────────────────────────────────────────────────────────

type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale';

interface VisualItem {
  id: string;            // child.id
  childIndex: number;    // index in arch.children
  label: string;
  mesh: THREE.Object3D;
}

// ── Constants ──────────────────────────────────────────────────────────

const CHILD_ENTITY_TYPES: ChildEntityType[] = [
  'primitive', 'light', 'sprite', 'animated_sprite', 'sound', 'trigger',
];

const CHILD_TYPE_ICONS: Record<ChildEntityType, string> = {
  primitive: '⬛', light: '💡', sprite: '🖼',
  animated_sprite: '🎞', sound: '🔊', trigger: '⚡',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function deg(r: number) { return THREE.MathUtils.radToDeg(r); }
function rad(d: number) { return THREE.MathUtils.degToRad(d); }
function fmt(n: number, dp = 3) { return n.toFixed(dp); }

// ══════════════════════════════════════════════════════════════════════

export class ArchetypeVisualEditorPanel {
  private el: HTMLElement;

  // Three.js
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private orbitControls: OrbitControls | null = null;
  private transformControls: TransformControls | null = null;
  private animFrameId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private factory = new EntityFactory();
  private textureCache = new Map<string, THREE.Texture>();

  // Working state
  private schema: ArchetypeSchema | null = null;
  private archetypeId: string | null = null;
  private workingArch: ArchetypeDef | null = null;
  private items: VisualItem[] = [];
  private selectedItemId: string | null = null;
  private gizmoMode: GizmoMode = 'select';
  private gizmoDragging = false;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Child picker state
  private childPickerOpen = false;
  private pendingChildType: ChildEntityType = 'primitive';
  private pendingChildName = 'child';

  // DOM refs
  private canvasContainer: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private inspectorEl: HTMLElement | null = null;
  private outlinerEl: HTMLElement | null = null;

  private onSave: (archetypeId: string, arch: ArchetypeDef) => void;

  constructor(parentEl: HTMLElement, onSave: (archetypeId: string, arch: ArchetypeDef) => void) {
    this.onSave = onSave;
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'display:none', 'position:fixed', 'inset:0', 'z-index:1000',
      'background:#0d1117', 'flex-direction:column', 'overflow:hidden',
      'font-family:Inter,system-ui,sans-serif', 'font-size:13px', 'color:#c9d1d9',
    ].join(';');
    parentEl.appendChild(this.el);
  }

  // ── Public API ────────────────────────────────────────────────────

  public show(schema: ArchetypeSchema, archetypeId: string): void {
    this.schema = schema;
    this.archetypeId = archetypeId;
    this.workingArch = JSON.parse(JSON.stringify(schema.archetypes[archetypeId])) as ArchetypeDef;
    if (!this.workingArch.children) this.workingArch.children = [];
    if (!this.workingArch.defaultTransform) this.workingArch.defaultTransform = createDefaultTransform();
    this.selectedItemId = null;
    this.items = [];
    this.childPickerOpen = false;
    this.factory.setArchetypeSchema(schema);

    this.el.style.display = 'flex';
    this.renderLayout();
    this.initThreeScene();
    this.buildScene();
    this.startLoop();
  }

  public hide(): void {
    if (this._keyHandler) { window.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    this.stopLoop();
    this.disposeThreeScene();
    this.el.style.display = 'none';
  }

  // ── Layout ────────────────────────────────────────────────────────

  private renderLayout(): void {
    const toolDefs = [
      { mode: 'select' as GizmoMode, label: 'Select', shortcut: 'Q', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M5 3l14 8-6 2-4 6z"/></svg>` },
      { mode: 'translate' as GizmoMode, label: 'Move', shortcut: 'W', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 2v20M2 12h20"/></svg>` },
      { mode: 'rotate' as GizmoMode, label: 'Rotate', shortcut: 'E', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M21 3v5h-5"/></svg>` },
      { mode: 'scale' as GizmoMode, label: 'Scale', shortcut: 'R', icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/><path d="M14 10l-4 4"/></svg>` },
    ];

    const toolBtns = toolDefs.map(t => `
      <button data-gizmo="${t.mode}" title="${t.label} (${t.shortcut})" style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:3px;width:44px;height:48px;border:none;border-radius:6px;cursor:pointer;
        background:${t.mode === this.gizmoMode ? '#1f6feb' : 'transparent'};
        color:${t.mode === this.gizmoMode ? '#fff' : '#8b949e'};transition:background 80ms;">
        ${t.icon}
        <span style="font-size:9px;letter-spacing:.03em;">${t.shortcut}</span>
      </button>`).join('');

    this.el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid #21262d;flex-shrink:0;background:#161b22;">
        <span style="font-weight:600;color:#58a6ff;font-size:14px;">Visual Editor</span>
        <span style="font-size:12px;color:#8b949e;">— ${esc(this.archetypeId ?? '')}</span>
        <div style="flex:1;"></div>
        <button id="ave-add-child-btn" style="background:#1f6feb;border:none;color:#fff;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;">+ Add Child</button>
        <button id="ave-close-btn" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:5px 14px;border-radius:4px;cursor:pointer;">Close</button>
        <button id="ave-save-btn" style="background:#238636;border:none;color:#fff;padding:5px 14px;border-radius:4px;cursor:pointer;font-weight:600;">Save</button>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;">
        <div id="ave-left-toolbar" style="width:56px;border-right:1px solid #21262d;flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:4px;background:#0d1117;">
          ${toolBtns}
        </div>
        <div id="ave-outliner" style="width:200px;border-right:1px solid #21262d;overflow-y:auto;flex-shrink:0;padding:8px 0;"></div>
        <div id="ave-canvas-container" style="flex:1;position:relative;overflow:hidden;">
          <canvas id="ave-canvas" style="display:block;position:absolute;inset:0;"></canvas>
        </div>
        <div id="ave-inspector" style="width:280px;border-left:1px solid #21262d;overflow-y:auto;flex-shrink:0;padding:12px;">
          <div style="color:#555;font-size:12px;">Select a child object to inspect</div>
        </div>
      </div>
      ${this.renderChildPickerModal()}
    `;

    this.canvasContainer = this.el.querySelector('#ave-canvas-container');
    this.canvasEl = this.el.querySelector('#ave-canvas');
    this.inspectorEl = this.el.querySelector('#ave-inspector');
    this.outlinerEl = this.el.querySelector('#ave-outliner');

    this.bindToolbarEvents();
  }

  // ── Child Picker Modal ────────────────────────────────────────────

  private renderChildPickerModal(): string {
    if (!this.childPickerOpen) return '';
    const base = 'background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;';
    return `
      <div id="ave-child-picker-overlay" style="position:absolute;inset:0;background:rgba(1,4,9,.72);display:flex;align-items:center;justify-content:center;z-index:10;">
        <div style="width:min(460px,calc(100% - 48px));background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:600;color:#58a6ff;">Add Visual Child</div>
            <button id="ave-child-picker-close" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:4px 9px;border-radius:4px;cursor:pointer;">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            ${CHILD_ENTITY_TYPES.map(t => `
              <button data-child-type-btn="${t}" style="
                padding:10px 8px;border:1px solid ${this.pendingChildType === t ? '#58a6ff' : '#30363d'};
                border-radius:6px;background:${this.pendingChildType === t ? '#161b22' : '#0d1117'};
                color:#c9d1d9;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;">
                <span style="font-size:18px;">${CHILD_TYPE_ICONS[t]}</span>
                <span style="font-size:11px;">${t}</span>
              </button>`).join('')}
          </div>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#8b949e;">Child Name</span>
            <input id="ave-child-picker-name" type="text" value="${esc(this.pendingChildName)}" style="${base}">
          </label>
          <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="ave-child-picker-cancel" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:6px 12px;border-radius:4px;cursor:pointer;">Cancel</button>
            <button id="ave-child-picker-create" style="background:#238636;border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;">Add Child</button>
          </div>
        </div>
      </div>`;
  }

  private bindToolbarEvents(): void {
    this.el.querySelector('#ave-close-btn')?.addEventListener('click', () => this.hide());
    this.el.querySelector('#ave-save-btn')?.addEventListener('click', () => this.saveAndClose());

    this.el.querySelector('#ave-add-child-btn')?.addEventListener('click', () => {
      this.childPickerOpen = true;
      this.pendingChildType = 'primitive';
      this.pendingChildName = 'child';
      this.rebuildChildPicker();
    });

    this.el.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach(btn => {
      btn.addEventListener('click', () => this.setGizmoMode(btn.dataset.gizmo as GizmoMode));
    });

    this._keyHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input, select, textarea')) return;
      switch (e.key.toLowerCase()) {
        case 'q': this.setGizmoMode('select'); break;
        case 'w': this.setGizmoMode('translate'); break;
        case 'e': this.setGizmoMode('rotate'); break;
        case 'r': this.setGizmoMode('scale'); break;
        case 'escape': if (this.childPickerOpen) { this.childPickerOpen = false; this.rebuildChildPicker(); } else { this.selectItem(null); } break;
        case 'delete': this.deleteSelectedChild(); break;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  private rebuildChildPicker(): void {
    // Remove old modal, inject new one (avoids full layout rebuild)
    this.el.querySelector('#ave-child-picker-overlay')?.remove();
    const html = this.renderChildPickerModal();
    if (html) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      this.el.appendChild(tmp.firstElementChild!);
    }
    this.bindChildPickerEvents();
  }

  private bindChildPickerEvents(): void {
    this.el.querySelector('#ave-child-picker-close')?.addEventListener('click', () => { this.childPickerOpen = false; this.rebuildChildPicker(); });
    this.el.querySelector('#ave-child-picker-cancel')?.addEventListener('click', () => { this.childPickerOpen = false; this.rebuildChildPicker(); });
    (this.el.querySelector<HTMLInputElement>('#ave-child-picker-name'))?.addEventListener('input', e => { this.pendingChildName = (e.target as HTMLInputElement).value; });
    this.el.querySelectorAll<HTMLElement>('[data-child-type-btn]').forEach(btn => {
      btn.addEventListener('click', () => { this.pendingChildType = btn.dataset.childTypeBtn as ChildEntityType; this.rebuildChildPicker(); });
    });
    this.el.querySelector('#ave-child-picker-create')?.addEventListener('click', () => {
      const name = this.pendingChildName.trim() || this.pendingChildType;
      this.addChild(this.pendingChildType, name);
      this.childPickerOpen = false;
      this.rebuildChildPicker();
    });
  }

  private setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.el.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach(btn => {
      const active = btn.dataset.gizmo === mode;
      btn.style.background = active ? '#1f6feb' : 'transparent';
      btn.style.color = active ? '#fff' : '#8b949e';
    });
    if (mode === 'select') {
      this.transformControls?.detach();
    } else {
      this.transformControls?.setMode(mode as 'translate' | 'rotate' | 'scale');
      if (this.selectedItemId) {
        const item = this.items.find(i => i.id === this.selectedItemId);
        if (item) this.transformControls?.attach(item.mesh);
      }
    }
  }

  // ── Three.js ──────────────────────────────────────────────────────

  private initThreeScene(): void {
    if (!this.canvasEl || !this.canvasContainer) return;
    const w = this.canvasContainer.clientWidth || 800;
    const h = this.canvasContainer.clientHeight || 600;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0e12');
    this.scene.fog = new THREE.FogExp2('#0a0e12', 0.015);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
    this.camera.position.set(-6, 6, 8);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvasEl, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.AmbientLight('#6688aa', 0.6));
    const dir = new THREE.DirectionalLight('#ffffff', 1.0);
    dir.position.set(8, 12, 6);
    dir.castShadow = true;
    this.scene.add(dir);

    this.scene.add(new THREE.GridHelper(20, 20, 0x30363d, 0x21262d));
    this.scene.add(new THREE.AxesHelper(1.5));

    // Origin indicator
    const oGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const oMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff });
    this.scene.add(new THREE.Mesh(oGeo, oMat));

    this.orbitControls = new OrbitControls(this.camera, this.canvasEl);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;

    this.transformControls = new TransformControls(this.camera, this.canvasEl);
    this.transformControls.setMode('translate');
    this.transformControls.setSize(1.0);
    this.transformControls.setSpace('local');
    this.scene.add(this.transformControls as unknown as THREE.Object3D);

    this.transformControls.addEventListener('dragging-changed', (e: any) => {
      this.gizmoDragging = e.value === true;
      if (this.orbitControls) this.orbitControls.enabled = !this.gizmoDragging;
    });
    this.transformControls.addEventListener('objectChange', () => {
      this.syncSelectedToWorkingState();
      this.refreshInspectorTransform();
    });

    this.canvasEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      requestAnimationFrame(() => { if (!this.gizmoDragging) this.pickObject(e); });
    });

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.canvasContainer || !this.camera || !this.renderer) return;
      const cw = this.canvasContainer.clientWidth;
      const ch = this.canvasContainer.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
    });
    this.resizeObserver.observe(this.canvasContainer);
  }

  // ── Scene Population ──────────────────────────────────────────────

  private buildScene(): void {
    if (!this.scene || !this.workingArch) return;
    this.items = [];
    for (let i = 0; i < this.workingArch.children.length; i++) {
      this.spawnChildItem(this.workingArch.children[i], i);
    }
    this.renderOutliner();
  }

  private spawnChildItem(child: ArchetypeChildDef, index: number): VisualItem {
    const entity = this.childDefToEntity(child);
    let mesh: THREE.Object3D;
    try {
      mesh = this.factory.create(entity);
    } catch {
      mesh = this.makeErrorMarker(child.name);
    }
    // factory.create already applies transform, so reset position from the childDef
    const t = child.transform;
    mesh.position.set(t.position.x, t.position.y, t.position.z);
    mesh.rotation.set(rad(t.rotation.x), rad(t.rotation.y), rad(t.rotation.z));
    mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
    mesh.userData.visualEditorItemId = child.id;
    mesh.name = child.name;
    this.scene!.add(mesh);
    const item: VisualItem = { id: child.id, childIndex: index, label: `${CHILD_TYPE_ICONS[child.entityType] ?? ''} ${child.name}`, mesh };
    this.items.push(item);
    return item;
  }

  private childDefToEntity(child: ArchetypeChildDef): any {
    return {
      id: child.id,
      name: child.name,
      type: child.entityType,
      transform: child.transform,
      visible: child.visible,
      layer: 0,
      ...child.props,
    };
  }

  private makeErrorMarker(name: string): THREE.Object3D {
    const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf85149, wireframe: true });
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    return m;
  }

  private addChild(entityType: ChildEntityType, name: string): void {
    if (!this.workingArch) return;
    const child = createDefaultChildDef(entityType, name);
    this.workingArch.children.push(child);
    const item = this.spawnChildItem(child, this.workingArch.children.length - 1);
    this.renderOutliner();
    this.selectItem(item.id);
  }

  private deleteSelectedChild(): void {
    if (!this.selectedItemId || !this.workingArch) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;

    // Remove mesh from scene
    this.transformControls?.detach();
    this.scene?.remove(item.mesh);
    item.mesh.traverse(c => {
      if (c instanceof THREE.Mesh) {
        c.geometry?.dispose();
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m: THREE.Material) => m?.dispose());
      }
    });

    // Remove from data and items
    this.workingArch.children.splice(item.childIndex, 1);
    this.items = this.items.filter(i => i.id !== this.selectedItemId);
    // Reindex
    this.items.forEach((it, idx) => { it.childIndex = idx; });
    this.selectedItemId = null;
    this.renderOutliner();
    this.refreshInspector();
  }

  // ── Outliner ──────────────────────────────────────────────────────

  private renderOutliner(): void {
    if (!this.outlinerEl) return;
    const rows = this.items.map(item => `
      <div class="ave-ol-row" data-item-id="${esc(item.id)}" style="
        padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;
        background:${item.id === this.selectedItemId ? '#161b22' : 'transparent'};
        border-left:2px solid ${item.id === this.selectedItemId ? '#58a6ff' : 'transparent'};">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${esc(item.label)}</span>
      </div>`).join('');

    this.outlinerEl.innerHTML = `
      <div style="padding:4px 12px 6px;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.06em;">Children</div>
      ${rows || '<div style="padding:8px 12px;color:#555;font-size:11px;">No children yet</div>'}`;

    this.outlinerEl.querySelectorAll<HTMLElement>('.ave-ol-row').forEach(row => {
      row.addEventListener('click', () => this.selectItem(row.dataset.itemId!));
    });
  }

  // ── Selection ─────────────────────────────────────────────────────

  private selectItem(itemId: string | null): void {
    for (const item of this.items) {
      const box = item.mesh.userData.selectionBox as THREE.Object3D | null;
      if (box) { item.mesh.remove(box); item.mesh.userData.selectionBox = null; }
    }
    this.transformControls?.detach();
    this.selectedItemId = itemId;

    if (itemId) {
      const item = this.items.find(i => i.id === itemId);
      if (item) {
        const box = this.buildSelectionHighlight(item.mesh);
        item.mesh.add(box);
        item.mesh.userData.selectionBox = box;
        if (this.gizmoMode !== 'select') {
          this.transformControls?.setMode(this.gizmoMode as 'translate' | 'rotate' | 'scale');
          this.transformControls?.attach(item.mesh);
        }
      }
    }
    this.renderOutliner();
    this.refreshInspector();
  }

  private pickObject(e: PointerEvent): void {
    if (!this.camera || !this.scene || !this.canvasEl) return;
    const rect = this.canvasEl.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const pickable: THREE.Object3D[] = [];
    this.scene.traverse(c => { if (c.userData.visualEditorItemId && !c.userData.__selectionHighlight) pickable.push(c); });
    const hits = raycaster.intersectObjects(pickable, true);
    if (hits.length > 0) {
      let hit: THREE.Object3D | null = hits[0].object;
      while (hit && !hit.userData.visualEditorItemId) hit = hit.parent;
      if (hit?.userData.visualEditorItemId) { this.selectItem(hit.userData.visualEditorItemId as string); return; }
    }
    this.selectItem(null);
  }

  // ── Inspector ─────────────────────────────────────────────────────

  private refreshInspector(): void {
    if (!this.inspectorEl || !this.workingArch) return;
    if (!this.selectedItemId) {
      this.inspectorEl.innerHTML = '<div style="color:#555;font-size:12px;">Select a child object to inspect</div>';
      return;
    }
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;
    const child = this.workingArch.children[item.childIndex];
    if (!child) return;
    this.renderChildInspector(item, child);
  }

  private renderChildInspector(item: VisualItem, child: ArchetypeChildDef): void {
    if (!this.inspectorEl) return;
    const t = item.mesh.position;
    const r = item.mesh.rotation;
    const s = item.mesh.scale;
    const inp = (f: string) => `<input class="ave-transform" data-field="${f}" type="number" step="0.1" value="0" style="${this.inputStyle()}">`;

    const transformHtml = `
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
        <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">POS</span>
        ${['px','py','pz'].map(f => inp(f)).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
        <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">ROT</span>
        ${['rx','ry','rz'].map(f => inp(f)).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">SCL</span>
        ${['sx','sy','sz'].map(f => inp(f)).join('')}
      </div>`;

    this.inspectorEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div style="font-size:12px;font-weight:600;color:#e8a020;">${esc(CHILD_TYPE_ICONS[child.entityType])} ${esc(child.name)}</div>
          <div style="font-size:10px;color:#555;margin-top:2px;">${esc(child.entityType)}</div>
        </div>
        <button id="ave-delete-child-btn"
          style="background:transparent;border:1px solid #f85149;color:#f85149;padding:3px 9px;border-radius:4px;cursor:pointer;font-size:11px;">
          Delete
        </button>
      </div>

      <div style="font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Transform</div>
      <div id="ave-transform-section" style="margin-bottom:16px;">${transformHtml}</div>

      <div style="font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Properties</div>
      ${this.renderChildTypeProps(child)}
    `;

    // Fill transform values
    const set = (field: string, v: number, dp = 3) => {
      const el = this.inspectorEl?.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      if (el) el.value = v.toFixed(dp);
    };
    set('px', t.x); set('py', t.y); set('pz', t.z);
    set('rx', deg(r.x), 1); set('ry', deg(r.y), 1); set('rz', deg(r.z), 1);
    set('sx', s.x); set('sy', s.y); set('sz', s.z);

    this.inspectorEl.querySelector<HTMLButtonElement>('#ave-delete-child-btn')?.addEventListener('click', () => this.deleteSelectedChild());
    this.inspectorEl.querySelectorAll<HTMLInputElement>('.ave-transform').forEach(el => el.addEventListener('change', () => this.applyTransformInputs()));
    this.inspectorEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.ave-prop').forEach(el => el.addEventListener('change', () => this.collectChildProps()));
  }

  private renderChildTypeProps(child: ArchetypeChildDef): string {
    const p = child.props;
    const row = (label: string, input: string) =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="width:100px;font-size:11px;color:#8b949e;flex-shrink:0;">${esc(label)}</span>
        ${input}
      </div>`;
    const text = (key: string) => row(key, `<input class="ave-prop" data-prop-key="${key}" data-prop-type="text" type="text" value="${esc(String(p[key] ?? ''))}" style="${this.propInputStyle()}">`);
    const num = (key: string, step = '0.01') => row(key, `<input class="ave-prop" data-prop-key="${key}" data-prop-type="number" type="number" step="${step}" value="${esc(String(p[key] ?? 0))}" style="${this.propInputStyle()}">`);
    const bool = (key: string) => row(key, `<input class="ave-prop" data-prop-key="${key}" data-prop-type="boolean" type="checkbox" ${p[key] ? 'checked' : ''}>`);
    const sel = (key: string, opts: string[]) => row(key, `<select class="ave-prop" data-prop-key="${key}" data-prop-type="text" style="${this.propInputStyle()}">${opts.map(o => `<option value="${esc(o)}" ${o === String(p[key]) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
    const color = (key: string) => row(key, `<input class="ave-prop" data-prop-key="${key}" data-prop-type="text" type="color" value="${esc(String(p[key] ?? '#ffffff'))}" style="width:44px;height:28px;background:#0d1117;border:1px solid #30363d;outline:none;">`);
    const vec3 = (key: string) => {
      const v: any = p[key] ?? { x: 0, y: 0, z: 0 };
      return `<div style="margin-bottom:8px;">
        <span style="font-size:11px;color:#8b949e;display:block;margin-bottom:4px;">${esc(key)}</span>
        <div style="display:flex;gap:4px;">
          ${['x','y','z'].map(ax => `<input class="ave-prop" data-prop-key="${key}.${ax}" data-prop-type="number" type="number" step="0.1" value="${esc(String(v[ax] ?? 0))}" style="${this.propInputStyle()}">`).join('')}
        </div>
      </div>`;
    };

    switch (child.entityType) {
      case 'primitive': return [
        sel('geometryType', ['cube','sphere','plane','cylinder','cone']),
        sel('materialType', ['color','textured','invisible']),
        color('color'), num('opacity', '0.05'), text('textureSource'), bool('isCollider'), bool('castShadows'), bool('receiveShadows'),
      ].join('');
      case 'light': return [
        sel('lightType', ['point','directional','spot','rect_area']),
        color('color'), num('intensity', '0.1'), num('distance', '0.5'), num('decay', '0.1'),
        num('angle', '1'), num('penumbra', '0.05'), bool('castShadows'),
      ].join('');
      case 'sprite': return [
        text('textureSource'),
        sel('billboardMode', ['face_camera','y_axis','fixed']),
        sel('blendMode', ['normal','additive','multiply']),
      ].join('');
      case 'animated_sprite': return [
        text('textureSource'), num('fps', '1'), num('columns', '1'), num('rows', '1'), bool('loop'), bool('autoplay'),
        sel('billboardMode', ['face_camera','y_axis','fixed']),
      ].join('');
      case 'sound': return [
        text('audioSource'), num('volume', '0.05'), bool('loop'), bool('spatialAudio'), num('maxDistance', '0.5'),
      ].join('');
      case 'trigger': return [
        sel('shape', ['box','sphere']), vec3('extents'), text('onEnterEvent'), text('onLeaveEvent'), bool('triggerOnce'),
      ].join('');
      default: return '<div style="color:#555;font-size:11px;">No properties for this type.</div>';
    }
  }

  private inputStyle(): string {
    return 'background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 4px;border-radius:3px;font-size:11px;outline:none;width:0;flex:1;text-align:center;';
  }

  private propInputStyle(): string {
    return 'background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;flex:1;';
  }

  // ── Transform sync ────────────────────────────────────────────────

  private applyTransformInputs(): void {
    if (!this.selectedItemId) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;
    const get = (f: string) => parseFloat(this.inspectorEl?.querySelector<HTMLInputElement>(`[data-field="${f}"]`)?.value ?? '0') || 0;
    item.mesh.position.set(get('px'), get('py'), get('pz'));
    item.mesh.rotation.set(rad(get('rx')), rad(get('ry')), rad(get('rz')));
    item.mesh.scale.set(get('sx'), get('sy'), get('sz'));
    this.syncSelectedToWorkingState();
  }

  private syncSelectedToWorkingState(): void {
    if (!this.selectedItemId || !this.workingArch) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;
    const child = this.workingArch.children[item.childIndex];
    if (!child) return;
    child.transform = {
      position: { x: item.mesh.position.x, y: item.mesh.position.y, z: item.mesh.position.z },
      rotation: { x: deg(item.mesh.rotation.x), y: deg(item.mesh.rotation.y), z: deg(item.mesh.rotation.z) },
      scale: { x: item.mesh.scale.x, y: item.mesh.scale.y, z: item.mesh.scale.z },
    };
  }

  private refreshInspectorTransform(): void {
    if (!this.selectedItemId) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item || !this.inspectorEl) return;
    const set = (f: string, v: number, dp = 3) => {
      const el = this.inspectorEl?.querySelector<HTMLInputElement>(`[data-field="${f}"]`);
      if (el) el.value = v.toFixed(dp);
    };
    const t = item.mesh.position; const r = item.mesh.rotation; const s = item.mesh.scale;
    set('px', t.x); set('py', t.y); set('pz', t.z);
    set('rx', deg(r.x), 1); set('ry', deg(r.y), 1); set('rz', deg(r.z), 1);
    set('sx', s.x); set('sy', s.y); set('sz', s.z);
  }

  // ── Child props sync ──────────────────────────────────────────────

  private collectChildProps(): void {
    if (!this.selectedItemId || !this.workingArch) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;
    const child = this.workingArch.children[item.childIndex];
    if (!child) return;

    this.inspectorEl?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.ave-prop').forEach(el => {
      const key = el.dataset.propKey!;
      const type = el.dataset.propType ?? 'text';
      let val: unknown;
      if (type === 'boolean') val = (el as HTMLInputElement).checked;
      else if (type === 'number') val = parseFloat(el.value) || 0;
      else val = el.value;

      // Handle dot-path (e.g. "extents.x")
      if (key.includes('.')) {
        const [parent, sub] = key.split('.');
        if (!child.props[parent] || typeof child.props[parent] !== 'object') {
          child.props[parent] = { x: 0, y: 0, z: 0 };
        }
        (child.props[parent] as Record<string, unknown>)[sub] = val;
      } else {
        child.props[key] = val;
      }
    });
  }

  // ── Save ──────────────────────────────────────────────────────────

  private saveAndClose(): void {
    if (!this.workingArch || !this.archetypeId) return;
    // Flush final inspector state
    this.collectChildProps();
    for (const item of this.items) {
      const child = this.workingArch.children[item.childIndex];
      if (!child) continue;
      child.transform = {
        position: { x: item.mesh.position.x, y: item.mesh.position.y, z: item.mesh.position.z },
        rotation: { x: deg(item.mesh.rotation.x), y: deg(item.mesh.rotation.y), z: deg(item.mesh.rotation.z) },
        scale: { x: item.mesh.scale.x, y: item.mesh.scale.y, z: item.mesh.scale.z },
      };
    }
    this.onSave(this.archetypeId, JSON.parse(JSON.stringify(this.workingArch)));
    this.hide();
  }

  // ── Selection Highlight ───────────────────────────────────────────

  private buildSelectionHighlight(obj: THREE.Object3D): THREE.LineSegments {
    obj.updateWorldMatrix(true, true);
    const worldToLocal = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    const box = new THREE.Box3();
    obj.traverse(child => {
      if (child.userData.__selectionHighlight || !child.visible) return;
      if (child instanceof THREE.Mesh && child.geometry) {
        child.geometry.computeBoundingBox();
        const gb = child.geometry.boundingBox;
        if (!gb || gb.isEmpty()) return;
        const m = new THREE.Matrix4().multiplyMatrices(worldToLocal, child.matrixWorld);
        box.union(gb.clone().applyMatrix4(m));
      }
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const pad = 0.06;
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + pad, size.y + pad, size.z + pad));
    const mat = new THREE.LineBasicMaterial({ color: 0x58a6ff });
    const lines = new THREE.LineSegments(geo, mat);
    lines.position.copy(center);
    lines.userData.__selectionHighlight = true;
    lines.raycast = () => {};
    return lines;
  }

  // ── Render Loop ───────────────────────────────────────────────────

  private startLoop(): void {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      this.orbitControls?.update();
      if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.animFrameId);
    this.animFrameId = 0;
  }

  private disposeThreeScene(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.transformControls?.dispose();
    this.transformControls = null;
    this.orbitControls?.dispose();
    this.orbitControls = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.items = [];
  }
}
