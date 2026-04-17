import * as THREE from 'three';
import { World } from '../ecs/World';
import { RoomData, EntitySpawnDef, CameraDef } from './RoomData';
import { TextureManager } from '../rendering/TextureManager';
import { SpriteAnimation, Transform, MeshRenderer, DoorMarker, CameraMarker } from '../ecs/Component';
import { NavGrid } from '../nav/NavGrid';
import { Entity } from '../ecs/Entity';

/**
 * Sprite sheet metadata — maps texture key → atlas layout + state frames.
 */
const SHEET_META: Record<string, {
    columns: number;
    rows: number;
    totalFrames: number;
    stateFrames: Record<string, { start: number; end: number }>;
}> = {
    'elias_sheet': {
        columns: 4, rows: 2, totalFrames: 8,
        stateFrames: { idle: { start: 0, end: 3 }, walk: { start: 4, end: 7 } }
    },
    'vance_sheet': {
        columns: 4, rows: 2, totalFrames: 8,
        stateFrames: { idle: { start: 0, end: 3 }, walk: { start: 4, end: 7 } }
    },
    'dog_sheet': {
        columns: 2, rows: 1, totalFrames: 2,
        stateFrames: { idle: { start: 0, end: 0 }, walk: { start: 1, end: 1 } }
    },
    'scifi_sheet': {
        columns: 4, rows: 2, totalFrames: 8,
        stateFrames: { idle: { start: 0, end: 3 }, walk: { start: 4, end: 7 } }
    }
};

export class RoomManager {
    public currentRoomId: string | null = null;
    public navGrid: NavGrid = new NavGrid();

    private world: World;
    private scene: THREE.Scene;
    private textureManager: TextureManager;
    private camera: THREE.PerspectiveCamera;

    constructor(
        world: World,
        scene: THREE.Scene,
        textureManager: TextureManager,
        camera: THREE.PerspectiveCamera
    ) {
        this.world = world;
        this.scene = scene;
        this.textureManager = textureManager;
        this.camera = camera;
    }

