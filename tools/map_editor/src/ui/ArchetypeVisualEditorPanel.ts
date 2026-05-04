/* ═══════════════════════════════════════════════════════════════════════
   ArchetypeVisualEditorPanel — full-screen 3D visual editor for archetypes.

   Layout:
     ┌─────────────────────────────────────────────────────────┐
     │  Toolbar: title | gizmo modes | Close | Save            │
     ├────────────┬───────────────────────────┬────────────────┤
     │  Outliner  │     3-D Viewport          │   Inspector    │
     │  (objects) │     (Three.js canvas)     │  (properties)  │
     └────────────┴───────────────────────────┴────────────────┘

   The main archetype entity is placed at the scene origin. Each
   nested-archetype property is shown as a separate selectable mesh.
   - Main entity: properties only (no gizmo — it has no stored transform).
   - Nested entities: full gizmo (translate/rotate/scale) + properties.

   Saves transform changes to NestedArchetypeValue.transform (in degrees for
   rotation, matching the editor convention) and property changes to either
   arch.properties[i].default (main) or NestedArchetypeValue.overrides (nested).
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import type {
  ArchetypeSchema,
  ArchetypeDef,
  ArchetypePropertyDef,
  ArchetypeInstanceEntity,
  NestedArchetypeValue,
} from '../types/entities';
import {
  isNestedArchetypeValue,
  createDefaultTransform,
  generateId,
} from '../types/entities';
import { EntityFactory } from '../viewport/EntityFactory';

// ── Types ──────────────────────────────────────────────────────────────

type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale';

interface VisualItem {
  /** '__main__' for the root archetype or a unique scene node id */
  id: string;
  label: string;
  depth: number;
  parentId?: string;
  propName?: string;
  ownerPropName?: string;
  mesh: THREE.Object3D;
}

// ── Helpers ────────────────────────────────────────────────────────────

