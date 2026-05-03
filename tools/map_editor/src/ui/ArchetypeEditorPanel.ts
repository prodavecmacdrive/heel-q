/* ═══════════════════════════════════════════════════════════════════════
   ArchetypeEditorPanel — CRUD UI for creating and editing archetypes
   ═══════════════════════════════════════════════════════════════════════ */

import type { ArchetypeSchema, ArchetypeDef, ArchetypePropertyDef, ArchetypePropertyType, NestedArchetypeValue } from '../types/entities';
import { createDefaultNestedArchetypeValue, createDefaultTransform, isNestedArchetypeValue } from '../types/entities';
import { ArchetypeVisualEditorPanel } from './ArchetypeVisualEditorPanel';

const RENDER_TYPES = [
  'sprite', 'animated_sprite', 'primitive', 'texture', 'camera', 'light',
  'sound', 'trigger', 'spawn', 'door',
];

const PROP_TYPES: ArchetypePropertyType[] = [
  'boolean', 'number', 'string', 'enum', 'asset_select',
  'color_hex', 'array_of_ids', 'vec3', 'object',
];

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export class ArchetypeEditorPanel {
  private el: HTMLElement;
  private schema: ArchetypeSchema = { archetypes: {} };
  private selectedId: string | null = null;
  private searchQuery = '';
  private propertyPickerOpen = false;
  private pendingPropertyTemplate: 'property' | 'nested_object' = 'property';
  private pendingPropertyName = 'newProp';
  private pendingPropertyType: ArchetypePropertyType = 'string';
  private pendingPropertyDefault = '';
  private pendingNestedArchetypeId = '';
  private onSave: (schema: ArchetypeSchema) => Promise<void>;
  private visualEditor: ArchetypeVisualEditorPanel;

  constructor(parentEl: HTMLElement, onSave: (schema: ArchetypeSchema) => Promise<void>) {
    this.onSave = onSave;

    this.el = document.createElement('div');
    this.el.id = 'archetype-editor-overlay';
    this.el.style.cssText = `
      display: none;
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: #0d1117;
      z-index: 10;
      flex-direction: row;
      overflow: hidden;
      color: #c9d1d9;
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px;
    `;
    parentEl.appendChild(this.el);

    // Visual editor sub-panel mounted on body so it can float above the overlay.
    const body = parentEl.ownerDocument?.body ?? document.body;
    this.visualEditor = new ArchetypeVisualEditorPanel(body, (archetypeId, updatedArch) => {
      this.schema.archetypes[archetypeId] = updatedArch;
      this.render();
      // Persist to disk (fire-and-forget)
      void this.onSave(this.schema);
    });

    // Listen for external schema updates
    this.el.addEventListener('schema-updated', (e: Event) => {
      const schema = (e as CustomEvent<ArchetypeSchema>).detail;
      this.schema = JSON.parse(JSON.stringify(schema));
      this.render();
    });
  }

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
    const sysArchetypes = Object.keys(this.schema.archetypes).filter(k => k.startsWith('_sys:'));

    const filtered = userArchetypes.filter(k =>
      !this.searchQuery || k.toLowerCase().includes(this.searchQuery.toLowerCase())
    );

    const listItems = filtered.map(k => {
      const a = this.schema.archetypes[k];
      const sel = k === this.selectedId ? 'background:#161b22;border-left:2px solid #58a6ff;' : '';
      return `<li data-archetype-id="${esc(k)}" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:2px solid transparent;${sel}">
        <span style="width:8px;height:8px;border-radius:50%;background:#e8a020;flex-shrink:0;"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(k)}</span>
        <span style="font-size:10px;color:#555;">${esc(a.category)}</span>
      </li>`;
    }).join('');

    const sysSummary = sysArchetypes.length > 0
      ? `<details style="margin-top:8px;"><summary style="padding:6px 12px;cursor:pointer;color:#555;font-size:11px;">System Types (${sysArchetypes.length})</summary>
          <ul style="list-style:none;margin:0;padding:0;">${sysArchetypes.map(k => `<li style="padding:5px 12px 5px 24px;color:#444;font-size:11px;">${esc(k)}</li>`).join('')}</ul>
        </details>` : '';

    const formHtml = this.selectedId && this.schema.archetypes[this.selectedId]
      ? this.renderForm(this.selectedId, this.schema.archetypes[this.selectedId])
      : `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#444;font-size:14px;">Select an archetype or create a new one</div>`;

    this.el.innerHTML = `
      <div style="width:260px;border-right:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:12px;border-bottom:1px solid #21262d;">
          <div style="font-weight:600;color:#58a6ff;margin-bottom:8px;">Archetypes</div>
          <input id="arch-search" type="text" placeholder="Search..." value="${esc(this.searchQuery)}"
            style="width:100%;box-sizing:border-box;background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:5px 8px;border-radius:4px;font-size:12px;outline:none;">
        </div>
        <ul id="arch-list" style="list-style:none;margin:0;padding:0;flex:1;overflow-y:auto;">
          ${listItems || `<li style="padding:12px;color:#555;font-size:12px;">No archetypes found</li>`}
        </ul>
        ${sysSummary}
        <div style="padding:8px;border-top:1px solid #21262d;">
          <button id="arch-new-btn" style="width:100%;padding:7px;background:#238636;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">+ New Archetype</button>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;">
        ${formHtml}
      </div>
      ${this.renderPropertyPicker()}
    `;

    this.bindEvents();
  }

  private renderForm(id: string, arch: ArchetypeDef): string {
    const isSys = id.startsWith('_sys:');
    if (!isSys) {
      this.syncRenderTypeProperties(arch);
    }

    const customProps = arch.properties
      .map((p, i) => ({ prop: p, index: i }))
      .filter((entry) => !this.isRenderTypePropName(arch.renderType, entry.prop.name));

    const propsHtml = customProps.map(({ prop, index }) => `
      ${this.renderCustomPropertyRow(prop, index, isSys)}
    `).join('');

    return `
      <div style="padding:20px;flex:1;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <div style="font-size:16px;font-weight:600;color:#58a6ff;">${esc(id)}</div>
            ${isSys ? '<span style="font-size:10px;background:#21262d;color:#888;padding:2px 6px;border-radius:3px;">System Type (read-only)</span>' : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${!isSys ? `<button id="arch-visual-editor-btn" style="background:#1f6feb;border:none;color:#fff;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;">Visual Editor</button>` : ''}
            ${!isSys ? `<button id="arch-delete-btn" style="background:transparent;border:1px solid #f85149;color:#f85149;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Delete</button>` : ''}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#888;">Category</span>
            <input id="arch-category" type="text" value="${esc(arch.category)}" ${isSys ? 'disabled' : ''}
              style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:11px;color:#888;">Render Type</span>
            <select id="arch-render-type" ${isSys ? 'disabled' : ''}
              style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
              ${RENDER_TYPES.map(t => `<option value="${t}" ${t === arch.renderType ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </label>
        </div>

        <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
          <span style="font-size:11px;color:#888;">Description</span>
          <input id="arch-description" type="text" value="${esc(arch.description)}" ${isSys ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;width:100%;box-sizing:border-box;">
        </label>

        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#888;margin-bottom:8px;">Render Type Properties</div>
          <div id="arch-render-type-props-list">
            ${this.renderRenderTypeSection(arch)}
          </div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#888;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;">
            <span>Properties</span>
            ${!isSys ? `<button id="arch-add-prop" style="background:#1f6feb;color:#fff;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px;">+ Add</button>` : ''}
          </div>
          <div id="arch-props-list">
            ${propsHtml || '<div style="color:#555;font-size:11px;padding:8px 0;">No properties defined</div>'}
          </div>
        </div>

        <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:16px;">
          <span style="font-size:11px;color:#888;">Default Verbs (comma-separated)</span>
          <input id="arch-verbs" type="text" value="${esc(arch.defaultVerbs.join(', '))}" ${isSys ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;width:100%;box-sizing:border-box;">
        </label>

        ${!isSys ? `
          <button id="arch-save-btn" style="background:#238636;color:#fff;border:none;padding:8px 20px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">
            Save Archetype
          </button>
          <span id="arch-save-status" style="margin-left:10px;font-size:11px;color:#888;"></span>
        ` : ''}
      </div>
    `;
  }

  private renderCustomPropertyRow(prop: ArchetypePropertyDef, index: number, isSys: boolean): string {
    const isNestedObject = prop.type === 'object' && prop.objectKind === 'nested_archetype';
    return `
      <div class="arch-prop-row" data-prop-index="${index}" style="display:flex;gap:6px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #21262d;">
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;">
          <input class="arch-prop-name" type="text" value="${esc(prop.name)}" placeholder="name" ${isSys ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;">
          <select class="arch-prop-type" ${isSys || isNestedObject ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;">
            ${PROP_TYPES.map(t => `<option value="${t}" ${t === prop.type ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          ${this.renderDefaultValueField(prop, prop.default, isSys)}
        </div>
        ${!isSys ? `<button class="arch-prop-remove" data-index="${index}" style="background:transparent;border:1px solid #f85149;color:#f85149;padding:2px 7px;border-radius:3px;cursor:pointer;font-size:11px;flex-shrink:0;">✕</button>` : ''}
      </div>
    `;
  }

  // ── Event Binding ─────────────────────────────────────────────────

  private bindEvents(): void {
    // Search
    const searchEl = this.el.querySelector('#arch-search') as HTMLInputElement | null;
    searchEl?.addEventListener('input', () => {
      this.searchQuery = searchEl.value;
      this.render();
    });

    // List item click
    this.el.querySelectorAll('[data-archetype-id]').forEach(li => {
      li.addEventListener('click', () => {
        const id = (li as HTMLElement).dataset.archetypeId!;
        this.selectedId = id;
        this.render();
      });
    });

    // New archetype
    this.el.querySelector('#arch-new-btn')?.addEventListener('click', () => {
      this.createNewArchetype();
    });

    if (!this.selectedId) return;

    // Visual Editor
    this.el.querySelector('#arch-visual-editor-btn')?.addEventListener('click', () => {
      if (!this.selectedId || !this.schema.archetypes[this.selectedId]) return;
      this.collectCurrentForm();
      this.visualEditor.show(this.schema, this.selectedId);
    });

    // Delete
    this.el.querySelector('#arch-delete-btn')?.addEventListener('click', () => {
      if (!this.selectedId) return;
      if (!confirm(`Delete archetype "${this.selectedId}"? Instances will become orphaned.`)) return;
      delete this.schema.archetypes[this.selectedId];
      this.selectedId = null;
      this.render();
    });

    // Add property
    this.el.querySelector('#arch-add-prop')?.addEventListener('click', () => {
      this.openPropertyPicker();
    });

    this.bindPropertyPickerEvents();

    // Remove property
    this.el.querySelectorAll('.arch-prop-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.selectedId) return;
        const idx = parseInt((btn as HTMLElement).dataset.index ?? '0');
        this.schema.archetypes[this.selectedId].properties.splice(idx, 1);
        this.render();
      });
    });

    // Save
    this.el.querySelector('#arch-save-btn')?.addEventListener('click', async () => {
      await this.saveCurrentArchetype();
    });

    // Render type change should immediately update render type properties
    this.el.querySelector('#arch-render-type')?.addEventListener('change', (event) => {
      if (!this.selectedId) return;
      const arch = this.schema.archetypes[this.selectedId];
      const prevRenderType = arch.renderType;
      this.collectCurrentForm();
      const select = event.target as HTMLSelectElement;
      arch.renderType = select.value;
      this.removeOldRenderTypeProperties(arch, prevRenderType);
      this.syncRenderTypeProperties(arch);
      this.render();
    });
  }

  private collectCurrentForm(): void {
    if (!this.selectedId || this.selectedId.startsWith('_sys:')) return;
    const arch = this.schema.archetypes[this.selectedId];

    const category = (this.el.querySelector('#arch-category') as HTMLInputElement | null)?.value ?? arch.category;
    const renderType = (this.el.querySelector('#arch-render-type') as HTMLSelectElement | null)?.value ?? arch.renderType;
    const description = (this.el.querySelector('#arch-description') as HTMLInputElement | null)?.value ?? arch.description;
    const verbsStr = (this.el.querySelector('#arch-verbs') as HTMLInputElement | null)?.value ?? '';

    arch.category = category;
    arch.renderType = renderType;
    arch.description = description;
    arch.defaultVerbs = verbsStr.split(',').map(s => s.trim()).filter(Boolean);

    // Update properties from rows
    this.el.querySelectorAll('.arch-prop-row').forEach((row) => {
      const index = Number((row as HTMLElement).dataset.propIndex);
      const nameEl = row.querySelector('.arch-prop-name') as HTMLInputElement | null;
      const typeEl = row.querySelector('.arch-prop-type') as HTMLSelectElement | null;
      const defEl = row.querySelector('.arch-prop-default') as HTMLInputElement | HTMLSelectElement | null;
      if (Number.isFinite(index) && arch.properties[index]) {
        const prop = arch.properties[index];
        if (nameEl) prop.name = nameEl.value;
        if (typeEl) prop.type = typeEl.value as ArchetypePropertyType;

        if (defEl) {
          // Nested archetype: preserve existing NestedArchetypeValue (including
          // its transform and overrides) unless the selected archetype id changed.
          if (prop.type === 'object' && prop.objectKind === 'nested_archetype' && (defEl as HTMLElement).dataset.objectKind === 'nested_archetype') {
            const newArchId = defEl.value;
            if (!isNestedArchetypeValue(prop.default) || prop.default.archetypeId !== newArchId) {
              prop.default = createDefaultNestedArchetypeValue(newArchId);
            }

            // Collect inline child property edits (rendered by renderDefaultValueField)
            const nestedValue = prop.default as NestedArchetypeValue;
            const childInputs = row.querySelectorAll('.arch-child-prop');
            if (childInputs && childInputs.length > 0) {
              const overrides: Record<string, unknown> = { ...(nestedValue.overrides ?? {}) };
              childInputs.forEach((inp) => {
                const el = inp as HTMLInputElement;
                const childName = el.dataset.childName as string | undefined;
                const childType = el.dataset.childType as string | undefined;
                if (!childName || !childType) return;
                let v: unknown = undefined;
                if (childType === 'boolean') v = (el as HTMLInputElement).checked;
                else if (childType === 'number') v = Number((el as HTMLInputElement).value);                  else if (childType === 'vec3' || childType === 'object') {
                    try { v = JSON.parse((el as HTMLInputElement).value); } catch { v = (el as HTMLInputElement).value; }
                  }                else v = (el as HTMLInputElement).value;
                overrides[childName] = v;
              });
              nestedValue.overrides = overrides;
            }
          } else {
            prop.default = this.parseDefaultValue(prop.type, defEl);
          }
        }
      }
    });
  }

  private async saveCurrentArchetype(): Promise<void> {
    this.collectCurrentForm();

    const statusEl = this.el.querySelector('#arch-save-status') as HTMLElement | null;
    if (statusEl) statusEl.textContent = 'Saving...';

    try {
      const res = await fetch('/api/save-archetypes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.schema),
      });

      if (res.ok) {
        if (statusEl) statusEl.textContent = '✓ Saved';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        await this.onSave(this.schema);
      } else {
        if (statusEl) statusEl.textContent = '✗ Save failed';
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗ Network error';
      console.error('Failed to save archetypes:', e);
    }
  }

  private renderRenderTypeSection(arch: ArchetypeDef): string {
    const renderTypeKey = this.getSystemArchetypeKey(arch.renderType);
    const sysArch = renderTypeKey ? this.schema.archetypes[renderTypeKey] : null;
    if (!sysArch) {
      return '<div style="color:#555;font-size:11px;padding:8px 0;">No render type properties available.</div>';
    }

    const rows = sysArch.properties.map((prop) => {
      const index = arch.properties.findIndex((p) => p.name === prop.name);
      const effective = index >= 0 ? arch.properties[index] : prop;
      const defaultValue = effective.default ?? prop.default;
      return `
        <div class="arch-prop-row" data-prop-index="${index >= 0 ? index : -1}" style="display:grid;grid-template-columns:minmax(220px, 1fr) 160px minmax(180px, 220px);gap:8px;align-items:center;padding:6px 0 6px 12px;border-bottom:1px solid #21262d;">
              <input class="arch-prop-name" type="text" value="${esc(prop.name)}" disabled
                style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;">
            <select class="arch-prop-type" disabled
              style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;">
              ${PROP_TYPES.map(t => `<option value="${t}" ${t === prop.type ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            ${this.renderDefaultValueField(prop, defaultValue)}
        </div>
      `;
    }).join('');

    return rows || '<div style="color:#555;font-size:11px;padding:8px 0;">No render type properties available.</div>';
  }

  private renderDefaultValueField(prop: ArchetypePropertyDef, value: unknown, disabled: boolean = false): string {
    if (prop.type === 'object' && prop.objectKind === 'nested_archetype') {
      const nestedValue = isNestedArchetypeValue(value) ? value : createDefaultNestedArchetypeValue();
      const current = nestedValue.archetypeId;
      // Render selector + inline child object subsection so nested archetype's
      // properties can be edited inline as descendants of the parent.
      const selector = `<select class="arch-prop-default" data-object-kind="nested_archetype" ${disabled ? 'disabled' : ''}
          style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;min-width:140px;">
          <option value="">Select archetype...</option>
          ${this.getAvailableNestedArchetypeIds().map(id => `<option value="${esc(id)}" ${id === current ? 'selected' : ''}>${esc(id)}</option>`).join('')}
        </select>`;

      // If there's a selected nested archetype, render its properties as a
      // child subsection so users can edit them here. Use the nestedValue.overrides
      // when present to show instance-specific overrides, falling back to the
      // nested archetype's defaults.
      let childSection = '';
      if (current && this.schema && this.schema.archetypes[current]) {
        const nestedArch = this.schema.archetypes[current];
        const overrides = (nestedValue.overrides ?? {}) as Record<string, unknown>;
        const rows = nestedArch.properties.map((p) => {
          // Skip nested nested_archetype editing inline to avoid deep recursion
          if (p.type === 'object' && p.objectKind === 'nested_archetype') return '';
          const childVal = overrides[p.name] ?? p.default ?? '';
          const inputId = `child-${esc(prop.name)}-${esc(p.name)}`;
          // Render simple input types similar to top-level UI
          if (p.type === 'boolean') {
            return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
              <label style="width:110px;color:#c9d1d9;font-size:12px;">${esc(p.name)}</label>
              <input class="arch-child-prop" data-child-name="${esc(p.name)}" data-child-type="boolean" type="checkbox" ${childVal ? 'checked' : ''} />
            </div>`;
          }
          if (p.type === 'number') {
            return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
              <label style="width:110px;color:#c9d1d9;font-size:12px;">${esc(p.name)}</label>
              <input class="arch-child-prop" data-child-name="${esc(p.name)}" data-child-type="number" type="number" step="0.01" value="${esc(String(childVal))}" style="width:140px;" />
            </div>`;
          }
                // default to text/enum/asset fields as simple text input. For vec3/schema, format as JSON.
                const isObject = p.type === 'vec3' || p.type === 'object';
                const displayVal = isObject ? JSON.stringify(childVal) : String(childVal);
                return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                  <label style="width:110px;color:#c9d1d9;font-size:12px;">${esc(p.name)}</label>
                  <input class="arch-child-prop" data-child-name="${esc(p.name)}" data-child-type="${esc(p.type)}" type="text" value="${esc(displayVal)}" style="width:140px;" />
                </div>`;
        }).join('');

        childSection = `<div style="margin-top:8px;padding:8px;border-left:2px solid #222;margin-left:6px;">
            <div style="font-size:12px;color:#9fb4ff;margin-bottom:6px;font-weight:600;">Child Object: ${esc(current)}</div>
            ${rows}
          </div>`;
      }

      return selector + childSection;
    }

    switch (prop.type) {
      case 'boolean':
        return `<input class="arch-prop-default" type="checkbox" ${value ? 'checked' : ''} ${disabled ? 'disabled' : ''}
            style="transform:scale(1.1);margin-left:4px;" />`;
      case 'number':
        return `<input class="arch-prop-default" type="number" value="${esc(String(value ?? '0'))}" ${disabled ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;width:100px;">`;
      case 'enum':
        return `<select class="arch-prop-default" ${disabled ? 'disabled' : ''} style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;">
            ${(prop.options ?? []).map(opt => `<option value="${esc(opt)}" ${opt === String(value) ? 'selected' : ''}>${esc(opt)}</option>`).join('')}
          </select>`;
      case 'color_hex':
        return `<input class="arch-prop-default" type="color" value="${esc(String(value ?? '#ffffff'))}" ${disabled ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;padding:3px;outline:none;width:44px;height:32px;">`;
      default:
        return `<input class="arch-prop-default" type="text" value="${esc(String(value ?? ''))}" ${disabled ? 'disabled' : ''}
            style="background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:4px 6px;border-radius:3px;font-size:11px;outline:none;">`;
    }
  }

  private syncRenderTypeProperties(arch: ArchetypeDef): void {
    const renderTypeKey = this.getSystemArchetypeKey(arch.renderType);
    if (!renderTypeKey) return;
    const sysArch = this.schema.archetypes[renderTypeKey];
    if (!sysArch) return;

    // Ensure any missing system properties for the new render type are present
    const existingNames = new Set(arch.properties.map((p) => p.name));
    for (const prop of sysArch.properties) {
      if (!existingNames.has(prop.name)) {
        arch.properties.push({ ...prop });
      }
    }
  }

  private removeOldRenderTypeProperties(arch: ArchetypeDef, oldRenderType: string | null): void {
    if (!oldRenderType) return;
    const oldKey = this.getSystemArchetypeKey(oldRenderType);
    if (!oldKey) return;
    const oldSys = this.schema.archetypes[oldKey];
    if (!oldSys) return;

    const oldNames = new Set(oldSys.properties.map(p => p.name));
    const newKey = this.getSystemArchetypeKey(arch.renderType);
    const newSys = newKey ? this.schema.archetypes[newKey] : null;
    const newNames = newSys ? new Set(newSys.properties.map(p => p.name)) : new Set<string>();

    // Remove any property that belonged to the old render type and is not present in the new render type.
    arch.properties = arch.properties.filter(p => !(oldNames.has(p.name) && !newNames.has(p.name)));
  }

  private isRenderTypePropName(renderType: string, propName: string): boolean {
    const renderTypeKey = this.getSystemArchetypeKey(renderType);
    if (!renderTypeKey) return false;
    const sysArch = this.schema.archetypes[renderTypeKey];
    if (!sysArch) return false;
    return sysArch.properties.some(p => p.name === propName);
  }

  private getSystemArchetypeKey(renderType: string): string | null {
    if (!renderType) return null;
    return `_sys:${renderType.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`;
  }

  private parseDefaultValue(type: ArchetypePropertyType, input: HTMLInputElement | HTMLSelectElement): unknown {
    if ((input as HTMLElement).dataset.objectKind === 'nested_archetype') {
      const currentValue = createDefaultNestedArchetypeValue(input.value);
      return currentValue;
    }

    switch (type) {
      case 'boolean':
        return (input as HTMLInputElement).checked;
      case 'number':
        return Number(input.value);
      default:
        return input.value;
    }
  }

  private createNewArchetype(): void {
    const name = prompt('Archetype name (e.g., "Lamp", "Barrel", "NPC"):');
    if (!name || !name.trim()) return;
    const id = name.trim();
    if (this.schema.archetypes[id]) {
      alert(`Archetype "${id}" already exists.`);
      return;
    }
    this.schema.archetypes[id] = {
      category: 'Custom',
      description: '',
      renderType: 'primitive',
      defaultTransform: createDefaultTransform(),
      sockets: { inputs: [], outputs: [] },
      properties: [],
      defaultVerbs: [],
    };
    this.selectedId = id;
    this.render();
  }

  private renderPropertyPicker(): string {
    if (!this.propertyPickerOpen) return '';

    const archetypeOptions = this.getAvailableNestedArchetypeIds();
    const nestedDisabled = archetypeOptions.length === 0;
    const propertyCardStyle = (template: 'property' | 'nested_object') => `
      cursor:pointer;padding:10px 12px;border:1px solid ${this.pendingPropertyTemplate === template ? '#58a6ff' : '#30363d'};
      border-radius:6px;background:${this.pendingPropertyTemplate === template ? '#161b22' : '#0d1117'};color:#c9d1d9;
      display:flex;flex-direction:column;gap:4px;min-width:180px;`;

    return `
      <div id="arch-prop-picker-overlay" style="position:absolute;inset:0;background:rgba(1,4,9,0.72);display:flex;align-items:center;justify-content:center;z-index:20;">
        <div style="width:min(560px, calc(100vw - 48px));background:#0d1117;border:1px solid #30363d;border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,0.45);padding:18px;display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-size:15px;font-weight:600;color:#58a6ff;">Add Archetype Property</div>
              <div style="font-size:11px;color:#8b949e;">Choose a property template. Nested Object creates a child archetype under this archetype.</div>
            </div>
            <button id="arch-prop-picker-close" type="button" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:4px 9px;border-radius:4px;cursor:pointer;">✕</button>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button id="arch-prop-template-property" type="button" style="${propertyCardStyle('property')}">
              <span style="font-size:12px;font-weight:600;">Property</span>
              <span style="font-size:11px;color:#8b949e;">Standard schema property with name, type, and default.</span>
            </button>
            <button id="arch-prop-template-nested" type="button" style="${propertyCardStyle('nested_object')}" ${nestedDisabled ? 'disabled' : ''}>
              <span style="font-size:12px;font-weight:600;">Nested Object</span>
              <span style="font-size:11px;color:#8b949e;">Reference another archetype and spawn it as a child object.</span>
            </button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <label style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-size:11px;color:#8b949e;">Property Name</span>
              <input id="arch-prop-picker-name" type="text" value="${esc(this.pendingPropertyName)}"
                style="background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
            </label>
            ${this.pendingPropertyTemplate === 'property'
              ? `<label style="display:flex;flex-direction:column;gap:4px;">
                  <span style="font-size:11px;color:#8b949e;">Type</span>
                  <select id="arch-prop-picker-type" style="background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
                    ${PROP_TYPES.filter(type => type !== 'object').map(type => `<option value="${type}" ${type === this.pendingPropertyType ? 'selected' : ''}>${type}</option>`).join('')}
                  </select>
                </label>`
              : `<label style="display:flex;flex-direction:column;gap:4px;">
                  <span style="font-size:11px;color:#8b949e;">Nested Archetype</span>
                  <select id="arch-prop-picker-nested-id" ${nestedDisabled ? 'disabled' : ''}
                    style="background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
                    <option value="">Select archetype...</option>
                    ${archetypeOptions.map(id => `<option value="${esc(id)}" ${id === this.pendingNestedArchetypeId ? 'selected' : ''}>${esc(id)}</option>`).join('')}
                  </select>
                </label>`}
          </div>

          ${this.pendingPropertyTemplate === 'property'
            ? `<label style="display:flex;flex-direction:column;gap:4px;">
                <span style="font-size:11px;color:#8b949e;">Default Value</span>
                <input id="arch-prop-picker-default" type="text" value="${esc(this.pendingPropertyDefault)}"
                  style="background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:6px 8px;border-radius:4px;font-size:12px;outline:none;">
              </label>`
            : `<div style="font-size:11px;color:${nestedDisabled ? '#f85149' : '#8b949e'};">
                ${nestedDisabled ? 'Create another user archetype first. System archetypes cannot be nested here.' : 'The nested archetype spawns with identity local transform for now.'}
              </div>`}

          <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="arch-prop-picker-cancel" type="button" style="background:transparent;border:1px solid #30363d;color:#8b949e;padding:6px 12px;border-radius:4px;cursor:pointer;">Cancel</button>
            <button id="arch-prop-picker-create" type="button" style="background:#238636;border:none;color:#fff;padding:6px 12px;border-radius:4px;cursor:pointer;">Add Property</button>
          </div>
        </div>
      </div>
    `;
  }

  private bindPropertyPickerEvents(): void {
    this.el.querySelector('#arch-prop-template-property')?.addEventListener('click', () => {
      this.pendingPropertyTemplate = 'property';
      this.render();
    });
    this.el.querySelector('#arch-prop-template-nested')?.addEventListener('click', () => {
      this.pendingPropertyTemplate = 'nested_object';
      if (!this.pendingNestedArchetypeId) {
        this.pendingNestedArchetypeId = this.getAvailableNestedArchetypeIds()[0] ?? '';
      }
      this.render();
    });
    this.el.querySelector('#arch-prop-picker-close')?.addEventListener('click', () => this.closePropertyPicker());
    this.el.querySelector('#arch-prop-picker-cancel')?.addEventListener('click', () => this.closePropertyPicker());
    this.el.querySelector('#arch-prop-picker-name')?.addEventListener('input', (event) => {
      this.pendingPropertyName = (event.target as HTMLInputElement).value;
    });
    this.el.querySelector('#arch-prop-picker-type')?.addEventListener('change', (event) => {
      this.pendingPropertyType = (event.target as HTMLSelectElement).value as ArchetypePropertyType;
    });
    this.el.querySelector('#arch-prop-picker-default')?.addEventListener('input', (event) => {
      this.pendingPropertyDefault = (event.target as HTMLInputElement).value;
    });
    this.el.querySelector('#arch-prop-picker-nested-id')?.addEventListener('change', (event) => {
      this.pendingNestedArchetypeId = (event.target as HTMLSelectElement).value;
    });
    this.el.querySelector('#arch-prop-picker-create')?.addEventListener('click', () => {
      this.commitPendingProperty();
    });
  }

  private openPropertyPicker(): void {
    if (!this.selectedId) return;
    this.collectCurrentForm();
    this.propertyPickerOpen = true;
    this.pendingPropertyTemplate = 'property';
    this.pendingPropertyName = 'newProp';
    this.pendingPropertyType = 'string';
    this.pendingPropertyDefault = '';
    this.pendingNestedArchetypeId = this.getAvailableNestedArchetypeIds()[0] ?? '';
    this.render();
  }

  private closePropertyPicker(): void {
    this.propertyPickerOpen = false;
    this.render();
  }

  private commitPendingProperty(): void {
    if (!this.selectedId) return;
    const name = this.pendingPropertyName.trim();
    if (!name) {
      alert('Property name is required.');
      return;
    }

    const arch = this.schema.archetypes[this.selectedId];
    if (arch.properties.some((prop) => prop.name === name)) {
      alert(`Property "${name}" already exists on this archetype.`);
      return;
    }

    if (this.pendingPropertyTemplate === 'nested_object') {
      if (!this.pendingNestedArchetypeId) {
        alert('Select a nested archetype first.');
        return;
      }
      arch.properties.push({
        name,
        type: 'object',
        objectKind: 'nested_archetype',
        default: createDefaultNestedArchetypeValue(this.pendingNestedArchetypeId),
      });
    } else {
      arch.properties.push({
        name,
        type: this.pendingPropertyType,
        default: this.parsePendingDefaultValue(),
      });
    }

    this.propertyPickerOpen = false;
    this.render();
  }

  private parsePendingDefaultValue(): unknown {
    switch (this.pendingPropertyType) {
      case 'boolean':
        return this.pendingPropertyDefault === 'true';
      case 'number':
        return Number(this.pendingPropertyDefault || '0');
      default:
        return this.pendingPropertyDefault;
    }
  }

  private getAvailableNestedArchetypeIds(): string[] {
    return Object.keys(this.schema.archetypes)
      .filter((id) => !id.startsWith('_sys:'))
      .filter((id) => id !== this.selectedId);
  }
}