    async loadRoom(roomData: RoomData) {
        // ── 1. Preserve the Player entity across transitions ───────
        const existingPlayer = this.findPlayerEntity();
        this.unloadCurrentRoom(existingPlayer);

        this.currentRoomId = roomData.id;

        // ── 2. Camera (multi-camera support) ────────────────────────
        if (roomData.cameras && roomData.cameras.length > 0) {
            // Spawn camera entities for multi-camera switching
            for (let i = 0; i < roomData.cameras.length; i++) {
                const camDef = roomData.cameras[i];
                this.spawnCameraEntity(camDef, i);
            }
            // Apply the default camera immediately
            const defaultCam = roomData.cameras.find(c => c.isDefault) || roomData.cameras[0];
            this.applyCameraDef(defaultCam);
        } else {
            // Legacy single-camera fallback
            this.camera.position.set(
                roomData.cameraPosition.x,
                roomData.cameraPosition.y,
                roomData.cameraPosition.z
            );

            if (roomData.cameraRotation) {
                this.camera.rotation.set(
                    roomData.cameraRotation.x,
                    roomData.cameraRotation.y,
                    roomData.cameraRotation.z,
                    'XYZ'
                );
            } else if (roomData.cameraLookAt) {
                this.camera.lookAt(
                    roomData.cameraLookAt.x,
                    roomData.cameraLookAt.y,
                    roomData.cameraLookAt.z
                );
            }

            if (this.camera instanceof THREE.PerspectiveCamera) {
                if (roomData.cameraFov) this.camera.fov = roomData.cameraFov;
                if (roomData.cameraNear) this.camera.near = roomData.cameraNear;
                if (roomData.cameraFar) this.camera.far = roomData.cameraFar;
                this.camera.updateProjectionMatrix();
            }
        }

        // ── 3. Ambient light ───────────────────────────────────────
        const ambient = new THREE.AmbientLight(roomData.ambientColor, 1.5);
        (ambient as any).isRoomLight = true;
        this.scene.add(ambient);

        // ── 4. & 5. Floor and Walls ──────────────────────────────────
        let floorTex = this.textureManager.getTexture('lab_floor'); 
        const boundaries = roomData.boundaries;
        // In the new world map, floorY is usually just 0 since the map is top-down.
        // We set it explicitly or extract it from spawn points if we want multi-level (Phase 3).
        const floorY = 0; 


        // If we have a vectorized outline, construct a ShapeGeometry!
        if (roomData.outline && roomData.outline.length >= 3) {
            const outline = roomData.outline;
            const shape = new THREE.Shape();
            shape.moveTo(outline[0].x, outline[0].y); // y is z
            for (let i = 1; i < outline.length; i++) {
                shape.lineTo(outline[i].x, outline[i].y);
            }
            shape.closePath();

            // Floor
            if (floorTex) {
               floorTex.wrapS = THREE.RepeatWrapping;
               floorTex.wrapT = THREE.RepeatWrapping;
               floorTex.repeat.set(0.5, 0.5);
            }
            const floorMat = new THREE.MeshBasicMaterial({ map: floorTex || undefined, color: floorTex ? 0xffffff : 0x1a2030, side: THREE.DoubleSide });
            const floorGeo = new THREE.ShapeGeometry(shape);
            const floorMesh = new THREE.Mesh(floorGeo, floorMat);
            // Rotate so that +Y becomes +Z
            floorMesh.rotation.x = Math.PI / 2;
            floorMesh.position.set(0, floorY, 0); // Coordinates are absolute
            this.createBoundaryEntity(floorMesh, true);
            
            // Walls
            const wallHeight = 4;
            const wallTex = this.textureManager.getTexture('lab_wall');
            if (wallTex) {
               wallTex.wrapS = THREE.RepeatWrapping;
               wallTex.wrapT = THREE.RepeatWrapping;
            }
            const wallMat = new THREE.MeshBasicMaterial({ map: wallTex || undefined, color: wallTex ? 0xffffff : 0x223344, side: THREE.DoubleSide });
            for (let i = 0; i < outline.length; i++) {
                const p1 = outline[i];
                const p2 = outline[(i+1) % outline.length];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const angle = Math.atan2(-dy, dx);
                
                const wGeo = new THREE.PlaneGeometry(dist, wallHeight);
                const wMesh = new THREE.Mesh(wGeo, wallMat);
                wMesh.position.set(p1.x + dx/2, floorY + wallHeight/2, p1.y + dy/2);
                wMesh.rotation.y = angle;
                this.createBoundaryEntity(wMesh, false);
            }
            
            // Also need roughly the right nav grid center
            // Let's compute bounding box
            let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
            for(let p of outline) {
                if(p.x < minX) minX = p.x;
                if(p.x > maxX) maxX = p.x;
                if(p.y < minZ) minZ = p.y;
                if(p.y > maxZ) maxZ = p.y;
            }
            boundaries.floor.width = maxX - minX;
            boundaries.floor.depth = maxZ - minZ;
            boundaries.floor.position = { x: (minX + maxX)/2, y: floorY, z: (minZ + maxZ)/2 };

        } else {
            // Fallback rectangular floor
            const fallbackPos = boundaries.floor.position ?? { x: 0, y: 0, z: 0 };
            const floorTexRect = this.textureManager.getTexture(boundaries.floor.texture);
            if (floorTexRect) {
                const floorMat = new THREE.MeshBasicMaterial({ map: floorTexRect });
                const floorGeo = new THREE.PlaneGeometry(boundaries.floor.width, boundaries.floor.depth);
                const floorMesh = new THREE.Mesh(floorGeo, floorMat);
                floorMesh.rotation.x = -Math.PI / 2;
                floorMesh.position.set(fallbackPos.x, fallbackPos.y, fallbackPos.z);
                this.createBoundaryEntity(floorMesh, true);
            }
            // Fallback walls
            for (const wallDef of boundaries.walls) {
                const wTex = this.textureManager.getTexture(wallDef.texture);
                if (wTex) {
                    const wallMat = new THREE.MeshBasicMaterial({ map: wTex });
                    const wallGeo = new THREE.PlaneGeometry(wallDef.width, wallDef.height);
                    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
                    wallMesh.position.set(wallDef.position.x, wallDef.position.y, wallDef.position.z);
                    wallMesh.rotation.set(wallDef.rotation.x, wallDef.rotation.y, wallDef.rotation.z);
                    this.createBoundaryEntity(wallMesh, false);
                }
            }
        }

        // ── 6. Build NavGrid ───────────────────────────────────────
        const padding = roomData.walkPadding ?? 1.5;
        const floorPos = boundaries.floor.position ?? { x: 0, y: 0, z: 0 };
        this.navGrid.build(
            floorPos.x, floorPos.z,
            boundaries.floor.width,
            boundaries.floor.depth,
            padding
        );

        // ── 7. Spawn scene entities (props, lights, doors — NOT the player) ───
        for (const entityDef of roomData.entities) {
            if (entityDef.entityType === 'primitive') {
                this.spawnPrimitiveEntity(entityDef, floorY);
            } else if (entityDef.entityType === 'light') {
                this.spawnLightEntity(entityDef);
            } else if (entityDef.entityType === 'door') {
                this.spawnDoorEntity3D(entityDef, floorY);
            } else {
                // sprite or animated_sprite — scene prop, not player
                this.spawnSpriteEntity(entityDef, floorY, false);
            }

            // Stamp obstacles onto navgrid
            if (entityDef.isObstacle) {
                const hw = entityDef.obstacleHalfWidth ?? entityDef.width / 2;
                const hd = entityDef.obstacleHalfDepth ?? 0.8;
                this.navGrid.stampObstacle(entityDef.position.x, entityDef.position.z, hw, hd);
            }
        }

        // ── 7b. Legacy sprite-door step removed — 3D door entities from the editor
        //        supply both the visual and the DoorMarker.portalId for navigation. ──

        // ── 8. Spawn the player from spawnPoints ─────────────────────
        const existingPlayerAfterSpawn = this.findPlayerEntity();
        if (existingPlayerAfterSpawn === null) {
            // No player exists yet — spawn one at the designated spawn point
            let spawnPos = { x: 0, y: 0, z: 2 };
            let playerSpeed = roomData.characterSpeed ?? 3.0;
            let playerSpriteKey = roomData.characterAsset || 'scifi_sheet';
            if (roomData.spawnPoints && roomData.spawnPoints.length > 0) {
                spawnPos = roomData.spawnPoints[0].position;
            }
            this.spawnSpriteEntity(
                { spriteKey: playerSpriteKey, width: 2, height: 3, position: spawnPos },
                floorY, true, playerSpeed
            );
        }

        // ── 9. If player survived from previous room, update membership ──
        if (existingPlayer !== null) {
            this.world.addComponent(existingPlayer, 'RoomMember', { roomId: roomData.id });
            const player = this.world.getComponent(existingPlayer, 'Player')!;
            player.floorY = floorY;
        }
    }

