/* ═══════════════════════════════════════════════════════════════════════
   ArchetypeEditorPanel — CRUD UI for creating and editing archetypes.

   An archetype is a pure data wrapper:
     • properties  — named data fields with types and defaults
     • children    — visual child objects (primitive / light / sprite / …)

   Visual positioning of children is handled by ArchetypeVisualEditorPanel.
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  ArchetypeSchema,
  ArchetypeDef,
  ArchetypePropertyDef,
  ArchetypePropertyType,
  ChildEntityType,
} from '../types/entities';
import {
  createDefaultChildDef,
  createDefaultTransform,
} from '../types/entities';
import { ArchetypeVisualEditorPanel } from './ArchetypeVisualEditorPanel';

// ── Constants ──────────────────────────────────────────────────────────

const PROP_TYPES: ArchetypePropertyType[] = [
  'boolean', 'number', 'string', 'enum', 'asset_select',
  'color_hex', 'array_of_ids', 'vec3',
];

const CHILD_ENTITY_TYPES: ChildEntityType[] = [
  'primitive', 'light', 'sprite', 'animated_sprite', 'sound', 'trigger',
];

const CHILD_TYPE_ICONS: Record<ChildEntityType, string> = {
  primitive: '⬛',
  light: '💡',
  sprite: '🖼',
  animated_sprite: '🎞',
  sound: '🔊',
  trigger: '⚡',
};

// ── Helpers ────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ══════════════════════════════════════════════════════════════════════

export class ArchetypeEditorPanel {
  private el: HTMLElement;
  private schema: ArchetypeSchema = { archetypes: {} };
  private selectedId: string | null = null;
  private searchQuery = '';

  // Property picker
  private propPickerOpen = false;
  private pendingPropName = 'newProp';
  private pendingPropType: ArchetypePropertyType = 'string';
  private pendingPropDefault = '';

  // Child picker
  private childPickerOpen = false;
  private pendingChildType: ChildEntityType = 'primitive';
  private pendingChildName = 'child';

  private onSave: (schema: ArchetypeSchema) => Promise<void>;
  private visualEditor: ArchetypeVisualEditorPanel;

  constructor(parentEl: HTMLElement, onSave: (schema: ArchetypeSchema) => Promise<void>) {
    this.onSave = onSave;

    this.el = document.createElement('div');
    this.el.id = 'archetype-editor-overlay';
    this.el.style.cssText = [
      'display:none',
      'position:absolute',
      'top:0', 'left:0', 'right:0', 'bottom:0',
      'background:#0d1117',
      'z-index:10',
      'flex-direction:row',
      'overflow:hidden',
      'color:#c9d1d9',
      'font-family:Inter,system-ui,sans-serif',
      'font-size:13px',
    ].join(';');
    parentEl.appendChild(this.el);

    const body = parentEl.ownerDocument?.body ?? document.body;
    this.visualEditor = new ArchetypeVisualEditorPanel(body, (archetypeId, updatedArch) => {
      this.schema.archetypes[archetypeId] = updatedArch;
      this.render();
      void this.onSave(this.schema);
    });
  }

  // ── Public API ────────────────────────────────────────────────────

  public show(schema: ArchetypeSchema): void {
    this.schema = JSON.parse(JSON.stringify(schema));
    this.el.style.display = 'flex';
    this.render();
  }

  public hide(): void {
    this.el.style.display = 'none';
  }

  // ── Rendering ─────────────────────────────────────────────────────

  private render(): void {
    const userArchetypes = Object.keys(this.schema.archetypes).filter(k => !k.startsWith('_sys:'));
    const filtered = userArchetypes.filter(k =>
      !this.searchQuery || k.toLowerCase().includes(this.searchQuery.toLowerCase()),
    );

    const listItems = filtered.map(k => {
      const a = this.schema.archetypes[k];
      const sel = k === this.selectedId
        ? 'background:#161b22;border-left:2px solid #58a6ff;'
        : '';
      const childCount = (a.children ?? []).length;
      const propCount = (a.properties ?? []).length;
      return `
        <li data-archetype-id="${esc(k)}" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:2px solid transparent;${sel}">
          <span style="width:8px;height:8px;border-radius:50%;background:#e8a020;flex-shrink:0;"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(k)}</span>
          <span style="font-size:10px;color:#555;">${propCount}P ${childCount}C</span>
        </li>`;
    }).join('');

    const formHtml = this.selectedId && this.schema.archetypes[this.selectedId]
      ? this.renderForm(this.selectedId, this.schema.archetypes[this.selectedId])
      : `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#444;font-size:14px;">
           Select an archetype or create a new one
         </div>`;

    this.el.innerHTML = `
      <div style="width:260px;border-right:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:12px;border-bottom:1px solid #21262d;">
          <div style="font-weight:600;color:#58a6ff;margin-bottom:8px;">Archetypes</div>
          <input id="arch-search" type="text" placeholder="Search…" value="${esc(this.searchQuery)}"
            style="width:100%;box-sizing:border-box;background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:5px 8px;border-radius:4px;font-size:12px;outline:none;">
        </div>
        <ul id="arch-list" style="list-style:none;margin:0;padding:0;flex:1;overflow-y:auto;">
          ${listItems || '<li style="padding:12px;color:#555;font-size:12px;">No archetypes found</li>'}
        </ul>
        <div style="padding:8px;border-top:1px solid #21262d;">
          <button id="arch-new-btn" style="width:100%;padding:7px;background:#238636;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">+ New Archetype</button>
        </div>
      </div>

      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;">
        ${formHtml}
      </div>

      ${this.renderPropPicker()}
      ${this.renderChildPicker()}
    `;

    this.bindEvents();
  }

  private renderForm(id: string, arch: ArchetypeDef): string {
    const props = arch.properties ?? [];
    const propsHtml = props.map((p, i) => this.renderPropRow(p, i)).join('');

    const children = arch.children ?? [];
    const childrenHtml = children.length
      ? children.map((c, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0d1117;border:1px solid #21262d;border-radius:4px;margin-bottom:4px;">
            <span style="font-size:14px;line-height:1;">${CHILD_TYPE_ICONS[c.entityType] ?? '▪'}</span>
            <span style="font-size:11px;color:#8b949e;flex-shrink:0;">${esc(c.entityType)}</span>
            <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.name)}</span>
            <button class="arch-child-remove" data-child-index="${i}"
              style="background:transparent;border:1px solid #f85149;color:#f85149;padding:1px 6px;border-radius:3px;cursor:pointer;font-size:11px;flex-shrink:0;">✕</button>
          </div>`)
        .join('')
      : '<div style="color:#555;font-size:11px;padding:6px 0;">No visual children — add objects to give this archetype a 3D form.</div>';

    return `
      <div style="padding:20px;flex:1;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:600;color:#58a6ff;">${esc(id)}</div>
          <div style="display:flex;gap:8px;">
            <button id="arch-visual-editor-btn"
              style="background:#1f6feb;border:none;color:#fff;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;">
              Visual Editor
            </button>
            <button id="arch-delete-btn"
              style="background:transparent;border:1px solid #f85149;color:#f85149;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;">
              Delete
            </button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#888;">Category</span>
            <input id="arch-category" type="text" value="${esc(arch.category)}"
              style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#888;">Default Verbs</span>
            <input id="arch-verbs" type="text" value="${esc((arch.defaultVerbs ?? []).join(', '))}"
              style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
          <span style="font-size:11px;color:#888;">Description</span>
          <input id="arch-description" type="text" value="${esc(arch.description)}"
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;width:100%;box-sizing:border-box;">
        </label>

        <div style="margin-bottom:20px;">
          <div style="font-size:11px;color:#888;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Properties</span>
            <button id="arch-add-prop"
              style="background:#1f6feb;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">+ Add</button>
          </div>
          <div id="arch-props-list">
            ${propsHtml || '<div style="color:#555;font-size:11px;padding:6px 0;">No properties defined.</div>'}
          </div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:11px;color:#888;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:600;text-transform:uppercase;letter-spacing:.04em;">Visual Children</span>
            <button id="arch-add-child"
              style="background:#1f6feb;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">+ Add</button>
          </div>
          <div id="arch-children-list" style="display:flex;flex-direction:column;">
            ${childrenHtml}
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:12px;">
          <button id="arch-save-btn"
            style="background:#238636;color:#fff;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">
            Save Archetype
          </button>
          <span id="arch-save-status" style="font-size:11px;color:#888;"></span>
        </div>
      </div>
    `;
  }

  private renderPropRow(prop: ArchetypePropertyDef, index: number): string {
    const base = 'background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;';
    let defField = '';
    switch (prop.type) {
      case 'boolean':
        defField = `<input class="arch-prop-default" type="checkbox" ${prop.default ? 'checked' : ''} style="margin-left:4px;">`;
        break;
      case 'number':
        defField = `<input class="arch-prop-default" type="number" value="${esc(String(prop.default ?? '0'))}" style="${base}width:100px;">`;
        break;
      case 'color_hex':
        defField = `<input class="arch-prop-default" type="color" value="${esc(String(prop.default ?? '#ffffff'))}"
          style="background:#0d1117;border:1px solid #30363d;padding:3px;outline:none;width:44px;height:32px;">`;
        break;
      default:
        defField = `<input class="arch-prop-default" type="text" value="${esc(String(prop.default ?? ''))}" style="${base}">`;
    }
    return `
      <div class="arch-prop-row" data-prop-index="${index}"
        style="display:grid;grid-template-columns:1fr 120px 1fr auto;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid #21262d;">
        <input class="arch-prop-name" type="text" value="${esc(prop.name)}" placeholder="name"
          style="${base}">
        <select class="arch-prop-type" style="${base}">
          ${PROP_TYPES.map(t => `<option value="${t}" ${t === prop.type ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        ${defField}
        <button class="arch-prop-remove" data-index="${index}"
          style="background:transparent;border:1px solid #f85149;color:#f85149;padding:2px 7px;border-radius:3px;cursor:pointer;font-size:11px;">✕</button>
      </div>`;
  }

  private renderPropPicker(): string {
    if (!this.propPickerOpen) return '';
    const base = 'background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;';
    return `
      <div id="arch-prop-picker-overlay" style="position:absolute;inset:0;background:rgba(1,4,9,.72);display:flex;align-items:center;justify-content:center;z-index:20;">
        <div style="width:min(480px,calc(100vw - 48px));background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:600;color:#58a6ff;">Add Property</div>
            <button id="arch-prop-picker-close" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:4px 9px;border-radius:4px;cursor:pointer;">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <label style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-size:11px;color:#8b949e;">Property Name</span>
              <input id="arch-prop-picker-name" type="text" value="${esc(this.pendingPropName)}" style="${base}">
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-size:11px;color:#8b949e;">Type</span>
              <select id="arch-prop-picker-type" style="${base}">
                ${PROP_TYPES.map(t => `<option value="${t}" ${t === this.pendingPropType ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </label>
          </div>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#8b949e;">Default Value</span>
            <input id="arch-prop-picker-default" type="text" value="${esc(this.pendingPropDefault)}" style="${base}">
          </label>
          <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="arch-prop-picker-cancel" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:6px 12px;border-radius:4px;cursor:pointer;">Cancel</button>
            <button id="arch-prop-picker-create" style="background:#238636;border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;">Add Property</button>
          </div>
        </div>
      </div>`;
  }

  private renderChildPicker(): string {
    if (!this.childPickerOpen) return '';
    const base = 'background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;';
    return `
      <div id="arch-child-picker-overlay" style="position:absolute;inset:0;background:rgba(1,4,9,.72);display:flex;align-items:center;justify-content:center;z-index:20;">
        <div style="width:min(480px,calc(100vw - 48px));background:#0d1117;border:1px solid #30363d;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:15px;font-weight:600;color:#58a6ff;">Add Visual Child</div>
            <button id="arch-child-picker-close" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:4px 9px;border-radius:4px;cursor:pointer;">✕</button>
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
            <input id="arch-child-picker-name" type="text" value="${esc(this.pendingChildName)}" style="${base}">
          </label>
          <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="arch-child-picker-cancel" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:6px 12px;border-radius:4px;cursor:pointer;">Cancel</button>
            <button id="arch-child-picker-create" style="background:#238636;border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;">Add Child</button>
          </div>
        </div>
      </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private bindEvents(): void {
    const searchEl = this.el.querySelector<HTMLInputElement>('#arch-search');
    searchEl?.addEventListener('input', () => { this.searchQuery = searchEl.value; this.render(); });

    this.el.querySelectorAll<HTMLElement>('[data-archetype-id]').forEach(li => {
      li.addEventListener('click', () => { this.selectedId = li.dataset.archetypeId!; this.render(); });
    });

    this.el.querySelector('#arch-new-btn')?.addEventListener('click', () => this.createNew());

    if (!this.selectedId) return;

    this.el.querySelector('#arch-visual-editor-btn')?.addEventListener('click', () => {
      if (!this.selectedId || !this.schema.archetypes[this.selectedId]) return;
      this.collectCurrentForm();
      this.visualEditor.show(this.schema, this.selectedId);
    });

    this.el.querySelector('#arch-delete-btn')?.addEventListener('click', async () => {
      if (!this.selectedId) return;
      if (!confirm(`Delete archetype "${this.selectedId}"? This cannot be undone.`)) return;
      delete this.schema.archetypes[this.selectedId];
      this.selectedId = null;
      this.render();
      await this.persistSchema().catch(console.error);
    });

    this.el.querySelector('#arch-add-prop')?.addEventListener('click', () => {
      this.collectCurrentForm();
      this.propPickerOpen = true;
      this.pendingPropName = 'newProp';
      this.pendingPropType = 'string';
      this.pendingPropDefault = '';
      this.render();
    });

    this.el.querySelector('#arch-add-child')?.addEventListener('click', () => {
      this.collectCurrentForm();
      this.childPickerOpen = true;
      this.pendingChildType = 'primitive';
      this.pendingChildName = 'child';
      this.render();
    });

    this.el.querySelectorAll<HTMLElement>('.arch-prop-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.selectedId) return;
        const idx = parseInt(btn.dataset.index ?? '0');
        this.schema.archetypes[this.selectedId].properties.splice(idx, 1);
        this.render();
      });
    });

    this.el.querySelectorAll<HTMLElement>('.arch-child-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.selectedId) return;
        const idx = parseInt(btn.dataset.childIndex ?? '0');
        const arch = this.schema.archetypes[this.selectedId];
        if (!arch.children) arch.children = [];
        arch.children.splice(idx, 1);
        this.render();
      });
    });

    this.el.querySelector('#arch-save-btn')?.addEventListener('click', async () => {
      await this.saveCurrentArchetype();
    });

    this.bindPropPickerEvents();
    this.bindChildPickerEvents();
  }

  private bindPropPickerEvents(): void {
    this.el.querySelector('#arch-prop-picker-close')?.addEventListener('click', () => { this.propPickerOpen = false; this.render(); });
    this.el.querySelector('#arch-prop-picker-cancel')?.addEventListener('click', () => { this.propPickerOpen = false; this.render(); });
    (this.el.querySelector<HTMLInputElement>('#arch-prop-picker-name'))?.addEventListener('input', e => { this.pendingPropName = (e.target as HTMLInputElement).value; });
    (this.el.querySelector<HTMLSelectElement>('#arch-prop-picker-type'))?.addEventListener('change', e => { this.pendingPropType = (e.target as HTMLSelectElement).value as ArchetypePropertyType; });
    (this.el.querySelector<HTMLInputElement>('#arch-prop-picker-default'))?.addEventListener('input', e => { this.pendingPropDefault = (e.target as HTMLInputElement).value; });
    this.el.querySelector('#arch-prop-picker-create')?.addEventListener('click', () => this.commitPendingProp());
  }

  private bindChildPickerEvents(): void {
    this.el.querySelector('#arch-child-picker-close')?.addEventListener('click', () => { this.childPickerOpen = false; this.render(); });
    this.el.querySelector('#arch-child-picker-cancel')?.addEventListener('click', () => { this.childPickerOpen = false; this.render(); });
    this.el.querySelectorAll<HTMLElement>('[data-child-type-btn]').forEach(btn => {
      btn.addEventListener('click', () => { this.pendingChildType = btn.dataset.childTypeBtn as ChildEntityType; this.render(); });
    });
    (this.el.querySelector<HTMLInputElement>('#arch-child-picker-name'))?.addEventListener('input', e => { this.pendingChildName = (e.target as HTMLInputElement).value; });
    this.el.querySelector('#arch-child-picker-create')?.addEventListener('click', () => this.commitPendingChild());
  }

  // ── Collect / Commit ──────────────────────────────────────────────

  private collectCurrentForm(): void {
    if (!this.selectedId) return;
    const arch = this.schema.archetypes[this.selectedId];
    if (!arch) return;

    arch.category = this.el.querySelector<HTMLInputElement>('#arch-category')?.value ?? arch.category;
    arch.description = this.el.querySelector<HTMLInputElement>('#arch-description')?.value ?? arch.description;
    const verbsStr = this.el.querySelector<HTMLInputElement>('#arch-verbs')?.value ?? '';
    arch.defaultVerbs = verbsStr.split(',').map(s => s.trim()).filter(Boolean);

    this.el.querySelectorAll<HTMLElement>('.arch-prop-row').forEach(row => {
      const index = Number(row.dataset.propIndex);
      if (!Number.isFinite(index) || !arch.properties[index]) return;
      const prop = arch.properties[index];
      const nameEl = row.querySelector<HTMLInputElement>('.arch-prop-name');
      const typeEl = row.querySelector<HTMLSelectElement>('.arch-prop-type');
      const defEl = row.querySelector<HTMLInputElement | HTMLSelectElement>('.arch-prop-default');
      if (nameEl) prop.name = nameEl.value;
      if (typeEl) prop.type = typeEl.value as ArchetypePropertyType;
      if (defEl) {
        switch (prop.type) {
          case 'boolean': prop.default = (defEl as HTMLInputElement).checked; break;
          case 'number': prop.default = Number(defEl.value); break;
          default: prop.default = defEl.value;
        }
      }
    });
  }

  private commitPendingProp(): void {
    if (!this.selectedId) return;
    const name = this.pendingPropName.trim();
    if (!name) { alert('Property name is required.'); return; }
    const arch = this.schema.archetypes[this.selectedId];
    if (!arch.properties) arch.properties = [];
    if (arch.properties.some(p => p.name === name)) { alert(`Property "${name}" already exists.`); return; }
    let defVal: unknown;
    switch (this.pendingPropType) {
      case 'boolean': defVal = this.pendingPropDefault === 'true'; break;
      case 'number': defVal = Number(this.pendingPropDefault || '0'); break;
      default: defVal = this.pendingPropDefault;
    }
    arch.properties.push({ name, type: this.pendingPropType, default: defVal });
    this.propPickerOpen = false;
    this.render();
  }

  private commitPendingChild(): void {
    if (!this.selectedId) return;
    const name = this.pendingChildName.trim() || this.pendingChildType;
    const arch = this.schema.archetypes[this.selectedId];
    if (!arch.children) arch.children = [];
    arch.children.push(createDefaultChildDef(this.pendingChildType, name));
    this.childPickerOpen = false;
    this.render();
  }

  // ── Persistence ───────────────────────────────────────────────────

  private async saveCurrentArchetype(): Promise<void> {
    this.collectCurrentForm();
    const statusEl = this.el.querySelector<HTMLElement>('#arch-save-status');
    if (statusEl) statusEl.textContent = 'Saving…';
    try {
      await this.persistSchema();
      if (statusEl) statusEl.textContent = '✓ Saved';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    } catch {
      if (statusEl) statusEl.textContent = '✗ Save failed';
    }
  }

  private async persistSchema(): Promise<void> {
    const res = await fetch('/api/save-archetypes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.schema),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await this.onSave(this.schema);
  }

  // ── Factory ───────────────────────────────────────────────────────

  private createNew(): void {
    const name = prompt('Archetype name (e.g., "Lamp", "Barrel", "NPC"):');
    if (!name?.trim()) return;
    const id = name.trim();
    if (this.schema.archetypes[id]) { alert(`"${id}" already exists.`); return; }
    this.schema.archetypes[id] = {
      category: 'Custom',
      description: '',
      defaultTransform: createDefaultTransform(),
      sockets: { inputs: [], outputs: [] },
      properties: [],
      defaultVerbs: [],
      children: [],
    };
    this.selectedId = id;
    this.render();
  }
}
