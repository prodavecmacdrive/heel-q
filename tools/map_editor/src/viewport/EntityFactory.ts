/* ═══════════════════════════════════════════════════════════════════════
   EntityFactory — creates Three.js objects from entity definitions
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import type {
  EditorEntity,
  PrimitiveEntity,
  CameraEntity,
  LightEntity,
  SoundEntity,
  TriggerEntity,
  SpawnEntity,
  SpriteEntity,
  AnimatedSpriteEntity,
  DoorEntity,
} from '../types/entities';

/**
 * Creates a Three.js Object3D representation for an entity.
 * Each returned object has `userData.entityId` set for raycaster picking.
 */
export class EntityFactory {

  public create(entity: EditorEntity): THREE.Object3D {
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
    }

    // Apply transform
    const t = entity.transform;
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
           if (!path.startsWith('sprites/') && !path.startsWith('textures/')) {
             const dir = entity.type === 'animated_sprite' ? 'sprites/' : 'textures/';
             path = `${dir}${path}`;
           }
           tex = loader.load(`/assets/${path}`);
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
    mesh.position.y = 1; // lift to stand on floor

    // Wireframe outline
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.5 })
    );
    mesh.add(wire);

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
    const matParams: THREE.MeshStandardMaterialParameters = {
      color,
      transparent: true,
      opacity: entity.opacity,
      roughness: 0.6,
      metalness: 0.1,
      wireframe: entity.materialType === 'invisible',
    };

    // Apply static texture if materialType is 'textured' or 'sequence'
    const textureKey = entity.materialType === 'sequence' && entity.sequenceSource ? entity.sequenceSource : entity.textureSource;
    if ((entity.materialType === 'textured' || entity.materialType === 'sequence') && textureKey) {
      const texSrc = textureKey;
      let tex = this.textureCache.get(texSrc);
      if (!tex) {
        const loader = new THREE.TextureLoader();
        const path = texSrc.startsWith('textures/') || texSrc.startsWith('sprites/')
          ? texSrc
          : (entity.materialType === 'sequence' ? `sprites/${texSrc}` : `textures/${texSrc}`);
        
        // Ensure we handle the .png if only a .json name was provided for a sequence
        const finalPath = (entity.materialType === 'sequence' && !path.endsWith('.png') && !path.endsWith('.jpg'))
            ? path.replace('.json', '.png').replace(/\.[^.]+$/, '.png')
            : path;
            
        tex = loader.load(`/assets/${finalPath}`);
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
    mesh.add(edges);

    return mesh;
  }

  // ── Camera Helper ──────────────────────────────────────────────────

  private createCameraHelper(_entity: CameraEntity): THREE.Object3D {
    const group = new THREE.Group();

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
    const color = new THREE.Color(entity.color);

    // Glowing orb
    const orbGeo = new THREE.SphereGeometry(0.2, 12, 8);
    const orbMat = new THREE.MeshBasicMaterial({
      color,
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = 0.3;
    group.add(orb);

    // Light rays (cross wireframe)
    const rayMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
    const points = [
      new THREE.Vector3(-0.5, 0.3, 0), new THREE.Vector3(0.5, 0.3, 0),
      new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 0.8, 0),
      new THREE.Vector3(0, 0.3, -0.5), new THREE.Vector3(0, 0.3, 0.5),
    ];
    for (let i = 0; i < points.length; i += 2) {
      const geo = new THREE.BufferGeometry().setFromPoints([points[i], points[i + 1]]);
      group.add(new THREE.Line(geo, rayMat));
    }

    // Range ring
    const ringGeo = new THREE.RingGeometry(entity.distance * 0.8, entity.distance, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    group.add(ring);

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
}
