/* ═══════════════════════════════════════════════════════════════════════
   EntityFactory — creates Three.js objects from entity definitions
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type {
  EditorEntity,
  PrimitiveEntity,
  TextureEntity,
  CameraEntity,
  LightEntity,
  SoundEntity,
  TriggerEntity,
  SpawnEntity,
  SpriteEntity,
  AnimatedSpriteEntity,
  DoorEntity,
  ArchetypeSchema,
  ArchetypeInstanceEntity,
  ArchetypeChildDef,
} from '../types/entities';
import { getNestedArchetypeInstances, resolveArchetypeInstance } from '../types/entities';

/**
 * Creates a Three.js Object3D representation for an entity.
 * Each returned object has `userData.entityId` set for raycaster picking.
 */
export class EntityFactory {

  private archetypeSchema: ArchetypeSchema | null = null;

  public setArchetypeSchema(schema: ArchetypeSchema): void {
    this.archetypeSchema = schema;
  }

  public create(entity: EditorEntity): THREE.Object3D {
    // Strict fallback: always ensure transform and subfields exist
    if (!entity.transform || typeof entity.transform !== 'object') {
      entity.transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    } else {
      entity.transform.position = entity.transform.position || { x: 0, y: 0, z: 0 };
      entity.transform.rotation = entity.transform.rotation || { x: 0, y: 0, z: 0 };
      entity.transform.scale = entity.transform.scale || { x: 1, y: 1, z: 1 };
    }
    const t = entity.transform;
    // Defensive: ensure all subfields are numbers
    t.position.x = t.position.x ?? 0;
    t.position.y = t.position.y ?? 0;
    t.position.z = t.position.z ?? 0;
    t.rotation.x = t.rotation.x ?? 0;
    t.rotation.y = t.rotation.y ?? 0;
    t.rotation.z = t.rotation.z ?? 0;
    t.scale.x = t.scale.x ?? 1;
    t.scale.y = t.scale.y ?? 1;
    t.scale.z = t.scale.z ?? 1;

    let obj: THREE.Object3D;
    switch (entity.type) {
      case 'sprite':
        obj = this.createSprite(entity);
        break;
      case 'animated_sprite':
        obj = this.createSprite(entity);
        break;
      case 'primitive':
        obj = this.createPrimitive(entity);
        break;
      case 'texture':
        obj = this.createTexture(entity);
        break;
      case 'camera':
        obj = this.createCameraHelper(entity);
        break;
      case 'light':
        obj = this.createLightHelper(entity);
        break;
      case 'sound':
        obj = this.createSoundHelper(entity);
        break;
      case 'trigger':
        obj = this.createTriggerHelper(entity);
        break;
      case 'spawn':
        obj = this.createSpawnHelper(entity);
        break;
      case 'door':
        obj = this.createDoorHelper(entity);
        break;
      case 'archetype_instance':
        obj = this.createArchetypeInstance(entity);
        break;
      default:
        // Fallback: empty object
        obj = new THREE.Object3D();
    }

    obj.position.set(t.position.x, t.position.y, t.position.z);
    obj.rotation.set(
      THREE.MathUtils.degToRad(t.rotation.x),
      THREE.MathUtils.degToRad(t.rotation.y),
      THREE.MathUtils.degToRad(t.rotation.z),
    );
    obj.scale.set(t.scale.x, t.scale.y, t.scale.z);

    // Tag for raycaster
    obj.userData.entityId = entity.id;
    obj.userData.entityType = entity.type;
    obj.name = entity.name;

    return obj;
  }

  // ── Sprite ─────────────────────────────────────────────────────────

  // Static texture cache to avoid redundant network requests
  private textureCache: Map<string, THREE.Texture> = new Map();