const MAIN_ID = '__arch_main__';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ═══════════════════════════════════════════════════════════════════════

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

  // Working state
  private schema: ArchetypeSchema | null = null;
  private archetypeId: string | null = null;
  private workingArch: ArchetypeDef | null = null;
  private items: VisualItem[] = [];
  private selectedItemId: string | null = null;
  private gizmoMode: GizmoMode = 'select';
  private gizmoDragging = false;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Refs to dynamic DOM sections
  private canvasContainer: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private inspectorEl: HTMLElement | null = null;
  private outlinerEl: HTMLElement | null = null;

  // Callback
  private onSave: (archetypeId: string, arch: ArchetypeDef) => void;

  constructor(parentEl: HTMLElement, onSave: (archetypeId: string, arch: ArchetypeDef) => void) {
    this.onSave = onSave;

    this.el = document.createElement('div');
    this.el.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:1000',
      'background:#0d1117',
      'flex-direction:column',
      'overflow:hidden',
      'font-family:Inter,system-ui,sans-serif',
      'font-size:13px',
      'color:#c9d1d9',
    ].join(';');
    parentEl.appendChild(this.el);
  }

  // ── Public API ────────────────────────────────────────────────────

  public show(schema: ArchetypeSchema, archetypeId: string): void {
    this.schema = schema;
    this.archetypeId = archetypeId;
    this.workingArch = JSON.parse(JSON.stringify(schema.archetypes[archetypeId])) as ArchetypeDef;
    if (!this.workingArch.defaultTransform) {
      this.workingArch.defaultTransform = createDefaultTransform();
    }
    this.selectedItemId = null;
    this.items = [];

    this.el.style.display = 'flex';
    this.renderLayout();
    this.initThreeScene();
    this.buildScene();
    this.startLoop();
  }

  public hide(): void {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    this.stopLoop();
    this.disposeThreeScene();
    this.el.style.display = 'none';
  }

  // ── Layout ────────────────────────────────────────────────────────

  private renderLayout(): void {
    const toolDefs: Array<{ mode: GizmoMode; label: string; shortcut: string; icon: string }> = [
      {
        mode: 'select',
        label: 'Select',
        shortcut: 'Q',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M5 3l14 8-6 2-4 6z"/>
        </svg>`,
      },
      {
        mode: 'translate',
        label: 'Move',
        shortcut: 'W',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M12 2v20M2 12h20"/>
          <path d="M12 2l-3 3h6z M12 22l-3-3h6z M2 12l3-3v6z M22 12l-3-3v6z" fill="currentColor" stroke="none"/>
        </svg>`,
      },
      {
        mode: 'rotate',
        label: 'Rotate',
        shortcut: 'E',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          <path d="M21 3v5h-5"/>
        </svg>`,
      },
      {
        mode: 'scale',
        label: 'Scale',
        shortcut: 'R',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <rect x="4" y="4" width="6" height="6" rx="1"/>
          <rect x="14" y="14" width="6" height="6" rx="1"/>
          <path d="M14 10l-4 4"/>
        </svg>`,
      },
    ];

    const toolBtns = toolDefs.map(t => `
      <button data-gizmo="${t.mode}" title="${t.label} (${t.shortcut})" style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:3px;width:44px;height:48px;border:none;border-radius:6px;cursor:pointer;
        background:${t.mode === this.gizmoMode ? '#1f6feb' : 'transparent'};
        color:${t.mode === this.gizmoMode ? '#fff' : '#8b949e'};
        transition:background 80ms;">
        ${t.icon}
        <span style="font-size:9px;letter-spacing:.03em;">${t.shortcut}</span>
      </button>
    `).join('');

    this.el.innerHTML = `
      <!-- Top Toolbar -->
      <div style="display:flex;align-items:center;gap:10px;padding:8px 16px;
                  border-bottom:1px solid #21262d;flex-shrink:0;background:#161b22;">
        <span style="font-weight:600;color:#58a6ff;font-size:14px;">Visual Editor</span>
        <span id="ave-arch-label" style="font-size:12px;color:#8b949e;"></span>
        <div style="flex:1;"></div>
        <button id="ave-close-btn" style="background:transparent;border:1px solid #30363d;
          color:#8b949e;padding:5px 14px;border-radius:4px;cursor:pointer;">Close</button>
        <button id="ave-save-btn" style="background:#238636;border:none;color:#fff;
          padding:5px 14px;border-radius:4px;cursor:pointer;font-weight:600;">Save</button>
      </div>
      <!-- Body -->
      <div style="display:flex;flex:1;overflow:hidden;">
        <!-- Left Panel: Toolbar -->
        <div id="ave-left-toolbar"
             style="width:56px;border-right:1px solid #21262d;flex-shrink:0;
                    display:flex;flex-direction:column;align-items:center;
                    padding:8px 0;gap:4px;background:#0d1117;">
          ${toolBtns}
        </div>
        <!-- Outliner -->
        <div id="ave-outliner"
             style="width:190px;border-right:1px solid #21262d;overflow-y:auto;
                    flex-shrink:0;padding:8px 0;">
          <div style="padding:4px 12px 6px;font-size:10px;color:#555;
               text-transform:uppercase;letter-spacing:.06em;">Objects</div>
        </div>
        <!-- Viewport -->
        <div id="ave-canvas-container"
             style="flex:1;position:relative;overflow:hidden;">
          <canvas id="ave-canvas"
                  style="display:block;position:absolute;inset:0;"></canvas>
        </div>
        <!-- Inspector -->
        <div id="ave-inspector"
             style="width:280px;border-left:1px solid #21262d;overflow-y:auto;
                    flex-shrink:0;padding:12px;">
          <div style="color:#555;font-size:12px;">Select an object to inspect</div>
        </div>
      </div>
    `;

    const label = this.el.querySelector('#ave-arch-label') as HTMLElement | null;
    if (label && this.archetypeId) label.textContent = `— ${this.archetypeId}`;

    this.canvasContainer = this.el.querySelector('#ave-canvas-container');
    this.canvasEl = this.el.querySelector('#ave-canvas');
    this.inspectorEl = this.el.querySelector('#ave-inspector');
    this.outlinerEl = this.el.querySelector('#ave-outliner');

    this.bindToolbarEvents();
  }

  private bindToolbarEvents(): void {
    this.el.querySelector('#ave-close-btn')?.addEventListener('click', () => this.hide());
    this.el.querySelector('#ave-save-btn')?.addEventListener('click', () => this.saveAndClose());

    this.el.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setGizmoMode(btn.dataset.gizmo as GizmoMode);
      });
    });

    // Keyboard shortcuts (Q/W/E/R) — scoped to the overlay
    this._keyHandler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input, select, textarea')) return;
      switch (e.key.toLowerCase()) {
        case 'q': this.setGizmoMode('select'); break;
        case 'w': this.setGizmoMode('translate'); break;
        case 'e': this.setGizmoMode('rotate'); break;
        case 'r': this.setGizmoMode('scale'); break;
        case 'escape': this.selectItem(null); break;
      }
    };
    window.addEventListener('keydown', this._keyHandler);
  }

  private setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;

    // Update left toolbar active state
    this.el.querySelectorAll<HTMLButtonElement>('[data-gizmo]').forEach(btn => {
      const active = btn.dataset.gizmo === mode;
      btn.style.background = active ? '#1f6feb' : 'transparent';
      btn.style.color = active ? '#fff' : '#8b949e';
    });

    if (mode === 'select') {
      this.transformControls?.detach();
    } else {
      this.transformControls?.setMode(mode as 'translate' | 'rotate' | 'scale');
      // Re-attach to selected item if any
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

    // Scene lighting
    this.scene.add(new THREE.AmbientLight('#6688aa', 0.6));
    const dir = new THREE.DirectionalLight('#ffffff', 1.0);
    dir.position.set(8, 12, 6);
    dir.castShadow = true;
    this.scene.add(dir);

    // Reference grid
    const grid = new THREE.GridHelper(20, 20, 0x30363d, 0x21262d);
    this.scene.add(grid);

    // Origin axes for reference
    const axesHelper = new THREE.AxesHelper(1.5);
    this.scene.add(axesHelper);

    // Orbit controls
    this.orbitControls = new OrbitControls(this.camera, this.canvasEl);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.maxPolarAngle = Math.PI * 0.48;

    // Transform gizmo
    this.transformControls = new TransformControls(this.camera, this.canvasEl);
    this.transformControls.setMode('translate');
    this.transformControls.setSize(1.0);
    this.transformControls.setSpace('local');
    this.scene.add(this.transformControls);

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.gizmoDragging = (event as any).value === true;
      if (this.orbitControls) this.orbitControls.enabled = !this.gizmoDragging;
    });

    this.transformControls.addEventListener('objectChange', () => {
      this.syncGizmoToWorkingState();
      this.refreshInspectorTransform();
    });

    // Click-to-select on canvas
    this.canvasEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Let gizmo process first, then check if we should select
      requestAnimationFrame(() => {
        if (!this.gizmoDragging) this.pickObject(e);
      });
    });

    // Resize observer
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
    if (!this.scene || !this.workingArch || !this.schema || !this.archetypeId) return;

    this.items = [];
    this.factory.setArchetypeSchema(this.schema);

    // ── Main entity: root visual only (no nested children) ──
    const mainEntity: ArchetypeInstanceEntity = {
      id: MAIN_ID,
      name: this.archetypeId,
      type: 'archetype_instance',
      archetypeId: this.archetypeId,
      transform: this.workingArch.defaultTransform ?? createDefaultTransform(),
      visible: true,
      layer: 0,
      overrides: {},
    };

    const mainMesh = this.factory.createRootOnly(mainEntity);
    const mainT = mainEntity.transform;
    mainMesh.position.set(mainT.position.x, mainT.position.y, mainT.position.z);
    mainMesh.rotation.set(
      THREE.MathUtils.degToRad(mainT.rotation.x),
      THREE.MathUtils.degToRad(mainT.rotation.y),
      THREE.MathUtils.degToRad(mainT.rotation.z),
    );
    mainMesh.scale.set(mainT.scale.x, mainT.scale.y, mainT.scale.z);
    mainMesh.userData.visualEditorItemId = MAIN_ID;
    mainMesh.name = this.archetypeId;
    this.scene.add(mainMesh);
    this.items.push({ id: MAIN_ID, label: this.archetypeId, depth: 0, mesh: mainMesh });
  this.addSceneObjectItems(mainMesh, MAIN_ID, 1);

    // ── Nested entities: one mesh per nested_archetype property ──
    for (const prop of this.workingArch.properties) {
      if (prop.type !== 'object' || prop.objectKind !== 'nested_archetype') continue;
      const rawVal = prop.default;
      if (!isNestedArchetypeValue(rawVal) || !rawVal.archetypeId) continue;

      const nestedValue = rawVal as NestedArchetypeValue;
      const nestedT = nestedValue.transform ?? createDefaultTransform();

      const nestedEntity: ArchetypeInstanceEntity = {
        id: generateId('nested'),
        name: `${prop.name} (${nestedValue.archetypeId})`,
        type: 'archetype_instance',
        archetypeId: nestedValue.archetypeId,
        transform: nestedT,
        visible: nestedValue.visible ?? true,
        layer: nestedValue.layer ?? 0,
        overrides: { ...(nestedValue.overrides ?? {}) },
      };

      try {
        // Use createRootOnly so we render this nested arch's own root visual only.
        // Its own further-nested children are not shown separately here.
        const nestedMesh = this.factory.createRootOnly(nestedEntity);
        // Apply the stored local transform (factory.createRootOnly doesn't apply it)
        nestedMesh.position.set(nestedT.position.x, nestedT.position.y, nestedT.position.z);
        nestedMesh.rotation.set(
          THREE.MathUtils.degToRad(nestedT.rotation.x),
          THREE.MathUtils.degToRad(nestedT.rotation.y),
          THREE.MathUtils.degToRad(nestedT.rotation.z),
        );
        nestedMesh.scale.set(nestedT.scale.x, nestedT.scale.y, nestedT.scale.z);

        nestedMesh.userData.visualEditorItemId = prop.name;
        nestedMesh.name = prop.name;
        // Parent under the main mesh so transforms are in the same local space
        // as the Room Map (where nested children are children of the parent group).
        mainMesh.add(nestedMesh);
        this.items.push({
          id: prop.name,
          label: `${prop.name}  [${nestedValue.archetypeId}]`,
          depth: 0,
          propName: prop.name,
          ownerPropName: prop.name,
          mesh: nestedMesh,
        });
        this.addSceneObjectItems(nestedMesh, prop.name, 1, prop.name);
      } catch (err) {
        console.warn(`[ArchetypeVisualEditor] Could not create mesh for "${prop.name}":`, err);
      }
    }

    this.renderOutliner();
  }

  private addSceneObjectItems(
    root: THREE.Object3D,
    parentId: string,
    depth: number,
    ownerPropName?: string,
  ): void {
    for (const child of root.children) {
      const id = `${parentId}:${child.uuid}`;
      child.userData.visualEditorItemId = id;
      const label = child.name || child.type || 'Object';
      this.items.push({ id, label, depth, parentId, ownerPropName, mesh: child });
      if (child.children.length > 0) {
        this.addSceneObjectItems(child, id, depth + 1, ownerPropName);
      }
    }
  }

  // ── Outliner ──────────────────────────────────────────────────────

  private renderOutliner(): void {
    if (!this.outlinerEl) return;

    const rows = this.items.map(item => `
      <div class="ave-ol-row" data-item-id="${esc(item.id)}" style="
        padding:6px 12px 6px ${12 + item.depth * 12}px;cursor:pointer;display:flex;align-items:center;gap:8px;
        background:${item.id === this.selectedItemId ? '#161b22' : 'transparent'};
        border-left:2px solid ${item.id === this.selectedItemId ? '#58a6ff' : 'transparent'};">
        <span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;
              background:${item.depth === 0 ? '#58a6ff' : '#e8a020'};"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
              font-size:12px;">${esc(item.label)}</span>
        ${item.propName ? '<span style="font-size:10px;color:#555;">nested</span>' : ''}
      </div>
    `).join('');

    this.outlinerEl.innerHTML = `
      <div style="padding:4px 12px 6px;font-size:10px;color:#555;
           text-transform:uppercase;letter-spacing:.06em;">Objects</div>
      ${rows || '<div style="padding:8px 12px;color:#555;font-size:11px;">No objects</div>'}
    `;

    this.outlinerEl.querySelectorAll<HTMLElement>('.ave-ol-row').forEach(row => {
      row.addEventListener('click', () => this.selectItem(row.dataset.itemId!));
    });
  }

  // ── Selection ─────────────────────────────────────────────────────

  private selectItem(itemId: string | null): void {
    // Remove previous selection highlight
    for (const item of this.items) {
      const prev = item.mesh.userData.selectionBox as THREE.Object3D | null;
      if (prev) { item.mesh.remove(prev); item.mesh.userData.selectionBox = null; }
    }
    this.transformControls?.detach();

    this.selectedItemId = itemId;

    if (itemId) {
      const item = this.items.find(i => i.id === itemId);
      if (item) {
        const box = this.buildSelectionHighlight(item.mesh);
        item.mesh.add(box);
        item.mesh.userData.selectionBox = box;

        // Gizmo is available for both root and nested items (except Select mode)
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
    this.scene.traverse(child => {
      if (child.userData.visualEditorItemId && !child.userData.__selectionHighlight) {
        pickable.push(child);
      }
    });

    const hits = raycaster.intersectObjects(pickable, true);
    if (hits.length > 0) {
      let hit: THREE.Object3D | null = hits[0].object;
      while (hit && !hit.userData.visualEditorItemId) hit = hit.parent;
      if (hit?.userData.visualEditorItemId) {
        this.selectItem(hit.userData.visualEditorItemId as string);
        return;
      }
    }
    this.selectItem(null);
  }

  // ── Inspector ─────────────────────────────────────────────────────

  private refreshInspector(): void {
    if (!this.inspectorEl || !this.workingArch) return;
    if (!this.selectedItemId) {
      this.inspectorEl.innerHTML = '<div style="color:#555;font-size:12px;">Select an object to inspect</div>';
      return;
    }
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;

    if (item.id === MAIN_ID) {
      this.renderMainInspector();
    } else if (item.propName) {
      this.renderNestedInspector(item);
    } else {
      this.renderSceneObjectInspector(item);
    }
  }

  private renderMainInspector(): void {
    if (!this.inspectorEl || !this.workingArch) return;
    const mainItem = this.items.find(i => i.id === MAIN_ID);
    const t = mainItem?.mesh.position ?? new THREE.Vector3();
    const r = mainItem?.mesh.rotation ?? new THREE.Euler();
    const s = mainItem?.mesh.scale ?? new THREE.Vector3(1, 1, 1);

    // Render-type props and custom props, skip nested_archetype (shown as separate objects)
    const propsHtml = this.workingArch.properties
      .filter(p => !(p.type === 'object' && p.objectKind === 'nested_archetype'))
      .map((prop, idx) => `
        <div style="margin-bottom:10px;">
          <div style="font-size:10px;color:#888;margin-bottom:3px;">${esc(prop.name)}</div>
          ${this.renderPropInput(prop, prop.default, `main-${idx}`)}
        </div>
      `).join('');

    this.inspectorEl.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:#58a6ff;margin-bottom:12px;">
        ${esc(this.archetypeId!)}
      </div>
      <div style="font-size:10px;color:#555;text-transform:uppercase;
           letter-spacing:.06em;margin-bottom:8px;">Transform</div>
      <div id="ave-transform-section" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">POS</span>
          ${['px','py','pz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="0.1"
              value="${this.fmtNum(f === 'px' ? t.x : f === 'py' ? t.y : t.z)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">ROT</span>
          ${['rx','ry','rz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="1"
              value="${this.fmtNum(THREE.MathUtils.radToDeg(f === 'rx' ? r.x : f === 'ry' ? r.y : r.z), 1)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">SCL</span>
          ${['sx','sy','sz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="0.1"
              value="${this.fmtNum(f === 'sx' ? s.x : f === 'sy' ? s.y : s.z)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
      </div>
      <div style="font-size:10px;color:#555;text-transform:uppercase;
           letter-spacing:.06em;margin-bottom:8px;">Properties</div>
      ${propsHtml || '<div style="color:#555;font-size:11px;">No properties</div>'}
    `;
    this.bindInspectorPropEvents();
    this.bindTransformInputEvents();
  }

  private renderNestedInspector(item: VisualItem): void {
    if (!this.inspectorEl || !this.workingArch || !this.schema || !item.propName) return;

    const prop = this.workingArch.properties.find(p => p.name === item.propName);
    if (!prop || !isNestedArchetypeValue(prop.default)) return;

    const nestedValue = prop.default as NestedArchetypeValue;
    const nestedArch = this.schema.archetypes[nestedValue.archetypeId];
    const t = item.mesh.position;
    const r = item.mesh.rotation;
    const s = item.mesh.scale;

    const overrides = nestedValue.overrides ?? {};
    const nestedPropsHtml = nestedArch
      ? nestedArch.properties
          .filter(p => !(p.type === 'object' && p.objectKind === 'nested_archetype'))
          .map((p, idx) => {
            const val = overrides[p.name] !== undefined ? overrides[p.name] : p.default;
            return `
              <div style="margin-bottom:10px;">
                <div style="font-size:10px;color:#888;margin-bottom:3px;">${esc(p.name)}</div>
                ${this.renderPropInput(p, val, `nested-${idx}`)}
              </div>`;
          }).join('')
      : '';

    this.inspectorEl.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:#e8a020;margin-bottom:12px;">
        ${esc(item.label)}
      </div>

      <div style="font-size:10px;color:#555;text-transform:uppercase;
           letter-spacing:.06em;margin-bottom:8px;">Transform</div>
      <div id="ave-transform-section" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">POS</span>
          ${['px','py','pz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="0.1"
              value="${this.fmtNum(f === 'px' ? t.x : f === 'py' ? t.y : t.z)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">ROT</span>
          ${['rx','ry','rz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="1"
              value="${this.fmtNum(THREE.MathUtils.radToDeg(f === 'rx' ? r.x : f === 'ry' ? r.y : r.z), 1)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">SCL</span>
          ${['sx','sy','sz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="0.1"
              value="${this.fmtNum(f === 'sx' ? s.x : f === 'sy' ? s.y : s.z)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
      </div>

      ${nestedPropsHtml ? `
        <div style="font-size:10px;color:#555;text-transform:uppercase;
             letter-spacing:.06em;margin-bottom:8px;">Properties</div>
        ${nestedPropsHtml}
      ` : ''}
    `;

    this.bindInspectorPropEvents();
    this.bindTransformInputEvents();
  }

  private renderSceneObjectInspector(item: VisualItem): void {
    if (!this.inspectorEl) return;
    const t = item.mesh.position;
    const r = item.mesh.rotation;
    const s = item.mesh.scale;

    this.inspectorEl.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:#58a6ff;margin-bottom:12px;">
        ${esc(item.label)}
      </div>
      <div style="font-size:10px;color:#555;text-transform:uppercase;
           letter-spacing:.06em;margin-bottom:8px;">Transform</div>
      <div id="ave-transform-section" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">POS</span>
          ${['px','py','pz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="0.1"
              value="${this.fmtNum(f === 'px' ? t.x : f === 'py' ? t.y : t.z)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">ROT</span>
          ${['rx','ry','rz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="1"
              value="${this.fmtNum(THREE.MathUtils.radToDeg(f === 'rx' ? r.x : f === 'ry' ? r.y : r.z), 1)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:10px;color:#666;width:24px;flex-shrink:0;">SCL</span>
          ${['sx','sy','sz'].map(f => `
            <input class="ave-transform" data-field="${f}" type="number" step="0.1"
              value="${this.fmtNum(f === 'sx' ? s.x : f === 'sy' ? s.y : s.z)}"
              style="${this.inputStyle()}"/>`).join('')}
        </div>
      </div>
    `;
    this.bindTransformInputEvents();
  }

  private inputStyle(): string {
    return [
      'background:#0d1117',
      'border:1px solid #30363d',
      'color:#c9d1d9',
      'padding:3px 4px',
      'border-radius:3px',
      'font-size:11px',
      'outline:none',
      'width:0',
      'flex:1',
      'text-align:center',
    ].join(';');
  }

  private fmtNum(v: number, decimals = 3): string {
    return v.toFixed(decimals);
  }

  private renderPropInput(prop: ArchetypePropertyDef, value: unknown, id: string): string {
    const v = value !== undefined && value !== null ? value : prop.default;
    switch (prop.type) {
      case 'boolean':
        return `<input class="ave-prop" data-prop-id="${esc(id)}" type="checkbox"
            ${v ? 'checked' : ''} style="transform:scale(1.1);">`;
      case 'number':
        return `<input class="ave-prop" data-prop-id="${esc(id)}" type="number"
            value="${esc(v ?? 0)}" step="0.01" style="${this.propInputStyle()}">`;
      case 'color_hex':
        return `<input class="ave-prop" data-prop-id="${esc(id)}" type="color"
            value="${esc(v ?? '#ffffff')}"
            style="background:#0d1117;border:1px solid #30363d;padding:3px;
                   outline:none;width:44px;height:28px;">`;
      case 'enum':
        return `<select class="ave-prop" data-prop-id="${esc(id)}"
            style="${this.propInputStyle()}">
          ${(prop.options ?? []).map(opt =>
            `<option value="${esc(opt)}" ${opt === String(v) ? 'selected' : ''}>${esc(opt)}</option>`
          ).join('')}
        </select>`;
      default:
        return `<input class="ave-prop" data-prop-id="${esc(id)}" type="text"
            value="${esc(v ?? '')}" style="${this.propInputStyle()}">`;
    }
  }

  private propInputStyle(): string {
    return [
      'background:#0d1117',
      'border:1px solid #30363d',
      'color:#c9d1d9',
      'padding:4px 6px',
      'border-radius:3px',
      'font-size:11px',
      'outline:none',
      'width:100%',
      'box-sizing:border-box',
    ].join(';');
  }

  private bindTransformInputEvents(): void {
    this.inspectorEl?.querySelectorAll<HTMLInputElement>('.ave-transform').forEach(input => {
      input.addEventListener('change', () => this.applyTransformInputs());
    });
  }

  private bindInspectorPropEvents(): void {
    this.inspectorEl?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.ave-prop').forEach(input => {
      input.addEventListener('change', () => this.collectInspectorProps());
    });
  }

  // ── Inspector — Transform input → mesh ────────────────────────────

  private applyTransformInputs(): void {
    if (!this.selectedItemId) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;

    const get = (field: string): number => {
      const el = this.inspectorEl?.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      return el ? parseFloat(el.value) || 0 : 0;
    };

    item.mesh.position.set(get('px'), get('py'), get('pz'));
    item.mesh.rotation.set(
      THREE.MathUtils.degToRad(get('rx')),
      THREE.MathUtils.degToRad(get('ry')),
      THREE.MathUtils.degToRad(get('rz')),
    );
    item.mesh.scale.set(get('sx'), get('sy'), get('sz'));
    this.syncMeshToWorkingState(item);
  }

  // ── Inspector — prop change → workingArch ─────────────────────────

  private collectInspectorProps(): void {
    if (!this.selectedItemId || !this.workingArch || !this.schema) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item) return;

    if (item.id === MAIN_ID) {
      // Collect main arch property defaults (skip nested_archetype props)
      let idx = 0;
      this.workingArch.properties.forEach((prop) => {
        if (prop.type === 'object' && prop.objectKind === 'nested_archetype') return;
        const el = this.inspectorEl?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-prop-id="main-${idx}"]`);
        if (el) prop.default = this.readInput(prop.type, el);
        idx++;
      });
    } else if (item.propName) {
      // Collect nested property overrides
      const parentProp = this.workingArch.properties.find(p => p.name === item.propName);
      if (!parentProp || !isNestedArchetypeValue(parentProp.default)) return;
      const nestedValue = parentProp.default as NestedArchetypeValue;
      const nestedArch = this.schema.archetypes[nestedValue.archetypeId];
      if (!nestedArch) return;

      const overrides: Record<string, unknown> = { ...(nestedValue.overrides ?? {}) };
      let idx = 0;
      nestedArch.properties.forEach((p) => {
        if (p.type === 'object' && p.objectKind === 'nested_archetype') return;
        const el = this.inspectorEl?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-prop-id="nested-${idx}"]`);
        if (el) overrides[p.name] = this.readInput(p.type, el);
        idx++;
      });
      nestedValue.overrides = overrides;
    }
  }

  private readInput(type: string, el: HTMLInputElement | HTMLSelectElement): unknown {
    if (type === 'boolean') return (el as HTMLInputElement).checked;
    if (type === 'number') return parseFloat(el.value) || 0;
    return el.value;
  }

  // ── Gizmo → Working State Sync ────────────────────────────────────

  /** Called on every gizmo objectChange event */
  private syncGizmoToWorkingState(): void {
    if (!this.selectedItemId) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (item) this.syncMeshToWorkingState(item);
  }

  /** Flush the current mesh transform to NestedArchetypeValue.transform */
  private syncMeshToWorkingState(item: VisualItem): void {
    if (item.id === MAIN_ID) {
      if (!this.workingArch) return;
      this.workingArch.defaultTransform = {
        position: {
          x: item.mesh.position.x,
          y: item.mesh.position.y,
          z: item.mesh.position.z,
        },
        rotation: {
          x: THREE.MathUtils.radToDeg(item.mesh.rotation.x),
          y: THREE.MathUtils.radToDeg(item.mesh.rotation.y),
          z: THREE.MathUtils.radToDeg(item.mesh.rotation.z),
        },
        scale: {
          x: item.mesh.scale.x,
          y: item.mesh.scale.y,
          z: item.mesh.scale.z,
        },
      };
      return;
    }

    // Persist transforms for nested archetype children (scene nodes)
    // Items representing child scene objects have ids like "<propName>:<uuid>" and
    // do not set `propName` on the VisualItem. Save their local transform into the
    // parent nested archetype's `overrides.__childTransforms` map keyed by a
    // slash-separated name path so the engine can re-apply it when instancing.
    if (!item.propName && item.id.includes(':') && this.workingArch) {
      const ownerPropName = item.ownerPropName;
      if (!ownerPropName) return;
      const prop = this.workingArch.properties.find(p => p.name === ownerPropName);
      if (!prop || !isNestedArchetypeValue(prop.default)) return;
      const nv = prop.default as NestedArchetypeValue;
      // If the nested slot has no archetype selected, do not persist child transforms.
      if (!nv.archetypeId) return;
      const overrides: Record<string, unknown> = { ...(nv.overrides ?? {}) };

      // Build a stable name-path for the child by walking up the object tree
      // until we hit the nested root mesh (whose visualEditorItemId === parentId).
      const nameSegments: string[] = [];
      let node: THREE.Object3D | null = item.mesh;
      while (node) {
        if (node.name) nameSegments.unshift(node.name);
        const parent = node.parent as THREE.Object3D | null;
        if (!parent) break;
        const uid = parent.userData?.visualEditorItemId as string | undefined;
        if (uid === ownerPropName) break;
        node = parent;
      }

      const path = nameSegments.join('/') || item.mesh.name || item.id;

      const childTransforms: Record<string, unknown> = (overrides.__childTransforms as Record<string, unknown>) ?? {};
      childTransforms[path] = {
        position: { x: item.mesh.position.x, y: item.mesh.position.y, z: item.mesh.position.z },
        rotation: { x: THREE.MathUtils.radToDeg(item.mesh.rotation.x), y: THREE.MathUtils.radToDeg(item.mesh.rotation.y), z: THREE.MathUtils.radToDeg(item.mesh.rotation.z) },
        scale: { x: item.mesh.scale.x, y: item.mesh.scale.y, z: item.mesh.scale.z },
      };
      overrides.__childTransforms = childTransforms;
      nv.overrides = overrides;
      return;
    }

    if (!item.propName || !this.workingArch) return;
    const prop = this.workingArch.properties.find(p => p.name === item.propName);
    if (!prop || !isNestedArchetypeValue(prop.default)) return;

    const nv = prop.default as NestedArchetypeValue;
    // Only persist transforms for nested slots that actually reference an archetype
    if (!nv.archetypeId) return;
    nv.transform = {
      position: {
        x: item.mesh.position.x,
        y: item.mesh.position.y,
        z: item.mesh.position.z,
      },
      rotation: {
        x: THREE.MathUtils.radToDeg(item.mesh.rotation.x),
        y: THREE.MathUtils.radToDeg(item.mesh.rotation.y),
        z: THREE.MathUtils.radToDeg(item.mesh.rotation.z),
      },
      scale: {
        x: item.mesh.scale.x,
        y: item.mesh.scale.y,
        z: item.mesh.scale.z,
      },
    };
  }

  // ── Inspector Transform Refresh (gizmo-driven) ────────────────────

  /** Re-fills the numeric transform inputs from the mesh without rebuilding the inspector */
  private refreshInspectorTransform(): void {
    if (!this.selectedItemId) return;
    const item = this.items.find(i => i.id === this.selectedItemId);
    if (!item || !this.inspectorEl) return;

    const t = item.mesh.position;
    const r = item.mesh.rotation;
    const s = item.mesh.scale;

    const set = (field: string, v: number, decimals = 3) => {
      const el = this.inspectorEl?.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
      if (el) el.value = v.toFixed(decimals);
    };

    set('px', t.x); set('py', t.y); set('pz', t.z);
    set('rx', THREE.MathUtils.radToDeg(r.x), 1);
    set('ry', THREE.MathUtils.radToDeg(r.y), 1);
    set('rz', THREE.MathUtils.radToDeg(r.z), 1);
    set('sx', s.x); set('sy', s.y); set('sz', s.z);
  }

  // ── Save ──────────────────────────────────────────────────────────

  private saveAndClose(): void {
    if (!this.workingArch || !this.archetypeId) return;

    // Flush any pending inspector state
    this.collectInspectorProps();

    // Flush all mesh transforms to workingArch
    for (const item of this.items) {
      this.syncMeshToWorkingState(item);
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
      if (child.userData.__selectionHighlight) return;
      if (!child.visible) return;
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
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
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