    // ── Helpers ────────────────────────────────────────────────────

    private findPlayerEntity(): Entity | null {
        const players = this.world.queryEntities(['Player']);
        return players.length > 0 ? players[0] : null;
    }

    private createBoundaryEntity(mesh: THREE.Mesh, isFloor: boolean) {
        this.scene.add(mesh);
        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: mesh.position.clone(),
            rotation: mesh.rotation.clone(),
            scale: mesh.scale.clone()
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh });
        if (isFloor) {
            this.world.addComponent(entity, 'FloorMarker', { _tag: true });
        }
    }

    /**
     * Spawn a primitive entity (cube, cylinder, sphere, etc.) as real 3D geometry.
     */
    private spawnPrimitiveEntity(def: EntitySpawnDef, floorY: number) {
        let geo: THREE.BufferGeometry;
        const geoType = def.geometryType || 'cube';

        switch (geoType) {
            case 'cube':     geo = new THREE.BoxGeometry(1, 1, 1); break;
            case 'sphere':   geo = new THREE.SphereGeometry(0.5, 16, 12); break;
            case 'plane':    geo = new THREE.PlaneGeometry(2, 2); break;
            case 'cylinder': geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
            case 'cone':     geo = new THREE.ConeGeometry(0.5, 1, 16); break;
            default:         geo = new THREE.BoxGeometry(1, 1, 1); break;
        }

        const color = new THREE.Color(def.color || '#808080');
        const mat = new THREE.MeshStandardMaterial({
            color,
            transparent: (def.opacity ?? 1) < 1,
            opacity: def.opacity ?? 1,
            roughness: 0.6,
            metalness: 0.1,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geo, mat);

        // Apply position and scale from editor
        const sx = def.scale?.x ?? 1;
        const sy = def.scale?.y ?? 1;
        const sz = def.scale?.z ?? 1;
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(def.position.x, def.position.y || floorY + sy / 2, def.position.z);

        this.scene.add(mesh);

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: mesh.position.clone(),
            rotation: mesh.rotation.clone(),
            scale: mesh.scale.clone()
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh });
    }

    /**
     * Spawn a light entity from the editor.
     */
    private spawnLightEntity(def: EntitySpawnDef) {
        const color = new THREE.Color(def.lightColor || '#ffffff');
        const intensity = def.lightIntensity ?? 1;
        const distance = def.lightDistance ?? 10;

        let light: THREE.Light;
        switch (def.lightType) {
            case 'directional':
                light = new THREE.DirectionalLight(color, intensity);
                break;
            case 'spot':
                light = new THREE.SpotLight(color, intensity, distance);
                break;
            default:
                light = new THREE.PointLight(color, intensity, distance);
                break;
        }

        light.position.set(def.position.x, def.position.y, def.position.z);
        (light as any).isRoomLight = true;
        this.scene.add(light);
    }

    private spawnSpriteEntity(def: EntitySpawnDef, floorY: number, isPlayer: boolean, playerSpeed: number = 3.0) {
        const tex = this.textureManager.getTexture(def.spriteKey);

        const mat = new THREE.MeshBasicMaterial({
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
            map: tex
        });

        const geo = new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(geo, mat);

        // ── Feet-first positioning ────────────────────────────────
        const feetX = def.position.x;
        const feetZ = def.position.z;
        mesh.position.set(feetX, floorY, feetZ);
        this.scene.add(mesh);

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: new THREE.Vector3(feetX, floorY, feetZ),
            rotation: new THREE.Euler(),
            scale: new THREE.Vector3(1, 1, 1)
        });
        
        // ── Aspect Ratio Correction ─────────────────────────────
        let spriteW = def.width;
        let spriteH = def.height;
        if (tex && tex.image && tex.image.width > 0) {
            // Only auto-correct if the image is NOT square (AI often defaults to square for non-sheet assets)
            if (tex.image.width !== tex.image.height) {
                const imgAspect = tex.image.width / tex.image.height;
                const meta = SHEET_META[def.spriteKey];
                const frameAspect = meta ? (imgAspect * (meta.rows / meta.columns)) : imgAspect;
                spriteW = def.height * frameAspect;
                console.log(`Sprite ${def.spriteKey} -> auto-adjusted width ${spriteW.toFixed(2)}`);
            }
        }

        this.world.addComponent(entity, 'MeshRenderer', { mesh });
        this.world.addComponent(entity, 'Sprite', {
            textureKey: def.spriteKey,
            frame: 0,
            baseWidth: spriteW,
            baseHeight: spriteH,
            discreteScaleOffset: 0
        });

        // Obstacle tag
        if (def.isObstacle) {
            this.world.addComponent(entity, 'Obstacle', {
                halfWidth: def.obstacleHalfWidth ?? def.width / 2,
                halfDepth: def.obstacleHalfDepth ?? 0.8
            });
        }

        // Sprite animation
        const meta = SHEET_META[def.spriteKey];
        if (meta && tex) {
            tex.repeat.set(1 / meta.columns, 1 / meta.rows);
            tex.offset.set(0, 1 - 1 / meta.rows);
            this.world.addComponent(entity, 'SpriteAnimation', {
                columns: meta.columns,
                rows: meta.rows,
                totalFrames: meta.totalFrames,
                currentFrame: 0,
                frameRate: 6,
                timeAccumulator: 0,
                state: 'idle' as const,
                stateFrames: meta.stateFrames
            } satisfies SpriteAnimation);
        }

        // Player
        if (isPlayer) {
            this.world.addComponent(entity, 'Player', {
                path: [],
                speed: playerSpeed,
                isMoving: false,
                floorY: floorY,
                pendingPortalId: null
            });
        }
    }

    /**
     * Spawn a 3D door entity from the editor's door entity type.
     * Creates a 3D box instead of a flat plane.
     */
    private spawnDoorEntity3D(def: EntitySpawnDef, floorY: number) {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const color = new THREE.Color(def.color || '#6B4423');
        const matParams: THREE.MeshStandardMaterialParameters = {
            color,
            transparent: (def.opacity ?? 1) < 1,
            opacity: def.opacity ?? 1,
            roughness: 0.7,
            metalness: 0.1,
            side: THREE.DoubleSide,
        };

        // Apply texture if specified
        if (def.textureSource) {
            const loader = new THREE.TextureLoader();
            const tex = loader.load(`/assets/textures/${def.textureSource}`);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            if (def.uvTilingX || def.uvTilingY) {
                tex.repeat.set(def.uvTilingX || 1, def.uvTilingY || 1);
            }
            if (def.uvOffsetX || def.uvOffsetY) {
                tex.offset.set(def.uvOffsetX || 0, def.uvOffsetY || 0);
            }
            matParams.map = tex;
            matParams.color = new THREE.Color(0xffffff);
        }

        const mat = new THREE.MeshStandardMaterial(matParams);
        const mesh = new THREE.Mesh(geo, mat);

        const sx = def.scale?.x ?? 1.2;
        const sy = def.scale?.y ?? 2.5;
        const sz = def.scale?.z ?? 0.35;
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(def.position.x, (def.position.y || floorY) + sy / 2, def.position.z);

        if (def.rotation) {
            mesh.rotation.set(
                def.rotation.x * Math.PI / 180,
                def.rotation.y * Math.PI / 180,
                def.rotation.z * Math.PI / 180
            );
        }

        this.scene.add(mesh);

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: mesh.position.clone(),
            rotation: mesh.rotation.clone(),
            scale: mesh.scale.clone()
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh });
        this.world.addComponent(entity, 'DoorMarker', {
            portalId: def.portalId || '',
            targetRoom: def.targetRoomId || '',
            targetSpawnId: def.targetSpawnId || '',
            interactionState: def.interactionState || 'open'
        });
    }

    /**
     * Spawn a camera entity in the ECS for multi-camera switching.
     */
    private spawnCameraEntity(camDef: CameraDef, index: number) {
        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: new THREE.Vector3(camDef.position.x, camDef.position.y, camDef.position.z),
            rotation: new THREE.Euler(camDef.rotation.x, camDef.rotation.y, camDef.rotation.z, 'XYZ'),
            scale: new THREE.Vector3(1, 1, 1)
        });
        this.world.addComponent(entity, 'CameraMarker', {
            cameraIndex: index,
            isDefault: camDef.isDefault,
            targetLookAt: camDef.targetLookAt || '',
            fov: camDef.fov || 45
        });
    }

    /**
     * Apply a camera definition to the main camera.
     */
    private applyCameraDef(camDef: CameraDef) {
        this.camera.position.set(camDef.position.x, camDef.position.y, camDef.position.z);
        
        if (!camDef.targetLookAt) {
            this.camera.rotation.set(camDef.rotation.x, camDef.rotation.y, camDef.rotation.z, 'XYZ');
        }

        this.camera.fov = camDef.fov || 45;
        this.camera.near = camDef.near || 0.1;
        this.camera.far = camDef.far || 100;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Unload all room entities except the preserved player.
     */
    unloadCurrentRoom(preserveEntity: Entity | null = null) {
        if (!this.currentRoomId) return;

        const members = this.world.queryEntities(['RoomMember']);
        for (const member of members) {
            if (member === preserveEntity) continue; // keep player alive
            const roomComp = this.world.getComponent(member, 'RoomMember');
            if (roomComp?.roomId === this.currentRoomId) {
                const renderer = this.world.getComponent(member, 'MeshRenderer');
                if (renderer) {
                    this.scene.remove(renderer.mesh);
                }
                this.world.destroyEntity(member);
            }
        }

        // Remove room lights
        const lightsToRemove: THREE.Object3D[] = [];
        this.scene.traverse((obj) => {
            if ((obj as any).isRoomLight) lightsToRemove.push(obj);
        });
        lightsToRemove.forEach(l => this.scene.remove(l));

        this.currentRoomId = null;
    }
}