  private createSprite(entity: SpriteEntity | AnimatedSpriteEntity): THREE.Object3D {
    const geo = new THREE.PlaneGeometry(2, 2);
    let matArgs: THREE.MeshStandardMaterialParameters = {
      color: 0x6688aa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      roughness: 0.7,
    };

    if (entity.textureSource) {
        let tex = this.textureCache.get(entity.textureSource);
        if (!tex) {
           const loader = new THREE.TextureLoader();
           // if it's from the content browser, it might already include 'sprites/' or 'textures/'
           let path = entity.textureSource;
           if (!path.startsWith('sprites/') && !path.startsWith('textures/') && !path.startsWith('data:') && !path.startsWith('blob:')) {
             const dir = entity.type === 'animated_sprite' ? 'sprites/' : 'textures/';
             path = `${dir}${path}`;
           }
           tex = loader.load(path.startsWith('data:') || path.startsWith('blob:') ? path : `/assets/${path}`);
           this.textureCache.set(entity.textureSource, tex);
        }
        matArgs.map = tex;
        matArgs.color = undefined;
        matArgs.opacity = 1.0;
        matArgs.alphaTest = 0.1;
    }

    const mat = new THREE.MeshStandardMaterial(matArgs);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;

    // Wireframe outline
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.5 })
    );
    wire.userData = wire.userData || {};
    wire.userData.__outlineSelectable = true;
    mesh.add(wire);

    const billboardMode = entity.billboardMode || 'fixed';

    if (billboardMode === 'face_camera' || billboardMode === 'y_axis') {
      // Wrap in a group so the y-offset survives create()'s position assignment.
      // The group origin = entity feet; the mesh rises 1 unit so the bottom of the
      // 2-unit-tall plane sits at the group origin (on the floor).
      const group = new THREE.Group();
      mesh.position.y = 1;
      group.add(mesh);
      group.userData.billboardMode = billboardMode;
      return group;
    }

    // Fixed / env texture — center of plane IS the entity origin; user places freely.
    mesh.userData.billboardMode = billboardMode;
    return mesh;
  }

  // ── Primitives ─────────────────────────────────────────────────────

  private createPrimitive(entity: PrimitiveEntity): THREE.Object3D {
    let geo: THREE.BufferGeometry;

    switch (entity.geometryType) {
      case 'cube':     geo = new THREE.BoxGeometry(1, 1, 1); break;
      case 'sphere':   geo = new THREE.SphereGeometry(0.5, 16, 12); break;
      case 'plane':    geo = new THREE.PlaneGeometry(2, 2); break;
      case 'cylinder': geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
      case 'cone':     geo = new THREE.ConeGeometry(0.5, 1, 16); break;
    }

    const color = new THREE.Color(entity.color);
    const hasSequence = Boolean(entity.sequenceSource);
    const textureKey = hasSequence ? entity.sequenceSource : entity.textureSource;
    const hasTexture = Boolean(textureKey);
    const matParams: THREE.MeshStandardMaterialParameters = {
      color,
      transparent: hasTexture || entity.opacity < 1,
      opacity: entity.opacity,
      roughness: 0.6,
      metalness: 0.1,
      wireframe: entity.materialType === 'invisible',
      alphaTest: hasTexture ? 0.1 : 0,
    };

    // Match engine behavior: if a texture source exists, apply it even when the
    // serialized material type is still at its default value.
    if (textureKey) {
      const texSrc = textureKey;
      let tex = this.textureCache.get(texSrc);
      if (!tex) {
        const loader = new THREE.TextureLoader();
        const path = texSrc.startsWith('textures/') || texSrc.startsWith('sprites/') || texSrc.startsWith('data:') || texSrc.startsWith('blob:')
          ? texSrc
          : (hasSequence ? `sprites/${texSrc}` : `textures/${texSrc}`);
        
        // Ensure we handle the .png if only a .json name was provided for a sequence
        const finalPath = (hasSequence && !path.endsWith('.png') && !path.endsWith('.jpg'))
            ? path.replace('.json', '.png').replace(/\.[^.]+$/, '.png')
            : path;
        
        tex = loader.load(finalPath.startsWith('data:') || finalPath.startsWith('blob:') ? finalPath : `/assets/${finalPath}`);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        this.textureCache.set(texSrc, tex);
      }
      tex.repeat.set(entity.uvTilingX || 1, entity.uvTilingY || 1);
      tex.offset.set(entity.uvOffsetX || 0, entity.uvOffsetY || 0);
      matParams.map = tex;
      matParams.color = new THREE.Color(0xffffff);
    }

    const mat = new THREE.MeshStandardMaterial(matParams);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = entity.opacity > 0.5;
    mesh.receiveShadow = true;

    // Position cube so bottom sits on Y=0
    if (entity.geometryType === 'cube' || entity.geometryType === 'cylinder' || entity.geometryType === 'cone') {
      mesh.position.y = 0.5;
    } else if (entity.geometryType === 'sphere') {
      mesh.position.y = 0.5;
    }

    // Add wireframe edges
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.3 })
    );
    // Mark edges as the visual outline so the editor can make outlines the
    // only clickable target for composite archetype children. Keep them
    // pickable by leaving raycast intact and tagging with __outlineSelectable.
    edges.userData = edges.userData || {};
    edges.userData.__outlineSelectable = true;
    mesh.add(edges);

    return mesh;
  }

  // ── Camera Helper ──────────────────────────────────────────────────

  private createCameraHelper(_entity: CameraEntity): THREE.Object3D {
    const group = new THREE.Group();
    // Mark this group as an archetype root so selection logic can detect
    // composite instances and prefer outline hits instead of selecting
    // the entire object when the user clicks inside child geometry.
    group.userData = group.userData || {};
    group.userData.__isArchetypeRoot = true;

    // Camera body (small box)
    const bodyGeo = new THREE.BoxGeometry(0.6, 0.4, 0.5);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x4488cc,
      roughness: 0.5,
      metalness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.3;
    group.add(body);

    // Lens
    const lensGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.3,
      metalness: 0.6,
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.set(0, 0.3, -0.35);
    group.add(lens);

    // FOV wireframe cone
    const coneGeo = new THREE.ConeGeometry(0.8, 1.5, 4);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x4488cc,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(0, 0.3, -1.1);
    group.add(cone);

    return group;
  }

  // ── Light Helper ───────────────────────────────────────────────────

  private createLightHelper(entity: LightEntity): THREE.Object3D {
    const group = new THREE.Group();
    const color = new THREE.Color(entity.color ?? '#ffffff');
    const intensity = entity.intensity ?? 1;
    const distance = entity.distance ?? 10;
    const tp = entity.targetPosition ?? { x: 0, y: 0, z: 0 };

    // Entity position used to compute target sphere local offset
    const ep = entity.transform?.position ?? { x: 0, y: 0, z: 0 };

    let light: THREE.Light;
    let helper: THREE.Object3D | null = null;

    switch (entity.lightType) {
      case 'directional': {
        const dl = new THREE.DirectionalLight(color, intensity);
        // Target is added as a child; local pos = worldTarget - worldLight
        dl.target.position.set(tp.x - ep.x, tp.y - ep.y, tp.z - ep.z);
        group.add(dl.target);
        light = dl;
        const dh = new THREE.DirectionalLightHelper(dl, 0.6);
        helper = dh;
        break;
      }
      case 'spot': {
        const sl = new THREE.SpotLight(color, intensity, distance);
        sl.angle = THREE.MathUtils.degToRad(entity.angle ?? 45);
        sl.penumbra = entity.penumbra ?? 0;
        sl.decay = entity.decay ?? 2;
        sl.target.position.set(tp.x - ep.x, tp.y - ep.y, tp.z - ep.z);
        group.add(sl.target);
        light = sl;
        const sh = new THREE.SpotLightHelper(sl);
        helper = sh;
        break;
      }
      case 'rect_area': {
        RectAreaLightUniformsLib.init();
        const rl = new THREE.RectAreaLight(color, intensity, entity.rectWidth ?? 1, entity.rectHeight ?? 1);
        light = rl;
        // Visual plane for rect area
        const rectGeo = new THREE.PlaneGeometry(entity.rectWidth ?? 1, entity.rectHeight ?? 1);
        const rectMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
        group.add(new THREE.Mesh(rectGeo, rectMat));
        const edges = new THREE.EdgesGeometry(rectGeo);
        group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color })));
        break;
      }
      default: {
        const pl = new THREE.PointLight(color, intensity, distance);
        pl.decay = entity.decay ?? 2;
        light = pl;
        const ph = new THREE.PointLightHelper(pl, 0.3);
        helper = ph;
        break;
      }
    }

    // Configure shadows on the light instance
    if (entity.castShadows && light.shadow) {
      light.castShadow = true;
      const res = entity.shadowResolution ?? 1024;
      light.shadow.mapSize.set(res, res);
      light.shadow.bias = entity.shadowBias ?? 0;
      light.shadow.normalBias = entity.shadowNormalBias ?? 0.15;
      light.shadow.radius = entity.shadowRadius ?? 1;
    }

    // Cookie texture (spot / directional)
    if (entity.cookieTexture && (entity.lightType === 'spot' || entity.lightType === 'directional')) {
      new THREE.TextureLoader().load(entity.cookieTexture, (tex) => {
        (light as any).map = tex;
      });
    }

    light.position.set(0, 0, 0);
    (light as any).isEditorLight = true;
    group.add(light);
    if (helper) {
      helper.visible = false;
      group.add(helper);
    }

    // Store refs for EditorApp to use (CameraHelper, helper updates, solo mode)
    group.userData.lightInstance = light;
    group.userData.lightHelper = helper;

    // Small icon orb so the entity is always visible / pickable
    const orbGeo = new THREE.SphereGeometry(0.12, 10, 7);
    const orbMat = new THREE.MeshBasicMaterial({ color });
    group.add(new THREE.Mesh(orbGeo, orbMat));

    // ── Target sphere for spot / directional ──────────────────────
    if (entity.lightType === 'spot' || entity.lightType === 'directional') {
      const targetGeo = new THREE.SphereGeometry(0.1, 8, 6);
      const targetMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true });
      const targetSphere = new THREE.Mesh(targetGeo, targetMat);
      // Local position = worldTarget - worldLight (group not yet translated)
      targetSphere.position.set(tp.x - ep.x, tp.y - ep.y, tp.z - ep.z);
      // Make it pickable and recognisable by EditorApp
      targetSphere.userData.entityId = entity.id;       // same id → right inspector
      targetSphere.userData.isLightTarget = true;
      targetSphere.userData.parentEntityId = entity.id;

      const defaultDir = new THREE.Vector3(0, 0, -1);
      const targetDir = targetSphere.position.clone();
      const hasTarget = targetDir.lengthSq() > 1e-6;
      // Arrow should point from the light origin TOWARDS the target. Use the
      // target vector (local) directly so the visual matches the SpotLight's
      // actual target direction in the engine.
      const dir = hasTarget ? targetDir.clone().normalize() : defaultDir.clone();
      const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 0.25, 0xffcc00, 0.08, 0.04);
      arrow.visible = true;
      group.add(arrow);

      group.add(targetSphere);
      group.userData.targetSphere = targetSphere;
      group.userData.targetArrow = arrow;
    }

    return group;
  }

  // ── Sound Helper ───────────────────────────────────────────────────

  private createSoundHelper(_entity: SoundEntity): THREE.Object3D {
    const group = new THREE.Group();

    // Speaker icon (small box + cone)
    const boxGeo = new THREE.BoxGeometry(0.3, 0.3, 0.2);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x44cc88,
      roughness: 0.5,
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.y = 0.3;
    group.add(box);

    // Sound wave rings
    const waveMat = new THREE.LineBasicMaterial({
      color: 0x44cc88,
      transparent: true,
      opacity: 0.3,
    });
    for (let i = 1; i <= 3; i++) {
      const curve = new THREE.EllipseCurve(0, 0, i * 0.25, i * 0.35, -Math.PI / 3, Math.PI / 3, false, 0);
      const pts = curve.getPoints(12);
      const geo = new THREE.BufferGeometry().setFromPoints(
        pts.map(p => new THREE.Vector3(p.x, p.y + 0.3, 0.15 + i * 0.05))
      );
      group.add(new THREE.Line(geo, waveMat));
    }

    return group;
  }

  // ── Trigger Helper ─────────────────────────────────────────────────

  private createTriggerHelper(entity: TriggerEntity): THREE.Object3D {
    const ext = entity.extents;
    const geo = new THREE.BoxGeometry(ext.x, ext.y, ext.z);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcc4488,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = ext.y / 2;

    // Filled semi-transparent faces
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xcc4488,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
    });
    const fillMesh = new THREE.Mesh(geo.clone(), fillMat);
    fillMesh.position.y = ext.y / 2;
    const group = new THREE.Group();
    group.add(fillMesh);
    group.add(mesh);
    return group;
  }

  // ── Spawn Helper ───────────────────────────────────────────────────

  private createSpawnHelper(entity: SpawnEntity): THREE.Object3D {
    const group = new THREE.Group();

    // Base circle
    const ringGeo = new THREE.RingGeometry(0.3, 0.4, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4444cc,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    group.add(ring);

    // Upward arrow
    const arrowGeo = new THREE.ConeGeometry(0.15, 0.5, 8);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0x6666ff,
      roughness: 0.5,
    });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.y = 0.5;
    group.add(arrow);

    const castShadow = entity.characterCastShadow ?? false;
    const receiveShadow = entity.characterReceiveShadow ?? false;
    ring.castShadow = castShadow;
    ring.receiveShadow = receiveShadow;
    arrow.castShadow = castShadow;
    arrow.receiveShadow = receiveShadow;

    // Vertical line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, 0),
      new THREE.Vector3(0, 0.3, 0),
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x6666ff });
    group.add(new THREE.Line(lineGeo, lineMat));

    // Direction arrow (facing)
    const dirGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.35, 0),
      new THREE.Vector3(0, 0.35, -0.8),
    ]);
    const dirArrow = new THREE.Line(dirGeo, new THREE.LineBasicMaterial({ color: 0xaaaaff }));
    group.add(dirArrow);

    return group;
  }

  // ── Door Helper ────────────────────────────────────────────────────

  private createDoorHelper(entity: DoorEntity): THREE.Object3D {
    // Use a Group so entity.transform.position is at the door's BASE (floor),
    // while the box mesh sits offset at local y=0.5 inside the group.
    // When group.scale.y = doorHeight, the mesh spans [0 .. doorHeight] in world Y.
    const group = new THREE.Group();

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const color = new THREE.Color(entity.color || '#6B4423');
    const matParams: THREE.MeshStandardMaterialParameters = {
      color,
      transparent: entity.opacity < 1,
      opacity: entity.opacity,
      roughness: 0.7,
      metalness: 0.1,
    };

    if (entity.textureSource) {
      let tex = this.textureCache.get(entity.textureSource);
      if (!tex) {
        const loader = new THREE.TextureLoader();
        // If it starts with 'textures/' or 'sprites/', don't double up
        const path = entity.textureSource.startsWith('textures/') || entity.textureSource.startsWith('sprites/') 
            ? entity.textureSource 
            : `textures/${entity.textureSource}`;
        tex = loader.load(`/assets/${path}`);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        this.textureCache.set(entity.textureSource, tex);
      }
      tex.repeat.set(entity.uvTilingX || 1, entity.uvTilingY || 1);
      tex.offset.set(entity.uvOffsetX || 0, entity.uvOffsetY || 0);
      matParams.map = tex;
      matParams.color = new THREE.Color(0xffffff);
    }

    const mat = new THREE.MeshStandardMaterial(matParams);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Offset so the bottom of the unit-box is at the group's origin (floor level).
    // With group.scale.y applied, the box spans 0 → scale.y in world Y.
    mesh.position.y = 0.5;

    // Wireframe edges
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.4 })
    );
    edges.userData = edges.userData || {};
    edges.userData.__outlineSelectable = true;
    mesh.add(edges);

    group.add(mesh);

    // State indicator — small sphere at the top-right of the group (normalized coords)
    const stateColor = entity.interactionState === 'locked' ? 0xff4444 :
                        entity.interactionState === 'closed' ? 0xffaa00 : 0x44ff44;
    const indicatorGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const indicatorMat = new THREE.MeshBasicMaterial({ color: stateColor });
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    // Group-local position: right edge (0.6), near top (0.9), front face (0.6).
    // World position = group.scale * this = (0.6*sx, 0.9*sy, 0.6*sz).
    indicator.position.set(0.6, 0.9, 0.6);
    group.add(indicator);

    return group;
  }

  // ── Archetype Instance ─────────────────────────────────────────────

  /**
   * Creates the visual representation for an archetype instance, including all
   * its children. Used by the Visual Editor panel to populate the scene.
   * Returns an empty Group for archetypes that have no children defined.
   */
  public createRootOnly(entity: ArchetypeInstanceEntity): THREE.Object3D {
    if (!this.archetypeSchema) return this.createGenericPlaceholder(entity);
    const arch = this.archetypeSchema.archetypes[entity.archetypeId];
    if (!arch) return this.createGenericPlaceholder(entity);

    // New model: use children[]
    if (arch.children && arch.children.length > 0) {
      const group = new THREE.Group();
      for (const childDef of arch.children) {
        try {
          group.add(this.createFromChildDef(childDef));
        } catch { /* skip bad children */ }
      }
      return group;
    }

    // Legacy renderType model
    if (arch.renderType) {
      const resolved = resolveArchetypeInstance(entity, this.archetypeSchema);
      if (!resolved) return this.createGenericPlaceholder(entity);
      const wrapper = new THREE.Group();
      wrapper.add(this.createResolvedRenderable(resolved as unknown as EditorEntity));
      this.applyChildTransforms(wrapper, entity.overrides);
      return wrapper;
    }

    return this.createGenericPlaceholder(entity);
  }

  private createArchetypeInstance(entity: ArchetypeInstanceEntity): THREE.Object3D {
    return this.createArchetypeInstanceNode(entity, new Set<string>());
  }

  private createArchetypeInstanceNode(entity: ArchetypeInstanceEntity, ancestry: Set<string>): THREE.Object3D {
    if (!this.archetypeSchema) {
      return this.createGenericPlaceholder(entity);
    }
    if (ancestry.has(entity.archetypeId)) {
      return this.createGenericPlaceholder(entity);
    }

    const arch = this.archetypeSchema.archetypes[entity.archetypeId];
    if (!arch) {
      return this.createGenericPlaceholder(entity);
    }

    const group = new THREE.Group();

    // ── New model: children[] ───────────────────────────────────────────
    if (arch.children && arch.children.length > 0) {
      for (const childDef of arch.children) {
        try {
          const childMesh = this.createFromChildDef(childDef);
          group.add(childMesh);
        } catch (err) {
          console.warn(`[EntityFactory] Failed to create archetype child "${childDef.name}":`, err);
        }
      }
      return group;
    }

    // ── Legacy model: renderType + nested archetype properties ──────────
    if (arch.renderType) {
      const resolved = resolveArchetypeInstance(entity, this.archetypeSchema);
      if (!resolved) return this.createGenericPlaceholder(entity);

      const renderableWrapper = new THREE.Group();
      renderableWrapper.add(this.createResolvedRenderable(resolved as unknown as EditorEntity));
      group.add(renderableWrapper);

      const nextAncestry = new Set(ancestry);
      nextAncestry.add(entity.archetypeId);
      for (const child of getNestedArchetypeInstances(entity, this.archetypeSchema)) {
        const childNode = this.createArchetypeInstanceNode(child, nextAncestry);
        this.applyTransform(childNode, child.transform);
        group.add(childNode);
      }
      this.applyChildTransforms(group, entity.overrides);
      return group;
    }

    // Archetype has no children and no renderType — empty pivot placeholder
    return this.createGenericPlaceholder(entity);
  }

  /**
   * Creates a Three.js Object3D from an ArchetypeChildDef.
   * The returned object already has its local transform applied.
   */
  public createFromChildDef(childDef: ArchetypeChildDef): THREE.Object3D {
    const entity = {
      id: childDef.id,
      name: childDef.name,
      type: childDef.entityType,
      transform: childDef.transform,
      visible: childDef.visible,
      layer: 0,
      ...childDef.props,
    } as EditorEntity;

    const obj = this.createResolvedRenderable(entity);
    obj.name = childDef.name;
    obj.userData.childDefId = childDef.id;
    this.applyTransform(obj, childDef.transform);
    return obj;
  }

  private applyChildTransforms(root: THREE.Object3D, overrides: Record<string, unknown> | undefined): void {
    try {
      const childTransforms = overrides?.__childTransforms;
      if (!childTransforms || typeof childTransforms !== 'object') return;

      for (const [path, transform] of Object.entries(childTransforms as Record<string, any>)) {
        if (!path) continue;
        const target = this.findNamedPath(root, path.split('/').filter(Boolean));
        if (!target) continue;

        if (transform.position) {
          target.position.set(
            transform.position.x ?? 0,
            transform.position.y ?? 0,
            transform.position.z ?? 0,
          );
        }
        if (transform.rotation) {
          target.rotation.set(
            THREE.MathUtils.degToRad(transform.rotation.x ?? 0),
            THREE.MathUtils.degToRad(transform.rotation.y ?? 0),
            THREE.MathUtils.degToRad(transform.rotation.z ?? 0),
          );
        }
        if (transform.scale) {
          target.scale.set(
            transform.scale.x ?? 1,
            transform.scale.y ?? 1,
            transform.scale.z ?? 1,
          );
        }
      }
    } catch (err) {
      // Non-fatal — editor-written overrides may be absent or malformed.
      // Keep instantiation resilient.
      // eslint-disable-next-line no-console
      console.warn('[EntityFactory] failed applying child transforms override', err);
    }
  }

  private findNamedPath(root: THREE.Object3D, segments: string[], index = 0): THREE.Object3D | null {
    if (index >= segments.length) return root;

    const targetName = segments[index];

    for (const child of root.children) {
      if (child.name === targetName) {
        const found = this.findNamedPath(child, segments, index + 1);
        if (found) return found;
      }
    }

    // Skip structural wrappers that intentionally have no name.
    for (const child of root.children) {
      if (child.name) continue;
      const found = this.findNamedPath(child, segments, index);
      if (found) return found;
    }

    return null;
  }

  private createResolvedRenderable(entity: EditorEntity): THREE.Object3D {
    switch (entity.type) {
      case 'sprite':
      case 'animated_sprite':
        return this.createSprite(entity as SpriteEntity);
      case 'primitive':
        return this.createPrimitive(entity as PrimitiveEntity);
      case 'texture':
        return this.createTexture(entity as TextureEntity);
      case 'camera':
        return this.createCameraHelper(entity as CameraEntity);
      case 'light':
        return this.createLightHelper(entity as LightEntity);
      case 'sound':
        return this.createSoundHelper(entity as SoundEntity);
      case 'trigger':
        return this.createTriggerHelper(entity as TriggerEntity);
      case 'spawn':
        return this.createSpawnHelper(entity as SpawnEntity);
      case 'door':
        return this.createDoorHelper(entity as DoorEntity);
      default:
        return this.createGenericPlaceholder({
          id: 'unknown',
          name: 'Unknown',
          type: 'archetype_instance',
          archetypeId: '',
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          visible: true,
          layer: 0,
          overrides: {},
        });
    }
  }

  private applyTransform(obj: THREE.Object3D, transform: ArchetypeInstanceEntity['transform']): void {
    obj.position.set(transform.position.x, transform.position.y, transform.position.z);
    obj.rotation.set(
      THREE.MathUtils.degToRad(transform.rotation.x),
      THREE.MathUtils.degToRad(transform.rotation.y),
      THREE.MathUtils.degToRad(transform.rotation.z),
    );
    obj.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  }

  private createTexture(entity: TextureEntity): THREE.Object3D {
    const geo = new THREE.PlaneGeometry(2, 2);
    const hasTexture = Boolean(entity.textureSource);
    const matArgs: THREE.MeshStandardMaterialParameters = {
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: hasTexture || entity.opacity < 1,
      opacity: entity.opacity,
      roughness: 0.7,
      alphaTest: hasTexture ? 0.1 : 0,
    };

    if (entity.textureSource) {
      let tex = this.textureCache.get(entity.textureSource);
      if (!tex) {
        const loader = new THREE.TextureLoader();
        let path = entity.textureSource;
        if (!path.startsWith('sprites/') && !path.startsWith('textures/')) {
          path = `textures/${path}`;
        }
        tex = loader.load(`/assets/${path}`);
        this.textureCache.set(entity.textureSource, tex);
      }
      tex.repeat.set(entity.uvTilingX || 1, entity.uvTilingY || 1);
      tex.offset.set(entity.uvOffsetX || 0, entity.uvOffsetY || 0);
      matArgs.map = tex;
      matArgs.color = new THREE.Color(0xffffff);
    }

    const mat = new THREE.MeshStandardMaterial(matArgs);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.billboardMode = 'fixed';
    mesh.castShadow = entity.castShadows;
    mesh.receiveShadow = entity.receiveShadows;

    return mesh;
  }

  private createGenericPlaceholder(entity: ArchetypeInstanceEntity): THREE.Object3D {
    const geo = new THREE.OctahedronGeometry(0.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff8800, wireframe: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.entityId = entity.id;
    mesh.userData.entityType = entity.type;
    return mesh;
  }
}
