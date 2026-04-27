/* ═══════════════════════════════════════════════════════════════════════
   RightPanel — Inspector (property editor for selected entity)
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  EditorEntity,
  Vec3,
  SpriteEntity,
  PrimitiveEntity,
  CameraEntity,
  LightEntity,
  SoundEntity,
  TriggerEntity,
  SpawnEntity,
  DoorEntity,
} from '../types/entities';
import type { HeightModifier, PointModifier, LineModifier, RoomData, DoorDef } from '../types/scene';

export type InspectorChangeCallback = (target: any) => void;
export type InspectorDeleteCallback = (id: string) => void;
export type InspectorFlightCallback = (entity: CameraEntity, activate: boolean) => void;
export type ModifierChangeCallback = (modifier: HeightModifier) => void;
export type ModifierDeleteCallback = (id: string) => void;

export class RightPanel {
  private container: HTMLElement;
  private entity: EditorEntity | null = null;
  private room: any | null = null;
  private modifier: HeightModifier | null = null;
  private onChange: InspectorChangeCallback;
  private onDelete: InspectorDeleteCallback;
  private onDeleteRoom: InspectorDeleteCallback;
  private onEnterRoom?: (id: string) => void;
  private onFlightMode?: InspectorFlightCallback;
  private allEntities?: () => EditorEntity[];

  /** Fires when a height modifier property changes (from HeightMap mode) */
  public onModifierChange: ModifierChangeCallback | null = null;
  /** Fires when the delete button is pressed on a height modifier */
  public onModifierDelete: ModifierDeleteCallback | null = null;

  /** Fires when the user clicks an entity in the scene outliner */
  public onEntitySelect: ((entityId: string) => void) | null = null;
  /** Fires when the user hovers an entity in the scene outliner (null = leave) */
  public onEntityHover: ((entityId: string | null) => void) | null = null;
  /** Fires on every input keystroke (live preview, no autosave) */
  public onLiveChange: ((entity: EditorEntity) => void) | null = null;

  /** Fires when a room is clicked in the world-map outliner */
  public onWorldRoomSelect: ((roomId: string) => void) | null = null;
  /** Fires when a door is clicked in the world-map outliner */
  public onWorldDoorSelect: ((doorId: string) => void) | null = null;
  /** Fires when a height modifier is clicked in the height-map outliner */
  public onHeightModifierSelect: ((modifierId: string) => void) | null = null;

  private outlinerEl!: HTMLElement;
  private inspectorEl!: HTMLElement;
  private assetData: { textures: string[]; sprites: string[]; audio: string[] } | null = null;

  constructor(
    container: HTMLElement,
    onChange: InspectorChangeCallback,
    onDelete: InspectorDeleteCallback,
    onDeleteRoom: InspectorDeleteCallback,
    onEnterRoom?: (id: string) => void,
    onFlightMode?: InspectorFlightCallback,
    allEntities?: () => EditorEntity[]
  ) {
    this.container = container;
    this.onChange = onChange;
    this.onDelete = onDelete;
    this.onDeleteRoom = onDeleteRoom;
    this.onEnterRoom = onEnterRoom;
    this.onFlightMode = onFlightMode;
    this.allEntities = allEntities;

    // ── Create permanent layout zones ──────────────────────────────
    this.container.innerHTML =
      '<div class="rp-outliner-zone"></div>' +
      '<div class="rp-inspector-zone"></div>';
    this.outlinerEl  = this.container.querySelector('.rp-outliner-zone')  as HTMLElement;
    this.inspectorEl = this.container.querySelector('.rp-inspector-zone') as HTMLElement;

    this.renderOutliner([]);
    this.renderEmpty();
  }

  /** Show entity properties */
  public inspectEntity(entity: EditorEntity | null) {
    this.entity = entity;
    this.room = null;
    if (!entity) {
      this.renderEmpty();
      return;
    }
    this.renderEntity(entity);
  }

  /** Show room properties */
  public inspectRoom(room: any | null) {
    this.room = room;
    this.entity = null;
    this.modifier = null;
    if (!room) {
      this.renderEmpty();
      return;
    }
    this.renderRoom(room);
  }

  /** Show height modifier properties (HeightMap mode) */
  public inspectModifier(m: HeightModifier | null) {
    this.modifier = m;
    this.entity = null;
    this.room = null;
    if (!m) {
      this.renderEmpty();
      return;
    }
    this.renderModifier(m);
  }

  /** Refresh the displayed values without rebuilding the DOM */
  public refresh() {
    // Skip re-render while the user is actively typing in the inspector
    if (this.inspectorEl?.contains(document.activeElement)) return;
    if (this.entity) {
      this.renderEntity(this.entity);
    } else if (this.room) {
      this.renderRoom(this.room);
    } else if (this.modifier) {
      this.renderModifier(this.modifier);
    }
  }

  // ── Render: Empty State ──────────────────────────────────────────

  private renderEmpty() {
    this.inspectorEl.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Inspector</span>
      </div>
      <div class="inspector-body">
        <div class="inspector-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M5 3l14 8-6 2-4 6z"/>
          </svg>
          <span>No entity selected</span>
          <span style="font-size:10px;color:var(--text-muted)">Click an object or drag one from the browser</span>
        </div>
      </div>
    `;
  }

  // ── Render: Entity Inspector ─────────────────────────────────────

  private renderEntity(entity: EditorEntity) {
    const typeLabel = entity.type.replace('_', ' ');
    const typeColor = this.getTypeColor(entity.type);

    let html = `
      <div class="inspector-header">
        <span class="inspector-title">Inspector</span>
        <span class="selection-badge" style="border-color:${typeColor};color:${typeColor};background:${typeColor}1a">
          ${typeLabel}
        </span>
      </div>
      <div class="inspector-body">
    `;

    // ── Metadata section ──
    html += this.section('Metadata', `
      ${this.propText('ID', entity.id, true)}
      ${this.propInput('name', 'Name', entity.name)}
      ${this.propCheckbox('visible', 'Visible', entity.visible)}
      ${this.propNumber('layer', 'Layer', entity.layer, 0)}
    `);

    // ── Transform section ──
    html += this.section('Transform', `
      ${this.propVec3('position', 'Position', entity.transform.position)}
      ${this.propVec3('rotation', 'Rotation', entity.transform.rotation)}
      ${this.propVec3('scale', 'Scale', entity.transform.scale)}
    `);

    // ── Type-specific section ──
    html += this.renderTypeSpecific(entity);

    // ── Delete button ──
    html += `
        <button class="inspector-delete-btn" id="inspector-delete">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete Entity
        </button>
      </div>
    `;

    this.inspectorEl.innerHTML = html + this.buildDatalistHtml();
    this.bindEvents(entity);
  }

  // ── Type-Specific Properties ─────────────────────────────────────

  private renderRoom(room: any) {
    let html = `
      <div class="inspector-header">
        <span class="inspector-title">Room Inspector</span>
        <span class="selection-badge" style="border-color:#58a6ff;color:#58a6ff;background:#58a6ff1a">
          World Room
        </span>
      </div>
      <div class="inspector-body">
    `;

    html += this.section('Metadata', `
      ${this.propText('ID', room.id, true)}
      ${this.propInput('name', 'Name', room.name)}
      ${this.propColor('ambientColor', 'Ambient Light', room.ambientColor || '#2b5a5b')}
    `);

    html += `
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="inspector-action-btn" id="inspector-enter-room" style="flex:1">
            Enter Room
          </button>
        </div>
        
        <button class="inspector-delete-btn" id="inspector-delete-room">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Delete Room
        </button>
      </div>
    `;

    this.inspectorEl.innerHTML = html;
    this.bindRoomEvents(room);
  }

  private bindRoomEvents(room: any) {
    // Section toggles
    this.container.querySelectorAll('[data-toggle-section]').forEach((header) => {
      header.addEventListener('click', () => {
        const section = header.closest('.inspector-section');
        section?.classList.toggle('collapsed');
      });
    });

    document.getElementById('inspector-delete-room')?.addEventListener('click', () => {
      if (confirm(`Delete room "${room.name}"? All entities inside will be lost.`)) {
        this.onDeleteRoom(room.id);
      }
    });

    document.getElementById('inspector-enter-room')?.addEventListener('click', () => {
      if (this.onEnterRoom) this.onEnterRoom(room.id);
    });

    // Property inputs
    this.container.querySelectorAll('[data-prop]').forEach((input) => {
      const propPath = (input as HTMLElement).dataset.prop!;
      input.addEventListener('change', () => {
        this.applyPropChange(room, propPath, input as HTMLInputElement | HTMLSelectElement);
        this.onChange(room);
      });
    });
  }

  private renderTypeSpecific(entity: EditorEntity): string {
    switch (entity.type) {
      case 'sprite':
        return this.renderSpriteProps(entity);
      case 'animated_sprite':
        return this.renderAnimatedSpriteProps(entity);
      case 'primitive':
        return this.renderPrimitiveProps(entity);
      case 'camera':
        return this.renderCameraProps(entity);
      case 'light':
        return this.renderLightProps(entity);
      case 'sound':
        return this.renderSoundProps(entity);
      case 'trigger':
        return this.renderTriggerProps(entity);
      case 'spawn':
        return this.renderSpawnProps(entity);
      case 'door':
        return this.renderDoorProps(entity);
    }
  }

  private renderSpriteProps(e: SpriteEntity): string {
    return this.section('Sprite', `
      ${this.propAsset('textureSource', 'Texture', e.textureSource, 'sprites')}
      ${this.propInput('normalMap', 'Normal Map', e.normalMap)}
      ${this.propInput('depthMap', 'Depth Map', e.depthMap)}
      ${this.propSelect('blendMode', 'Blend Mode', e.blendMode, ['normal', 'additive', 'multiply'])}
      ${this.propSelect('billboardMode', 'Billboard', e.billboardMode, ['fixed', 'face_camera', 'y_axis'])}
      ${this.propCheckbox('castShadows', 'Cast Shadows', e.castShadows)}
      ${this.propCheckbox('receiveShadows', 'Recv Shadows', e.receiveShadows)}
    `);
  }

  private renderAnimatedSpriteProps(e: EditorEntity): string {
    const a = e as import('../types/entities').AnimatedSpriteEntity;
    return this.section('Animation', `
      ${this.propAsset('textureSource', 'Texture', a.textureSource, 'sprites')}
      ${this.propNumber('framesCount', 'Frames', a.framesCount, 0)}
      ${this.propNumber('columns', 'Columns', a.columns, 0)}
      ${this.propNumber('rows', 'Rows', a.rows, 0)}
      ${this.propNumber('fps', 'FPS', a.fps, 0)}
      ${this.propCheckbox('loop', 'Loop', a.loop)}
      ${this.propCheckbox('autoplay', 'Autoplay', a.autoplay)}
    `);
  }

  private renderPrimitiveProps(e: PrimitiveEntity): string {
    let html = this.section('Primitive', `
      ${this.propSelect('geometryType', 'Geometry', e.geometryType, ['cube', 'sphere', 'plane', 'cylinder', 'cone'])}
      ${this.propSelect('materialType', 'Material', e.materialType, ['invisible', 'color', 'textured', 'sequence'])}
      ${this.propColor('color', 'Color', e.color)}
      ${this.propNumber('opacity', 'Opacity', e.opacity, 2)}
      ${this.propCheckbox('isCollider', 'Is Collider', e.isCollider)}
      ${this.propCheckbox('castShadows', 'Cast Shadows', e.castShadows)}
      ${this.propCheckbox('receiveShadows', 'Recv Shadows', e.receiveShadows)}
    `);

    if (e.materialType === 'textured' || e.materialType === 'sequence') {
      html += this.section('Texture', `
        ${this.propAsset('textureSource', 'Texture Path', e.textureSource || '', 'textures')}
        ${this.propNumber('uvTilingX', 'UV Tile X', e.uvTilingX ?? 1, 2)}
        ${this.propNumber('uvTilingY', 'UV Tile Y', e.uvTilingY ?? 1, 2)}
        ${this.propNumber('uvOffsetX', 'UV Offset X', e.uvOffsetX ?? 0, 2)}
        ${this.propNumber('uvOffsetY', 'UV Offset Y', e.uvOffsetY ?? 0, 2)}
      `);
    }

    if (e.materialType === 'sequence') {
      html += this.section('Sequence', `
        ${this.propAsset('sequenceSource', 'Sheet Image', e.sequenceSource || '', 'sprites')}
        ${this.propInput('sequenceJson', 'Anim JSON', e.sequenceJson || '')}
        ${this.propInput('activeAnimation', 'Active State', e.activeAnimation || '')}
        ${this.propNumber('playbackSpeed', 'Speed', e.playbackSpeed ?? 1, 2)}
        ${this.propCheckbox('sequenceLoop', 'Loop', e.sequenceLoop ?? true)}
        ${this.propCheckbox('sequenceAutoplay', 'Autoplay', e.sequenceAutoplay ?? true)}
      `);
    }

    return html;
  }

  private renderCameraProps(e: CameraEntity): string {
    const hasLookAt = !!e.targetLookAt;
    const rotationDisabled = hasLookAt ? 'style="opacity:0.4;pointer-events:none"' : '';

    // Build entity ID options for LookAt dropdown
    let entityOptions = '<option value="">None (use rotation)</option>';
    if (this.allEntities) {
      for (const ent of this.allEntities()) {
        if (ent.id === e.id) continue;
        const selected = ent.id === e.targetLookAt ? 'selected' : '';
        entityOptions += `<option value="${ent.id}" ${selected}>${ent.name} (${ent.id})</option>`;
      }
    }

    return this.section('Camera', `
      ${this.propNumber('fov', 'FOV', e.fov, 1)}
      ${this.propNumber('orthoSize', 'Ortho Size', e.orthoSize, 1)}
      ${this.propNumber('near', 'Near Clip', e.near, 2)}
      ${this.propNumber('far', 'Far Clip', e.far, 1)}
      ${this.propCheckbox('isDefault', 'Default Cam', e.isDefault)}
      <div class="prop-row">
        <span class="prop-label">LookAt Target</span>
        <select class="prop-select" data-prop="targetLookAt">
          ${entityOptions}
        </select>
      </div>
      ${hasLookAt ? '<div class="prop-row"><span class="prop-label" style="color:#ffaa00;font-size:10px">Rotation locked — controlled by LookAt target</span></div>' : ''}
      <button class="inspector-action-btn" id="inspector-fly-camera" style="margin-top:8px;width:100%">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px">
          <path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>
        </svg>
        Possess / Fly Camera
      </button>
    `);
  }

  private renderLightProps(e: LightEntity): string {
    return this.section('Light', `
      ${this.propSelect('lightType', 'Type', e.lightType, ['point', 'directional', 'spot'])}
      ${this.propColor('color', 'Color', e.color)}
      ${this.propNumber('intensity', 'Intensity', e.intensity, 2)}
      ${this.propNumber('distance', 'Distance', e.distance, 1)}
      ${this.propCheckbox('castShadows', 'Cast Shadows', e.castShadows)}
    `);
  }

  private renderSoundProps(e: SoundEntity): string {
    return this.section('Sound', `
      ${this.propAsset('audioSource', 'Audio File', e.audioSource, 'audio')}
      ${this.propNumber('volume', 'Volume', e.volume, 2)}
      ${this.propCheckbox('loop', 'Loop', e.loop)}
      ${this.propCheckbox('spatialAudio', 'Spatial', e.spatialAudio)}
      ${this.propNumber('refDistance', 'Ref Dist', e.refDistance, 1)}
      ${this.propNumber('maxDistance', 'Max Dist', e.maxDistance, 1)}
    `);
  }

  private renderTriggerProps(e: TriggerEntity): string {
    return this.section('Trigger', `
      ${this.propSelect('shape', 'Shape', e.shape, ['box', 'sphere'])}
      ${this.propVec3('extents', 'Extents', e.extents)}
      ${this.propInput('onEnterEvent', 'OnEnter', e.onEnterEvent)}
      ${this.propInput('onLeaveEvent', 'OnLeave', e.onLeaveEvent)}
      ${this.propCheckbox('triggerOnce', 'Once', e.triggerOnce)}
      ${this.propSelect('conditionType', 'Condition', e.conditionType, ['always', 'item_required', 'flag_set', 'quest_state'])}
      ${this.propInput('conditionValue', 'Cond. Value', e.conditionValue)}
      ${this.propInput('targetEntityIds', 'Targets', (e.targetEntityIds || []).join(', '))}
      ${this.propInput('payload', 'Payload', e.payload)}
    `);
  }

  private renderSpawnProps(e: SpawnEntity): string {
    return this.section('Spawn Point', `
      ${this.propInput('spawnId', 'Spawn ID', e.spawnId)}
      ${this.propVec3('initialFacing', 'Facing', e.initialFacing)}
    `) + this.section('Character', `
      ${this.propNumber('characterSpeed', 'Move Speed', e.characterSpeed ?? 3.0, 1)}
      ${this.propAsset('characterAsset', 'Asset Source', e.characterAsset || '', 'sprites')}
      ${this.propAsset('characterSequenceSource', 'Sequence Image', e.characterSequenceSource || '', 'sprites')}
      ${this.propInput('characterSequenceJson', 'Sequence JSON', e.characterSequenceJson || '')}
      ${this.propNumber('characterSequenceFps', 'Sequence FPS', e.characterSequenceFps ?? 12, 1)}
      ${this.propCheckbox('characterSequenceLoop', 'Loop', e.characterSequenceLoop ?? true)}
      ${this.propCheckbox('characterSequenceAutoplay', 'Autoplay', e.characterSequenceAutoplay ?? true)}
      ${this.propCheckbox('characterCastShadow', 'Cast Shadow', e.characterCastShadow ?? false)}
      ${this.propCheckbox('characterReceiveShadow', 'Recv Shadow', e.characterReceiveShadow ?? false)}
      ${this.propInput('actionMapping.idle', 'Idle Anim', e.actionMapping?.idle || 'idle')}
      ${this.propInput('actionMapping.walk', 'Walk Anim', e.actionMapping?.walk || 'walk')}
      ${this.propInput('actionMapping.interact', 'Interact Anim', e.actionMapping?.interact || 'interact')}
      ${this.propInput('actionMapping.run', 'Run Anim', e.actionMapping?.run || 'run')}
    `);
  }

  private renderDoorProps(e: DoorEntity): string {    let html = this.section('Door', `
      ${this.propInput('targetRoomId', 'Target Room ID', e.targetRoomId || '')}
      ${this.propInput('targetSpawnId', 'Target Spawn ID', e.targetSpawnId || '')}
      ${this.propSelect('interactionState', 'State', e.interactionState || 'open', ['open', 'closed', 'locked'])}
    `);

    html += this.section('Material', `
      ${this.propSelect('materialType', 'Material', e.materialType || 'color', ['color', 'textured', 'sequence'])}
      ${this.propColor('color', 'Color', e.color || '#6B4423')}
      ${this.propNumber('opacity', 'Opacity', e.opacity ?? 1, 2)}
      ${this.propCheckbox('castShadow', 'Cast Shadow', e.castShadow ?? false)}
      ${this.propCheckbox('receiveShadow', 'Recv Shadow', e.receiveShadow ?? true)}
    `);

    if (e.materialType === 'textured' || e.materialType === 'sequence') {
      html += this.section('Texture', `
        ${this.propAsset('textureSource', 'Texture Path', e.textureSource || '', 'textures')}
        ${this.propNumber('uvTilingX', 'UV Tile X', e.uvTilingX ?? 1, 2)}
        ${this.propNumber('uvTilingY', 'UV Tile Y', e.uvTilingY ?? 1, 2)}
        ${this.propNumber('uvOffsetX', 'UV Offset X', e.uvOffsetX ?? 0, 2)}
        ${this.propNumber('uvOffsetY', 'UV Offset Y', e.uvOffsetY ?? 0, 2)}
      `);
    }

    if (e.materialType === 'sequence') {
      html += this.section('Sequence', `
        ${this.propAsset('sequenceSource', 'Sheet Image', e.sequenceSource || '', 'sprites')}
        ${this.propInput('sequenceJson', 'Anim JSON', e.sequenceJson || '')}
        ${this.propInput('activeAnimation', 'Active State', e.activeAnimation || '')}
        ${this.propNumber('playbackSpeed', 'Speed', e.playbackSpeed ?? 1, 2)}
        ${this.propCheckbox('sequenceLoop', 'Loop', e.sequenceLoop ?? true)}
        ${this.propCheckbox('sequenceAutoplay', 'Autoplay', e.sequenceAutoplay ?? true)}
      `);
    }

    return html;
  }

  // ── Render: Height Modifier Inspector ────────────────────────────

  private renderModifier(m: HeightModifier) {
    const isPoint = m.type === 'point';
    const typeLabel = isPoint ? 'Elevation Node' : 'Ridge / Trench';
    const typeColor = isPoint ? '#ff8844' : '#44aaff';

    const sharedFields = `
      ${this.propNumberMod('elevationOffset', 'Elevation', m.elevationOffset, 2)}
      ${this.propNumberMod('sharpness', 'Sharpness', m.sharpness, 2)}
    `;

    const typeFields = isPoint
      ? this.propNumberMod('radius', 'Radius', (m as PointModifier).radius, 2)
      : this.propNumberMod('width', 'Width', (m as LineModifier).width, 2);

    this.inspectorEl.innerHTML = `
      <div class="inspector-header">
        <span class="inspector-title">Inspector</span>
      </div>
      <div class="inspector-body">
        <div class="inspector-entity-header" style="border-left:3px solid ${typeColor}">
          <span class="inspector-entity-type" style="color:${typeColor}">${typeLabel.toUpperCase()}</span>
          <span class="inspector-entity-name">${m.id}</span>
        </div>

        <div class="inspector-section">
          <div class="inspector-section-header">
            <span class="inspector-section-title">Terrain Modifier</span>
          </div>
          <div class="inspector-section-content">
            <div class="prop-row">
              <span class="prop-label" style="color:var(--text-dim);font-size:10px">
                ${isPoint
                  ? 'Elevation: positive=hill, negative=pit'
                  : 'Elevation: positive=ridge, negative=trench'}
              </span>
            </div>
            ${sharedFields}
            ${typeFields}
          </div>
        </div>

        <div style="padding:8px 12px;display:flex;gap:6px">
          <button id="modifier-delete" class="inspector-delete-btn" style="flex:1;background:#5a1a1a;color:#ff6666;border:1px solid #ff666644;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px">
            Delete Modifier
          </button>
        </div>
        <div style="padding:2px 12px 8px;font-size:10px;color:var(--text-muted)">
          ${isPoint
            ? 'Tip: Adjust Radius to widen the hill/pit. Sharpness controls the slope steepness.'
            : 'Tip: Double-click to finish drawing. Sharpness controls the edge cliff steepness.'}
        </div>
      </div>
    `;

    this.bindModifierEvents(m);
  }

  private bindModifierEvents(m: HeightModifier) {
    document.getElementById('modifier-delete')?.addEventListener('click', () => {
      this.onModifierDelete?.(m.id);
    });

    // Bind all number inputs
    this.container.querySelectorAll('[data-modifier-prop]').forEach((input) => {
      const key = (input as HTMLElement).dataset.modifierProp!;
      const handler = () => {
        const val = parseFloat((input as HTMLInputElement).value) || 0;
        (m as any)[key] = val;
        this.onModifierChange?.(m);
      };
      input.addEventListener('change', handler);
      input.addEventListener('input', handler);
    });
  }

  /** Number row specifically for modifier props (uses data-modifier-prop instead of data-prop) */
  private propNumberMod(key: string, label: string, value: number, decimals: number): string {
    const val = value ?? 0;
    const step = decimals > 0 ? Math.pow(10, -decimals) : 1;
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <input class="prop-input" data-modifier-prop="${key}" type="number"
               step="${step}" value="${val.toFixed(decimals)}" />
      </div>`;
  }

  // ── HTML Helpers ─────────────────────────────────────────────────

  private section(title: string, content: string): string {
    return `
      <div class="inspector-section" data-section="${title}">
        <div class="inspector-section-header" data-toggle-section>
          <span class="inspector-section-title">${title}</span>
          <svg class="inspector-section-arrow" viewBox="0 0 10 10" fill="currentColor">
            <path d="M3 1l4 4-4 4z"/>
          </svg>
        </div>
        <div class="inspector-section-content">
          ${content}
        </div>
      </div>
    `;
  }

  private propText(label: string, value: string, readonly: boolean = false): string {
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <input class="prop-input" value="${this.esc(value)}" ${readonly ? 'readonly style="opacity:0.5"' : ''} />
      </div>`;
  }

  private propInput(key: string, label: string, value: string): string {
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <input class="prop-input" data-prop="${key}" value="${this.esc(value)}" />
      </div>`;
  }

  private propNumber(key: string, label: string, value: number, decimals: number): string {
    const val = value ?? 0;
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <input class="prop-input" data-prop="${key}" type="number" step="${decimals > 0 ? Math.pow(10, -decimals) : 1}" value="${val.toFixed(decimals)}" />
      </div>`;
  }

  private propCheckbox(key: string, label: string, value: boolean): string {
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <label class="prop-checkbox">
          <input type="checkbox" data-prop="${key}" ${value ? 'checked' : ''} />
          <span>${value ? 'Yes' : 'No'}</span>
        </label>
      </div>`;
  }

  private propSelect(key: string, label: string, value: string, options: string[]): string {
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <select class="prop-select" data-prop="${key}">
          ${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>`;
  }

  private propColor(key: string, label: string, value: string): string {
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <div class="prop-color-wrap">
          <div class="prop-color-swatch">
            <input type="color" data-prop="${key}" value="${value}" />
          </div>
          <input class="prop-input" data-prop="${key}" value="${value}" style="flex:1" />
        </div>
      </div>`;
  }

  private propVec3(key: string, label: string, v: Vec3): string {
    const vec = v || { x: 0, y: 0, z: 0 };
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <div class="vec3-group">
          <div class="vec3-input x-axis">
            <input type="number" step="0.1" data-prop="${key}.x" value="${(vec.x ?? 0).toFixed(2)}" />
          </div>
          <div class="vec3-input y-axis">
            <input type="number" step="0.1" data-prop="${key}.y" value="${(vec.y ?? 0).toFixed(2)}" />
          </div>
          <div class="vec3-input z-axis">
            <input type="number" step="0.1" data-prop="${key}.z" value="${(vec.z ?? 0).toFixed(2)}" />
          </div>
        </div>
      </div>`;
  }

  // ── Event Binding ────────────────────────────────────────────────

  private bindEvents(entity: EditorEntity) {
    // Section toggles
    this.container.querySelectorAll('[data-toggle-section]').forEach((header) => {
      header.addEventListener('click', () => {
        const section = header.closest('.inspector-section');
        section?.classList.toggle('collapsed');
      });
    });

    // Delete button
    document.getElementById('inspector-delete')?.addEventListener('click', () => {
      this.onDelete(entity.id);
    });

    // Fly camera button
    document.getElementById('inspector-fly-camera')?.addEventListener('click', () => {
      if (this.onFlightMode && entity.type === 'camera') {
        this.onFlightMode(entity as CameraEntity, true);
      }
    });

    // Property inputs — split live preview (input) from commit (change)
    this.container.querySelectorAll('[data-prop]').forEach((input) => {
      const propPath = (input as HTMLElement).dataset.prop!;
      // Live update: update entity data + lightweight mesh preview (no autosave)
      input.addEventListener('input', () => {
        this.applyPropChange(entity, propPath, input as HTMLInputElement | HTMLSelectElement);
        this.onLiveChange?.(entity);
      });
      // Commit: full update with autosave
      input.addEventListener('change', () => {
        this.applyPropChange(entity, propPath, input as HTMLInputElement | HTMLSelectElement);
        this.onChange(entity);
      });
    });
  }

  private applyPropChange(
    entity: EditorEntity,
    propPath: string,
    input: HTMLInputElement | HTMLSelectElement
  ) {
    const parts = propPath.split('.');

    // Handle vec3 sub-properties (e.g., "position.x" → entity.transform.position.x)
    if (parts.length === 2) {
      const [vecKey, axis] = parts;

      // Check if it belongs to transform
      if (vecKey === 'position' || vecKey === 'rotation' || vecKey === 'scale') {
        (entity.transform[vecKey as keyof typeof entity.transform] as any)[axis] = parseFloat(input.value) || 0;
        return;
      }

      // Nested object props like actionMapping.idle
      if (vecKey in entity && typeof (entity as any)[vecKey] === 'object') {
        const parentObj = (entity as any)[vecKey];
        if (parentObj && axis in parentObj) {
          parentObj[axis] = input.value;
          return;
        }
        // Also handle vec3 sub-props like extents.x, initialFacing.y
        const numVal = parseFloat(input.value);
        if (!isNaN(numVal) && typeof parentObj[axis] === 'number') {
          parentObj[axis] = numVal;
          return;
        }
        parentObj[axis] = input.value;
        return;
      }
    }

    // Simple property
    const key = parts[0];
    const el = input as HTMLInputElement;

    if (el.type === 'checkbox') {
      (entity as any)[key] = el.checked;
    } else if (el.type === 'number') {
      (entity as any)[key] = parseFloat(el.value) || 0;
    } else if (key === 'targetEntityIds') {
      (entity as any)[key] = el.value.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      (entity as any)[key] = el.value;
    }
  }

  // ── Utilities ────────────────────────────────────────────────────

  private esc(s: string): string {
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  private getTypeColor(type: string): string {
    const colors: Record<string, string> = {
      sprite: '#6688aa',
      animated_sprite: '#4a8a5f',
      primitive: '#58a6ff',
      camera: '#4488cc',
      light: '#ccaa44',
      sound: '#44cc88',
      trigger: '#cc4488',
      spawn: '#6666ff',
      door: '#ff6600',
    };
    return colors[type] || '#888';
  }

  // ── Scene Outliner ────────────────────────────────────────

  /** Update the persistent entity list at the top of the panel */
  public updateEntityList(entities: EditorEntity[], selectedId?: string): void {
    this.renderOutliner(entities, selectedId);
  }

  /** Show rooms and doors in the outliner (world map mode) */
  public updateWorldList(rooms: RoomData[], doors: DoorDef[], selectedRoomId?: string): void {
    const count = rooms.length + doors.length;
    let listHtml = '';

    for (const r of rooms) {
      const sel = r.id === selectedRoomId ? ' selected' : '';
      listHtml += `
        <li class="rp-outliner-item${sel}" data-world-room-id="${r.id}">
          <span class="rp-type-dot" style="background:#0088ff"></span>
          <span class="rp-outliner-name">${this.esc(r.name)}</span>
          <span class="rp-outliner-id">(${r.id.slice(-8)})</span>
        </li>`;
    }
    for (const d of doors) {
      listHtml += `
        <li class="rp-outliner-item" data-world-door-id="${d.id}">
          <span class="rp-type-dot" style="background:#ff4400"></span>
          <span class="rp-outliner-name">Door</span>
          <span class="rp-outliner-id">(${d.id.slice(-8)})</span>
        </li>`;
    }

    this.outlinerEl.innerHTML = `
      <div class="rp-outliner-header">
        <span class="rp-outliner-title">World Objects</span>
        <span class="rp-outliner-count">${count}</span>
      </div>
      ${count > 0 ? `<ul class="rp-outliner-list">${listHtml}</ul>` : ''}`;

    this.outlinerEl.querySelectorAll('[data-world-room-id]').forEach(item => {
      const id = (item as HTMLElement).dataset.worldRoomId!;
      item.addEventListener('click', () => this.onWorldRoomSelect?.(id));
    });
    this.outlinerEl.querySelectorAll('[data-world-door-id]').forEach(item => {
      const id = (item as HTMLElement).dataset.worldDoorId!;
      item.addEventListener('click', () => this.onWorldDoorSelect?.(id));
    });
  }

  /** Show height modifiers in the outliner (height map mode) */
  public updateHeightList(modifiers: HeightModifier[], selectedId?: string): void {
    const count = modifiers.length;
    let listHtml = '';

    for (const m of modifiers) {
      const sel = m.id === selectedId ? ' selected' : '';
      const color = m.type === 'line' ? '#44aaff' : '#ff8844';
      const label = m.type === 'line' ? 'Ridge Line' : 'Height Point';
      listHtml += `
        <li class="rp-outliner-item${sel}" data-height-modifier-id="${m.id}">
          <span class="rp-type-dot" style="background:${color}"></span>
          <span class="rp-outliner-name">${label}</span>
          <span class="rp-outliner-id">(${m.id.slice(-8)})</span>
        </li>`;
    }

    this.outlinerEl.innerHTML = `
      <div class="rp-outliner-header">
        <span class="rp-outliner-title">Height Modifiers</span>
        <span class="rp-outliner-count">${count}</span>
      </div>
      ${count > 0 ? `<ul class="rp-outliner-list">${listHtml}</ul>` : ''}`;

    this.outlinerEl.querySelectorAll('[data-height-modifier-id]').forEach(item => {
      const id = (item as HTMLElement).dataset.heightModifierId!;
      item.addEventListener('click', () => this.onHeightModifierSelect?.(id));
    });
  }

  private renderOutliner(entities: EditorEntity[], selectedId?: string): void {
    const count = entities.length;
    let listHtml = '';
    for (const e of entities) {
      const color = this.getTypeColor(e.type);
      const sel   = e.id === selectedId ? ' selected' : '';
      listHtml += `
        <li class="rp-outliner-item${sel}" data-entity-id="${e.id}">
          <span class="rp-type-dot" style="background:${color}"></span>
          <span class="rp-outliner-name">${this.esc(e.name)}</span>
          <span class="rp-outliner-id">(${e.id.slice(-8)})</span>
        </li>`;
    }

    this.outlinerEl.innerHTML = `
      <div class="rp-outliner-header">
        <span class="rp-outliner-title">Scene Objects</span>
        <span class="rp-outliner-count">${count}</span>
      </div>
      ${count > 0 ? `<ul class="rp-outliner-list">${listHtml}</ul>` : ''}`;

    this.outlinerEl.querySelectorAll('.rp-outliner-item').forEach(item => {
      const id = (item as HTMLElement).dataset.entityId!;
      item.addEventListener('click', () => this.onEntitySelect?.(id));
      item.addEventListener('mouseenter', () => this.onEntityHover?.(id));
      item.addEventListener('mouseleave', () => this.onEntityHover?.(null));
    });
  }

  // ── Asset Datalists ──────────────────────────────────────────

  /** Pass the current asset manifest so property fields can offer autocomplete */
  public setAssets(data: { textures: string[]; sprites: string[]; audio: string[] }): void {
    this.assetData = data;
  }

  private propAsset(
    key: string, label: string, value: string,
    assetType: 'textures' | 'sprites' | 'audio'
  ): string {
    return `
      <div class="prop-row">
        <span class="prop-label">${label}</span>
        <input class="prop-input" data-prop="${key}" list="rp-dl-${assetType}"
               value="${this.esc(value)}" autocomplete="off" />
      </div>`;
  }

  private buildDatalistHtml(): string {
    if (!this.assetData) return '';
    const opts = (files: string[], prefix: string, exts: RegExp) =>
      files.filter(f => exts.test(f)).map(f => `<option value="${prefix}${f}">`).join('');
    return [
      `<datalist id="rp-dl-textures">${opts(this.assetData.textures ?? [], 'textures/', /\.(jpg|jpeg|png|webp)$/i)}</datalist>`,
      `<datalist id="rp-dl-sprites">${opts(this.assetData.sprites ?? [], 'sprites/', /\.(png|jpg|jpeg|webp)$/i)}</datalist>`,
      `<datalist id="rp-dl-audio">${opts(this.assetData.audio ?? [], 'audio/', /\.(mp3|ogg|wav|flac)$/i)}</datalist>`,
    ].join('');
  }
}
