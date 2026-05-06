import * as THREE from 'three';
import { World } from '../ecs/World';
import { RoomData, EntitySpawnDef, CameraDef, HeightModifier } from './RoomData';
import { TextureManager } from '../rendering/TextureManager';
import { SpriteAnimation, AtlasAnimation, Transform, MeshRenderer, DoorMarker, CameraMarker, Sprite } from '../ecs/Component';
import { NavGrid, CELL_SIZE } from '../nav/NavGrid';
import { Entity } from '../ecs/Entity';
import { CHARACTER_HEIGHT } from '../constants';
import type { SpriteSheetMeta } from '@heel-quest/shared-core';
import { computeTerrainHeight } from '@heel-quest/shared-core';

export class RoomManager {
    public currentRoomId: string | null = null;
    public navGrid: NavGrid = new NavGrid();

    private world: World;
    private scene: THREE.Scene;
    private textureManager: TextureManager;
    private camera: THREE.PerspectiveCamera;
    private roomAudioElements: HTMLAudioElement[] = [];
    private sheetMeta: Map<string, SpriteSheetMeta> = new Map();
    private materialCache: Map<string, THREE.Material> = new Map();
    /** Height modifiers of the currently-loaded room (empty = flat terrain) */
    private currentHeightModifiers: HeightModifier[] = [];

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

    /** Register externally-loaded sprite sheet metadata */
    public setSheetMeta(meta: Map<string, SpriteSheetMeta>): void {
        this.sheetMeta = meta;
    }

    /**
     * Compute the terrain Y displacement at a world XZ position for the current room.
     * Returns 0 when the room has no height modifiers (flat terrain).
     */
    public getFloorY(wx: number, wz: number): number {
        return computeTerrainHeight(this.currentHeightModifiers, wx, wz);
    }

    private getMaterial(key: string, factory: () => THREE.Material): THREE.Material {
        const existing = this.materialCache.get(key);
        if (existing) return existing;
        const material = factory();
        this.materialCache.set(key, material);
        return material;
    }

    async loadRoom(roomData: RoomData) {
        // ── 1. Preserve the Player entity across transitions ───────
        const existingPlayer = this.findPlayerEntity();
        this.unloadCurrentRoom(existingPlayer);

        this.currentRoomId = roomData.id;

        // Store height modifiers for this room (used by getFloorY + MovementSystem)
        this.currentHeightModifiers = roomData.heightModifiers ?? [];

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


        // If we have a vectorized outline, construct a terrain-displaced floor mesh
        if (roomData.outline && roomData.outline.length >= 3) {
            const outline = roomData.outline;

            // Compute AABB of the outline
            let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
            for (const p of outline) {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minZ) minZ = p.y; if (p.y > maxZ) maxZ = p.y;
            }
            const fw = maxX - minX + 1;
            const fd = maxZ - minZ + 1;
            const fcx = (minX + maxX) / 2;
            const fcz = (minZ + maxZ) / 2;
            boundaries.floor.width  = maxX - minX;
            boundaries.floor.depth  = maxZ - minZ;
            boundaries.floor.position = { x: fcx, y: floorY, z: fcz };

            // Subdivided terrain floor
            const FLOOR_SEGS = 64;
            if (floorTex) {
                floorTex.wrapS = THREE.RepeatWrapping;
                floorTex.wrapT = THREE.RepeatWrapping;
                floorTex.repeat.set(0.5, 0.5);
            }
            const floorMat = this.getMaterial(`boundary|floor|${floorTex?.uuid ?? 'none'}`, () => new THREE.MeshStandardMaterial({
                map: floorTex || undefined,
                color: floorTex ? 0xffffff : 0x1a2030,
                side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0
            })) as THREE.MeshStandardMaterial;
            if (floorTex) floorMat.map = floorTex;
            const floorGeo = new THREE.PlaneGeometry(fw, fd, FLOOR_SEGS, FLOOR_SEGS);
            floorGeo.rotateX(-Math.PI / 2);
            floorGeo.translate(fcx, 0, fcz);

            // Displace vertices by terrain height
            const posAttr = floorGeo.attributes.position as THREE.BufferAttribute;
            for (let i = 0; i < posAttr.count; i++) {
                const vx = posAttr.getX(i);
                const vz = posAttr.getZ(i);
                posAttr.setY(i, floorY + this.getFloorY(vx, vz));
            }
            posAttr.needsUpdate = true;
            floorGeo.computeVertexNormals();

            const floorMesh = new THREE.Mesh(floorGeo, floorMat);
            floorMesh.receiveShadow = true;
            this.createBoundaryEntity(floorMesh, true);

            // Walls built from outline vertices; base Y follows terrain at each vertex
            const wallHeight = 4;
            const wallTex = this.textureManager.getTexture('lab_wall');
            if (wallTex) {
                wallTex.wrapS = THREE.RepeatWrapping;
                wallTex.wrapT = THREE.RepeatWrapping;
            }
            const wallMat = this.getMaterial('boundary|wall', () => new THREE.MeshStandardMaterial({
                map: wallTex || undefined,
                color: wallTex ? 0xffffff : 0x223344,
                side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0
            })) as THREE.MeshStandardMaterial;
            if (wallTex) wallMat.map = wallTex;
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
                const baseY = floorY + this.getFloorY(p.x, p.y);
                wPos[i*6]   = p.x; wPos[i*6+1] = baseY;              wPos[i*6+2] = p.y;
                wPos[i*6+3] = p.x; wPos[i*6+4] = baseY + wallHeight; wPos[i*6+5] = p.y;
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
            wallMesh.receiveShadow = true;
            this.createBoundaryEntity(wallMesh, false);

        } else {
            // Fallback rectangular floor
            const fallbackPos = boundaries.floor.position ?? { x: 0, y: 0, z: 0 };
            const floorTexRect = this.textureManager.getTexture(boundaries.floor.texture);
            if (floorTexRect) {
                const floorMat = this.getMaterial('boundary|floor_rect', () => new THREE.MeshStandardMaterial({ map: floorTexRect, roughness: 0.9, metalness: 0.0 })) as THREE.MeshStandardMaterial;
            floorMat.map = floorTexRect;
                const floorGeo = new THREE.PlaneGeometry(boundaries.floor.width, boundaries.floor.depth);
                const floorMesh = new THREE.Mesh(floorGeo, floorMat);
                floorMesh.rotation.x = -Math.PI / 2;
                floorMesh.position.set(fallbackPos.x, fallbackPos.y, fallbackPos.z);
                floorMesh.receiveShadow = true;
                this.createBoundaryEntity(floorMesh, true);
            }
            // Fallback walls
            for (const wallDef of boundaries.walls) {
                const wTex = this.textureManager.getTexture(wallDef.texture);
                if (wTex) {
                    const wallMat = this.getMaterial(`boundary|wall_rect|${wTex?.uuid || 'none'}`, () => new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.9, metalness: 0.0 })) as THREE.MeshStandardMaterial;
                    if (wTex) wallMat.map = wTex;
                    const wallGeo = new THREE.PlaneGeometry(wallDef.width, wallDef.height);
                    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
                    wallMesh.position.set(wallDef.position.x, wallDef.position.y, wallDef.position.z);
                    wallMesh.rotation.set(wallDef.rotation.x, wallDef.rotation.y, wallDef.rotation.z);
                    wallMesh.receiveShadow = true;
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
            // entity.position.y = offset above terrain; add terrain height to get world Y
            const entityTerrainY = floorY + this.getFloorY(entityDef.position.x, entityDef.position.z);

            if (entityDef.entityType === 'primitive') {
                this.spawnPrimitiveEntity(entityDef, entityTerrainY);
            } else if (entityDef.entityType === 'light') {
                this.spawnLightEntity(entityDef, entityTerrainY);
            } else if (entityDef.entityType === 'door') {
                this.spawnDoorEntity3D(entityDef, entityTerrainY);
            } else if (entityDef.entityType === 'sound') {
                this.spawnSoundEntity(entityDef);
                continue; // sound entities have no obstacle geometry
            } else if (entityDef.entityType === 'animated_sprite' && entityDef.atlasFrames) {
                this.spawnAtlasSpriteEntity(entityDef, entityTerrainY);
            } else {
                // sprite or animated_sprite (no pre-parsed atlas) — scene prop
                this.spawnSpriteEntity(entityDef, entityTerrainY, false);
            }

            // Stamp obstacles onto navgrid
            if (entityDef.isObstacle) {
                // If the object is positioned higher than the character's height profile, skip collision stamping.
                // This allows the character to pass underneath "floating" or "hanging" objects.
                if (entityDef.position.y <= CHARACTER_HEIGHT) {
                    const shape = this.computeObstacleShape(entityDef);
                    if (shape.kind === 'circle') {
                        this.navGrid.stampObstacleCircle(entityDef.position.x, entityDef.position.z, shape.radius);
                    } else {
                        const worldShape = shape.points.map(p => ({ x: p.x + entityDef.position.x, z: p.z + entityDef.position.z }));
                        this.navGrid.stampObstaclePolygon(worldShape);
                    }
                }
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
            let playerSpriteKey = roomData.characterSequenceSource || roomData.characterAsset || 'scifi_sheet';
            if (roomData.spawnPoints && roomData.spawnPoints.length > 0) {
                spawnPos = roomData.spawnPoints[0].position;
            }
            // Player spawn Y = terrain height at spawn XZ (position.y offset is assumed 0)
            const spawnTerrainY = floorY + this.getFloorY(spawnPos.x, spawnPos.z);

            if (roomData.characterSequenceJson || roomData.characterSequenceSource || (roomData.characterSequenceFrames && roomData.characterSequenceFrames.length > 0)) {
                this.spawnAtlasSpriteEntity(
                    {
                        spriteKey: playerSpriteKey,
                        width: 2,
                        height: 3,
                        position: spawnPos,
                        fps: roomData.characterSequenceFps ?? 12,
                        loop: roomData.characterSequenceLoop ?? true,
                        autoplay: roomData.characterSequenceAutoplay ?? true,
                        atlasFrames: roomData.characterSequenceFrames,
                        imageWidth: roomData.characterSequenceImageWidth,
                        imageHeight: roomData.characterSequenceImageHeight,
                        castShadow: roomData.characterCastShadow ?? false,
                        receiveShadow: roomData.characterReceiveShadow ?? false,
                    },
                    spawnTerrainY,
                    true,
                    playerSpeed
                );
            } else {
                this.spawnSpriteEntity(
                    { spriteKey: playerSpriteKey, width: 2, height: 3, position: spawnPos, castShadow: roomData.characterCastShadow ?? false, receiveShadow: roomData.characterReceiveShadow ?? false },
                    spawnTerrainY, true, playerSpeed
                );
            }
        }

        // ── 9. If player survived from previous room, update membership ──
        if (existingPlayer !== null) {
            this.world.addComponent(existingPlayer, 'RoomMember', { roomId: roomData.id });
            // floorY is now dynamic (terrain-aware); MovementSystem will track it per frame
            const player = this.world.getComponent(existingPlayer, 'Player')!;
            const transform = this.world.getComponent(existingPlayer, 'Transform')!;
            player.floorY = floorY + this.getFloorY(
                (transform as Transform).position.x,
                (transform as Transform).position.z
            );
        }
    }

    // ── Helpers ────────────────────────────────────────────────────

    private findPlayerEntity(): Entity | null {
        const players = this.world.queryEntities(['Player']);
        return players.length > 0 ? players[0] : null;
    }

    private computeObstacleShape(def: EntitySpawnDef):
        | { kind: 'circle'; radius: number }
        | { kind: 'polygon'; points: Array<{ x: number; z: number }> } {
        const sx = Math.abs(def.scale?.x ?? 1);
        const sy = Math.abs(def.scale?.y ?? 1);
        const sz = Math.abs(def.scale?.z ?? 1);
        const isSpriteProp = def.entityType === 'sprite' || def.entityType === 'animated_sprite';

        if (def.obstacleHalfWidth !== undefined || def.obstacleHalfDepth !== undefined || isSpriteProp) {
            const halfW = def.obstacleHalfWidth ?? def.width / 2;
            const halfD = def.obstacleHalfDepth ?? (isSpriteProp ? 0.1 : 0.8);
            const useCameraYaw = isSpriteProp && (def.billboardMode ?? 'y_axis') !== 'fixed';
            const rotY = useCameraYaw
                ? Math.atan2(this.camera.position.x - def.position.x, this.camera.position.z - def.position.z)
                : (def.rotation?.y ?? 0) * Math.PI / 180;
            const sinY = Math.sin(rotY);
            const cosY = Math.cos(rotY);
            const corners = [
                { x: -halfW, z: -halfD },
                { x: halfW, z: -halfD },
                { x: halfW, z: halfD },
                { x: -halfW, z: halfD }
            ].map(p => ({
                x: p.x * cosY - p.z * sinY,
                z: p.x * sinY + p.z * cosY
            }));
            return {
                kind: 'polygon',
                points: this.convexHull2D(corners)
            };
        }

        const rotX = (def.rotation?.x ?? 0) * Math.PI / 180;
        const rotY = (def.rotation?.y ?? 0) * Math.PI / 180;
        const rotZ = (def.rotation?.z ?? 0) * Math.PI / 180;
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'XYZ'));

        const width = def.width ?? 1;
        const height = def.height ?? 1;

        if (def.geometryType === 'sphere') {
            const radius = 0.5 * Math.max(sx, sz);
            return { kind: 'circle', radius };
        }

        if (def.geometryType === 'cylinder' || def.geometryType === 'cone') {
            const radius = 0.5 * Math.max(sx, sz);
            return { kind: 'circle', radius };
        }

        if (def.geometryType === 'plane') {
            const planeBaseSize = 2;
            const halfW = width * planeBaseSize / 2;
            const halfH = height * planeBaseSize / 2;
            const xAxis = new THREE.Vector3(halfW, 0, 0).applyQuaternion(quat);
            const yAxis = new THREE.Vector3(0, halfH, 0).applyQuaternion(quat);

            const corners = [
                xAxis.clone().add(yAxis),
                xAxis.clone().sub(yAxis),
                xAxis.clone().negate().sub(yAxis),
                xAxis.clone().negate().add(yAxis)
            ];

            const projected = corners.map(p => ({ x: p.x, z: p.z }));
            const hull = this.convexHull2D(projected);
            const minHalfThickness = CELL_SIZE * 0.5 + 0.01;
            return {
                kind: 'polygon',
                points: hull.length >= 3 ? hull : this.buildThinPolygon(projected, minHalfThickness)
            };
        }

        // Box / rectangular primitive footprint
        const hw = width * sx / 2;
        const hh = height * sy / 2;
        const hd = 0.5 * sz;

        const corners = [
            new THREE.Vector3( hw,  hh,  hd),
            new THREE.Vector3( hw,  hh, -hd),
            new THREE.Vector3( hw, -hh,  hd),
            new THREE.Vector3( hw, -hh, -hd),
            new THREE.Vector3(-hw,  hh,  hd),
            new THREE.Vector3(-hw,  hh, -hd),
            new THREE.Vector3(-hw, -hh,  hd),
            new THREE.Vector3(-hw, -hh, -hd)
        ];

        return {
            kind: 'polygon',
            points: this.convexHull2D(this.projectToXZ(corners, quat))
        };
    }

    private computeObstacleExtents(def: EntitySpawnDef): { halfWidth: number; halfDepth: number } {
        const shape = this.computeObstacleShape(def);
        if (shape.kind === 'circle') {
            return { halfWidth: shape.radius, halfDepth: shape.radius };
        }

        let maxX = 0;
        let maxZ = 0;
        for (const point of shape.points) {
            maxX = Math.max(maxX, Math.abs(point.x));
            maxZ = Math.max(maxZ, Math.abs(point.z));
        }
        return { halfWidth: Math.max(maxX, 0.1), halfDepth: Math.max(maxZ, 0.1) };
    }

    private projectToXZ(points: THREE.Vector3[], quat: THREE.Quaternion): Array<{ x: number; z: number }> {
        return points.map(p => {
            const transformed = p.clone().applyQuaternion(quat);
            return { x: transformed.x, z: transformed.z };
        });
    }

    private convexHull2D(points: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
        if (points.length <= 3) return points.slice();
        const sorted = points.slice().sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
        const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
            (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);

        const lower: Array<{ x: number; z: number }> = [];
        for (const point of sorted) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
                lower.pop();
            }
            lower.push(point);
        }

        const upper: Array<{ x: number; z: number }> = [];
        for (let i = sorted.length - 1; i >= 0; i--) {
            const point = sorted[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
                upper.pop();
            }
            upper.push(point);
        }

        upper.pop();
        lower.pop();
        return lower.concat(upper);
    }

    private buildThinPolygon(points: Array<{ x: number; z: number }>, halfThickness: number): Array<{ x: number; z: number }> {
        const unique = Array.from(new Map(points.map(p => [`${p.x.toFixed(5)},${p.z.toFixed(5)}`, p])).values());
        if (unique.length < 2) {
            return [
                { x: -halfThickness, z: -halfThickness },
                { x: halfThickness, z: -halfThickness },
                { x: halfThickness, z: halfThickness },
                { x: -halfThickness, z: halfThickness }
            ];
        }

        const p0 = unique[0];
        const p1 = unique.length === 2 ? unique[1] : unique[unique.length - 1];
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;

        return [
            { x: p0.x + nx * halfThickness, z: p0.z + nz * halfThickness },
            { x: p1.x + nx * halfThickness, z: p1.z + nz * halfThickness },
            { x: p1.x - nx * halfThickness, z: p1.z - nz * halfThickness },
            { x: p0.x - nx * halfThickness, z: p0.z - nz * halfThickness }
        ];
    }

    private pointInPolygon(x: number, z: number, polygon: Array<{ x: number; z: number }>): boolean {
        let inside = false;
        const n = polygon.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = polygon[i].x;
            const zi = polygon[i].z;
            const xj = polygon[j].x;
            const zj = polygon[j].z;
            const intersect = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    private createCollisionWireframe(def: EntitySpawnDef, floorY: number) {
        if (def.entityType !== 'sprite' && def.entityType !== 'animated_sprite') {
            return;
        }

        const shape = this.computeObstacleShape(def);
        const baseY = floorY + 0.01;
        let points: THREE.Vector3[] = [];

        if (shape.kind === 'circle') {
            const segments = 32;
            for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * Math.PI * 2;
                points.push(new THREE.Vector3(
                    def.position.x + Math.cos(theta) * shape.radius,
                    baseY,
                    def.position.z + Math.sin(theta) * shape.radius
                ));
            }
        } else {
            points = shape.points.map(p => new THREE.Vector3(def.position.x + p.x, baseY, def.position.z + p.z));
            if (points.length > 0) {
                points.push(points[0].clone());
            }
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 2, transparent: true, opacity: 0.85 });
        const line = new THREE.LineLoop(geometry, material);
        this.scene.add(line);

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Euler(0, 0, 0),
            scale: new THREE.Vector3(1, 1, 1)
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh: line });
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

        const hasTexture = !!def.textureSource || !!def.sequenceSource;
        const texturePathValue = def.sequenceSource || def.textureSource;
        const materialKey = `primitive|${def.geometryType || 'cube'}|${hasTexture ? texturePathValue : def.color || '#808080'}|opacity:${def.opacity ?? 1}|atlas:${!!def.atlasFrames}|tiling:${def.uvTilingX ?? 1},${def.uvTilingY ?? 1}|offset:${def.uvOffsetX ?? 0},${def.uvOffsetY ?? 0}`;
        const mat = this.getMaterial(materialKey, () => {
            const material = new THREE.MeshStandardMaterial({
                color: hasTexture ? new THREE.Color(0xffffff) : new THREE.Color(def.color || '#808080'),
                transparent: hasTexture || (def.opacity ?? 1) < 1,
                opacity: def.opacity ?? 1,
                roughness: 0.6,
                metalness: 0.1,
                side: THREE.DoubleSide,
                shadowSide: THREE.FrontSide,
                alphaTest: hasTexture ? 0.1 : 0,
            });
            return material;
        }) as THREE.MeshStandardMaterial;

        if (texturePathValue) {
            const loader = new THREE.TextureLoader();
            const path = texturePathValue.startsWith('textures/') || texturePathValue.startsWith('sprites/')
                ? texturePathValue
                : (def.sequenceSource ? `sprites/${texturePathValue}` : `textures/${texturePathValue}`);
            const tex = loader.load(`/assets/${path}`);
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.NearestFilter;
            tex.generateMipmaps = false;
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            if (def.atlasFrames && def.imageWidth && def.imageHeight && def.atlasFrames.length > 0) {
                const firstFrame = def.atlasFrames[0];
                tex.repeat.set(firstFrame.w / def.imageWidth, firstFrame.h / def.imageHeight);
                tex.offset.set(firstFrame.x / def.imageWidth, 1 - (firstFrame.y + firstFrame.h) / def.imageHeight);
            } else {
                tex.repeat.set(def.uvTilingX ?? 1, def.uvTilingY ?? 1);
                tex.offset.set(def.uvOffsetX ?? 0, def.uvOffsetY ?? 0);
            }
            mat.map = tex;
            mat.needsUpdate = true;
        }

        const mesh = new THREE.Mesh(geo, mat);

        if (def.rotation) {
            mesh.rotation.set(
                def.rotation.x * Math.PI / 180,
                def.rotation.y * Math.PI / 180,
                def.rotation.z * Math.PI / 180
            );
        }

        // Apply position and scale from editor
        const sx = def.scale?.x ?? 1;
        const sy = def.scale?.y ?? 1;
        const sz = def.scale?.z ?? 1;
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(
            def.position.x,
            def.position.y !== undefined ? def.position.y : floorY + sy / 2,
            def.position.z
        );

        // Shadow
        mesh.castShadow = def.castShadow ?? false;
        mesh.receiveShadow = def.receiveShadow ?? true;

        this.scene.add(mesh);

        if (def.isObstacle) {
            this.createCollisionWireframe(def, floorY);
        }

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: mesh.position.clone(),
            rotation: mesh.rotation.clone(),
            scale: mesh.scale.clone()
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh });

        if (def.atlasFrames && def.imageWidth && def.imageHeight && def.atlasFrames.length > 0) {
            this.world.addComponent(entity, 'AtlasAnimation', {
                frames: def.atlasFrames,
                imageWidth: def.imageWidth,
                imageHeight: def.imageHeight,
                currentFrame: 0,
                frameRate: def.fps ?? 12,
                timeAccumulator: 0,
                loop: def.loop ?? true,
                autoplay: def.autoplay ?? true,
            } satisfies AtlasAnimation);
        }
    }

    /**
     * Spawn a light entity from the editor.
     */
    private spawnLightEntity(def: EntitySpawnDef, baseY: number = 0) {
        const color = new THREE.Color(def.lightColor || '#ffffff');
        const intensity = def.lightIntensity ?? 1;
        const distance = def.lightDistance ?? 10;
        const decay = def.lightDecay ?? 2;

        const position = new THREE.Vector3(
            def.position.x,
            def.position.y !== undefined ? def.position.y : baseY,
            def.position.z
        );
        const rotation = new THREE.Euler(
            (def.rotation?.x ?? 0) * Math.PI / 180,
            (def.rotation?.y ?? 0) * Math.PI / 180,
            (def.rotation?.z ?? 0) * Math.PI / 180,
            'XYZ'
        );

        // targetPosition is stored as world-space in the editor.
        // (0,0,0) default means "point at world origin", matching editor visual.
        const worldTarget = new THREE.Vector3(
            def.lightTargetX ?? 0,
            def.lightTargetY ?? 0,
            def.lightTargetZ ?? 0,
        );

        const lightRig = new THREE.Group();
        lightRig.position.copy(position);
        lightRig.rotation.copy(rotation);

        // Apply entity scale so editor and runtime visuals match. When a
        // parent group is scaled, child local positions (like the light
        // target) must be stored in the parent's local space. We'll apply
        // the scale after computing the local target positions (below).

        let light: THREE.Light;
        switch (def.lightType) {
            case 'directional': {
                const dl = new THREE.DirectionalLight(color, intensity);
                dl.position.set(0, 0, 0);
                // Compute local target position relative to the lightRig origin.
                // The editor stores a world-space target; convert that into the
                // lightRig's local space by subtracting the rig origin and
                // applying the inverse of the rig rotation so the target
                // respects the entity's rotation in-game.
                const invQdl = lightRig.quaternion.clone().invert();
                const localDirDL = worldTarget.clone().sub(position).applyQuaternion(invQdl);
                dl.target.position.copy(localDirDL);
                lightRig.add(dl);
                lightRig.add(dl.target);
                light = dl;
                break;
            }
            case 'spot': {
                const sl = new THREE.SpotLight(color, intensity, distance);
                sl.angle = THREE.MathUtils.degToRad(def.lightAngle ?? 45);
                sl.penumbra = def.lightPenumbra ?? 0;
                sl.decay = decay;
                sl.position.set(0, 0, 0);
                // Compute local target position relative to the lightRig origin.
                // Convert editor world-space target into lightRig local space
                // so the spot direction rotates with the entity transform.
                const invQ = lightRig.quaternion.clone().invert();
                const localDir = worldTarget.clone().sub(position).applyQuaternion(invQ);
                sl.target.position.copy(localDir);
                lightRig.add(sl);
                lightRig.add(sl.target);
                light = sl;
                break;
            }
            case 'rect_area': {
                const rl = new THREE.RectAreaLight(color, intensity, def.lightRectWidth ?? 1, def.lightRectHeight ?? 1);
                rl.position.set(0, 0, 0);
                lightRig.add(rl);
                light = rl;
                break;
            }
            default: {
                const pl = new THREE.PointLight(color, intensity, distance);
                pl.decay = decay;
                pl.position.set(0, 0, 0);
                lightRig.add(pl);
                light = pl;
                break;
            }
        }

        (light as any).isRoomLight = true;

        // Shadow configuration
        if (def.castShadows && light.shadow) {
            light.castShadow = true;
            const res = def.shadowResolution ?? 1024;
            light.shadow.mapSize.width = res;
            light.shadow.mapSize.height = res;
            const cam = light.shadow.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera;
            if (cam instanceof THREE.OrthographicCamera) {
                // DirectionalLight shadow
                cam.near = 0.5;
                cam.far = 500;
                cam.left  = -20;
                cam.right =  20;
                cam.top   =  20;
                cam.bottom = -20;
                cam.updateProjectionMatrix();
            } else if (cam instanceof THREE.PerspectiveCamera) {
                // SpotLight or PointLight shadow
                cam.near = 0.5;
                cam.far = Math.max(distance * 1.5, 50);
                cam.updateProjectionMatrix();
            }
            light.shadow.bias = def.shadowBias ?? 0;
            light.shadow.normalBias = def.shadowNormalBias ?? 0.15;
            light.shadow.radius = def.shadowRadius ?? 1;
        }

        // Cookie / gobo texture
        if (def.lightCookieTexture && (def.lightType === 'spot' || def.lightType === 'directional')) {
            this.textureManager.loadTexture(def.lightCookieTexture, `/assets/${def.lightCookieTexture}`)
                .then((tex) => {
                    (light as any).map = tex;
                })
                .catch(() => {});
        }

        // Flicker: store params on light for LightFlickerSystem (future)
        if (def.flickerMode && def.flickerMode !== 'none') {
            (light as any).flickerMode = def.flickerMode;
            (light as any).flickerSpeed = def.flickerSpeed ?? 1;
            (light as any).flickerAmplitude = def.flickerAmplitude ?? 0.1;
            (light as any).flickerBaseIntensity = intensity;
            (light as any).flickerDecay = def.flickerDecay ?? 0.5;
            // Pattern stored as string in room data; parse into array for runtime use
            try {
                const pat = typeof def.flickerPattern === 'string' ? JSON.parse(def.flickerPattern) : def.flickerPattern;
                (light as any).flickerPattern = Array.isArray(pat) ? pat.map((v: any) => Number(v) ? 1 : 0) : [0,1,0,1];
            } catch (err) {
                (light as any).flickerPattern = [0,1,0,1];
            }
            // Initialize current flicker intensity
            (light as any).flickerCurrent = intensity;
        }

        this.scene.add(lightRig);

        // Mark the whole rig as room-local so unloadCurrentRoom can find and
        // remove it in a single traversal (avoids leaving orphaned helper
        // objects when only the inner light child was previously flagged).
        (lightRig as any).isRoomLight = true;

        // Now apply the entity scale (if any). We must scale the rig after
        // setting the children's local positions so that world-space target
        // positions are preserved only if the local target was computed in
        // local coordinates. Since the editor stores targetPosition as
        // world-space, we compute local target above; applying scale here
        // will make the visual cone width and arrows match the editor.
        if (def.scale) {
            lightRig.scale.set(def.scale.x, def.scale.y, def.scale.z);
            const sx = def.scale.x || 1, sy = def.scale.y || 1, sz = def.scale.z || 1;
            lightRig.traverse((c) => {
                // Adjust target objects attached to the light so their final
                // world positions match the intended worldTarget.
                if (c && (c as any).isLight && (c as any).target) {
                    const targ = (c as any).target as THREE.Object3D;
                    targ.position.set(
                        targ.position.x / sx,
                        targ.position.y / sy,
                        targ.position.z / sz
                    );
                }
            });
        }
        lightRig.updateMatrixWorld(true);

        // Register the rig with the ECS so it is tracked as a RoomMember and
        // removed during unloadCurrentRoom. We attach a MeshRenderer pointing
        // at the group so the existing teardown code removes it cleanly.
        const lightEntity = this.world.createEntity();
        this.world.addComponent(lightEntity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(lightEntity, 'Transform', {
            position: lightRig.position.clone(),
            rotation: lightRig.rotation.clone(),
            scale: lightRig.scale.clone()
        });
        this.world.addComponent(lightEntity, 'MeshRenderer', { mesh: lightRig as unknown as THREE.Object3D });
    }

    private spawnSpriteEntity(def: EntitySpawnDef, floorY: number, isPlayer: boolean, playerSpeed: number = 3.0) {
        let tex = this.textureManager.getTexture(def.spriteKey) ?? null;
        const materialKey = `sprite|${def.spriteKey}|alpha|transparent`;
        const mat = this.getMaterial(materialKey, () => new THREE.MeshStandardMaterial({
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
            map: tex ?? undefined,
            roughness: 0.8,
            metalness: 0.0,
        })) as THREE.MeshStandardMaterial;

        if (tex) {
            mat.map = tex;
        }

        // If texture isn't in the manager yet, load it asynchronously
        if (!tex && def.spriteKey) {
            const key = def.spriteKey;
            const path = key.startsWith('textures/') || key.startsWith('sprites/') 
                ? key 
                : `textures/${key}`;
            
            this.textureManager.loadTexture(key, `/assets/${path}`)
                .then(loaded => { mat.map = loaded; mat.needsUpdate = true; })
                .catch(() => {
                    const altPath = path.startsWith('textures/') 
                        ? path.replace('textures/', 'sprites/') 
                        : path.replace('sprites/', 'textures/');
                    this.textureManager.loadTexture(key, `/assets/${altPath}`)
                        .then(loaded => { mat.map = loaded; mat.needsUpdate = true; })
                        .catch(() => {});
                });
        }

        const geo = new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(geo, mat);

        if (def.rotation) {
            mesh.rotation.set(
                def.rotation.x * Math.PI / 180,
                def.rotation.y * Math.PI / 180,
                def.rotation.z * Math.PI / 180
            );
        }

        // ── Feet-first positioning ────────────────────────────────
        const feetX = def.position.x;
        const feetZ = def.position.z;
        const feetY = isPlayer ? floorY : def.position.y;
        mesh.position.set(feetX, feetY, feetZ);
        mesh.castShadow = def.castShadow ?? false;
        mesh.receiveShadow = def.receiveShadow ?? false;
        this.scene.add(mesh);

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: new THREE.Vector3(feetX, feetY, feetZ),
            rotation: mesh.rotation.clone(),
            scale: new THREE.Vector3(1, 1, 1)
        });
        
        // ── Aspect Ratio Correction ─────────────────────────────
        let spriteW = def.width;
        let spriteH = def.height;
        if (tex && tex.image && tex.image.width > 0) {
            // Only auto-correct if the image is NOT square (AI often defaults to square for non-sheet assets)
            if (tex.image.width !== tex.image.height) {
                const imgAspect = tex.image.width / tex.image.height;
                const meta = this.sheetMeta.get(def.spriteKey);
                const frameAspect = meta ? (imgAspect * (meta.rows / meta.columns)) : imgAspect;
                spriteW = def.height * frameAspect;
            }
        }

        this.world.addComponent(entity, 'MeshRenderer', { mesh });
        this.world.addComponent(entity, 'Sprite', {
            textureKey: def.spriteKey,
            frame: 0,
            baseWidth: spriteW,
            baseHeight: spriteH,
            discreteScaleOffset: 0,
            billboardMode: (def.billboardMode as Sprite['billboardMode']) ?? 'y_axis',
            // Player atlas frames (customer.png) have ~30 % empty padding below the feet.
            // feetAnchor shifts the quad up so the character's visual feet sit at floorY.
            feetAnchor: isPlayer ? 0.3 : (def.feetAnchor ?? 0),
        });

        // Obstacle tag
        if (def.isObstacle) {
            const { halfWidth, halfDepth } = this.computeObstacleExtents(def);
            this.world.addComponent(entity, 'Obstacle', { halfWidth, halfDepth });
        }

        // Sprite animation — prefer sheet metadata, fall back to per-entity columns/rows
        const meta = this.sheetMeta.get(def.spriteKey);
        const cols = meta?.columns ?? def.sheetColumns;
        const rows = meta?.rows    ?? def.sheetRows;
        if (cols && rows && tex) {
            tex.repeat.set(1 / cols, 1 / rows);
            tex.offset.set(0, 1 - 1 / rows);
            const totalFrames = meta?.totalFrames ?? (cols * rows);
            const stateFrames = meta?.stateFrames ?? { idle: { start: 0, end: totalFrames - 1 } };
            this.world.addComponent(entity, 'SpriteAnimation', {
                columns: cols,
                rows: rows,
                totalFrames,
                currentFrame: 0,
                frameRate: def.fps ?? 6,
                timeAccumulator: 0,
                state: 'idle' as const,
                stateFrames
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
     * Spawn an atlas-animated sprite (Texture Packer pixel-coordinate JSON format).
     * Atlas data (atlasFrames, imageWidth, imageHeight) must be pre-populated in `def`
     * by the preloading step in main.ts before any room is loaded.
     */
    private spawnAtlasSpriteEntity(def: EntitySpawnDef, floorY: number, isPlayer: boolean = false, playerSpeed: number = 3.0) {
        const tex = this.textureManager.getTexture(def.spriteKey) ?? undefined;

        const materialKey = `atlas|${def.spriteKey}|alpha|transparent`;
        const mat = this.getMaterial(materialKey, () => new THREE.MeshStandardMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
            roughness: 0.8,
            metalness: 0.0,
        })) as THREE.MeshStandardMaterial;
        if (tex) mat.map = tex;

        const geo  = new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(geo, mat);

        if (def.rotation) {
            mesh.rotation.set(
                def.rotation.x * Math.PI / 180,
                def.rotation.y * Math.PI / 180,
                def.rotation.z * Math.PI / 180
            );
        }

        const feetX = def.position.x;
        const feetZ = def.position.z;
        const feetY = isPlayer ? floorY : def.position.y;
        mesh.position.set(feetX, feetY, feetZ);
        mesh.castShadow = def.castShadow ?? false;
        mesh.receiveShadow = def.receiveShadow ?? false;
        this.scene.add(mesh);

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember',  { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: new THREE.Vector3(feetX, feetY, feetZ),
            rotation: mesh.rotation.clone(),
            scale:    new THREE.Vector3(1, 1, 1)
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh });

        // Derive visual size from first atlas frame's aspect ratio
        const first  = def.atlasFrames?.[0];
        const frameW = first?.w ?? 89;
        const frameH = first?.h ?? 129;
        const spriteH = def.height || 3;
        const spriteW = spriteH * (frameW / frameH);

        this.world.addComponent(entity, 'Sprite', {
            textureKey: def.spriteKey,
            frame: 0,
            baseWidth:  spriteW,
            baseHeight: spriteH,
            discreteScaleOffset: 0,
            billboardMode: (def.billboardMode as Sprite['billboardMode']) ?? 'y_axis',
            // Player atlas frames (customer.png) have ~30 % empty padding below the feet.
            // feetAnchor shifts the quad up so the character's visual feet sit at floorY.
            feetAnchor: isPlayer ? 0.3 : (def.feetAnchor ?? 0),
        });

        if (def.atlasFrames && def.imageWidth && def.imageHeight) {
            // Apply first-frame UV so the sprite isn't blank before the first tick
            if (tex && first) {
                tex.repeat.set(first.w / def.imageWidth, first.h / def.imageHeight);
                tex.offset.set(first.x / def.imageWidth, 1 - (first.y + first.h) / def.imageHeight);
                tex.needsUpdate = true;
            }

            const frameGroups = this.createAtlasFrameGroups(def.atlasFrames);
            const initialGroup = frameGroups['idle_down'] ? 'idle_down' : Object.keys(frameGroups)[0] ?? 'idle_down';
            const initialFrames = frameGroups[initialGroup]?.map(index => def.atlasFrames![index]) ?? def.atlasFrames;

            this.world.addComponent(entity, 'AtlasAnimation', {
                frames:          initialFrames,
                imageWidth:      def.imageWidth,
                imageHeight:     def.imageHeight,
                currentFrame:    0,
                frameRate:       def.fps ?? 12,
                timeAccumulator: 0,
                loop:            def.loop    ?? true,
                autoplay:        def.autoplay ?? true,
            } satisfies AtlasAnimation);

            if (isPlayer) {
                this.world.addComponent(entity, 'CharacterControl', {
                    facing: 'down',
                    action: 'idle',
                    requestedAction: null,
                    currentGroup: initialGroup,
                    frameGroups,
                    sourceFrames: def.atlasFrames
                });
            }
        }

        if (isPlayer) {
            this.world.addComponent(entity, 'Player', {
                path: [],
                speed: playerSpeed,
                isMoving: false,
                floorY: floorY,
                pendingPortalId: null
            });
        }

        if (def.isObstacle) {
            const { halfWidth, halfDepth } = this.computeObstacleExtents(def);
            this.world.addComponent(entity, 'Obstacle', { halfWidth, halfDepth });
        }
    }

    private createAtlasFrameGroups(frames: Array<{ x: number; y: number; w: number; h: number; filename?: string }>) {
        const groups: Record<string, Array<{ index: number; order: number }>> = {};
        for (let index = 0; index < frames.length; index++) {
            const filename = frames[index].filename ?? '';
            const match = filename.match(/^(?<action>[a-zA-Z0-9]+)_(?<direction>down|up|left|right)-(\d+)\.png$/i);
            if (!match || !match.groups) continue;
            const action = match.groups.action.toLowerCase();
            const direction = match.groups.direction.toLowerCase();
            const groupKey = `${action}_${direction}`;
            const order = Number(match[3] ?? index);
            groups[groupKey] = groups[groupKey] || [];
            groups[groupKey].push({ index, order });
        }

        const sortedGroups: Record<string, number[]> = {};
        for (const [key, values] of Object.entries(groups)) {
            sortedGroups[key] = values.sort((a, b) => a.order - b.order).map(v => v.index);
        }

        return sortedGroups;
    }

    /**
     * Spawn a sound entity as an HTMLAudioElement attached to the page.
     * Audio is stopped and removed when the room is unloaded.
     */
    private spawnSoundEntity(def: EntitySpawnDef) {
        if (!def.audioSource) return;
        const audio = document.createElement('audio');
        audio.src    = `/assets/audio/${def.audioSource}`;
        audio.loop   = def.loop   ?? true;
        audio.volume = Math.min(1, Math.max(0, def.volume ?? 1));
        (audio as any).isRoomAudio = true;
        document.body.appendChild(audio);
        audio.play().catch(() => {}); // Autoplay may be blocked until user interaction
        this.roomAudioElements.push(audio);
    }

    /**
     * Spawn a 3D door entity from the editor's door entity type.
     * Creates a 3D box instead of a flat plane.
     */
    private spawnDoorEntity3D(def: EntitySpawnDef, floorY: number) {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const texturePathValue = def.sequenceSource || def.textureSource;
        const materialKey = `door|${texturePathValue || def.color || '#6B4423'}|opacity:${def.opacity ?? 1}|tiling:${def.uvTilingX ?? 1},${def.uvTilingY ?? 1}|offset:${def.uvOffsetX ?? 0},${def.uvOffsetY ?? 0}`;
        const mat = this.getMaterial(materialKey, () => {
            const params: THREE.MeshStandardMaterialParameters = {
                color: new THREE.Color(def.color || '#6B4423'),
                transparent: (def.opacity ?? 1) < 1,
                opacity: def.opacity ?? 1,
                roughness: 0.7,
                metalness: 0.1,
                side: THREE.DoubleSide,
                shadowSide: THREE.FrontSide,
            };

            if (texturePathValue) {
                const loader = new THREE.TextureLoader();
                const path = texturePathValue.startsWith('textures/') || texturePathValue.startsWith('sprites/')
                    ? texturePathValue
                    : (def.sequenceSource ? `sprites/${texturePathValue}` : `textures/${texturePathValue}`);
                const tex = loader.load(`/assets/${path}`);
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                if (def.atlasFrames && def.imageWidth && def.imageHeight && def.atlasFrames.length > 0) {
                    const firstFrame = def.atlasFrames[0];
                    tex.repeat.set(firstFrame.w / def.imageWidth, firstFrame.h / def.imageHeight);
                    tex.offset.set(firstFrame.x / def.imageWidth, 1 - (firstFrame.y + firstFrame.h) / def.imageHeight);
                } else {
                    if (def.uvTilingX || def.uvTilingY) {
                        tex.repeat.set(def.uvTilingX || 1, def.uvTilingY || 1);
                    }
                    if (def.uvOffsetX || def.uvOffsetY) {
                        tex.offset.set(def.uvOffsetX || 0, def.uvOffsetY || 0);
                    }
                }
                params.map = tex;
                params.color = new THREE.Color(0xffffff);
            }

            return new THREE.MeshStandardMaterial(params);
        }) as THREE.MeshStandardMaterial;
        const mesh = new THREE.Mesh(geo, mat);

        const sx = def.scale?.x ?? 1.2;
        const sy = def.scale?.y ?? 2.5;
        const sz = def.scale?.z ?? 0.35;
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(
            def.position.x,
            def.position.y !== undefined ? def.position.y + sy / 2 : floorY + sy / 2,
            def.position.z
        );

        if (def.rotation) {
            mesh.rotation.set(
                def.rotation.x * Math.PI / 180,
                def.rotation.y * Math.PI / 180,
                def.rotation.z * Math.PI / 180
            );
        }

        // Shadow
        mesh.castShadow = def.castShadow ?? false;
        mesh.receiveShadow = def.receiveShadow ?? true;

        this.scene.add(mesh);

        if (def.isObstacle && def.position.y <= CHARACTER_HEIGHT) {
            this.createCollisionWireframe(def, floorY);
        }

        const entity = this.world.createEntity();
        this.world.addComponent(entity, 'RoomMember', { roomId: this.currentRoomId! });
        this.world.addComponent(entity, 'Transform', {
            position: mesh.position.clone(),
            rotation: mesh.rotation.clone(),
            scale: mesh.scale.clone()
        });
        this.world.addComponent(entity, 'MeshRenderer', { mesh });

        if (def.isObstacle) {
            this.createCollisionWireframe(def, floorY);
        }

        this.world.addComponent(entity, 'DoorMarker', {
            portalId: def.portalId || '',
            targetRoom: def.targetRoomId || '',
            targetSpawnId: def.targetSpawnId || '',
            interactionState: def.interactionState || 'open'
        });

        if (def.atlasFrames && def.imageWidth && def.imageHeight && def.atlasFrames.length > 0) {
            this.world.addComponent(entity, 'AtlasAnimation', {
                frames: def.atlasFrames,
                imageWidth: def.imageWidth,
                imageHeight: def.imageHeight,
                currentFrame: 0,
                frameRate: def.fps ?? 12,
                timeAccumulator: 0,
                loop: def.loop ?? true,
                autoplay: def.autoplay ?? true,
            } satisfies AtlasAnimation);
        }
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
            fov: camDef.fov || 45,
            sourceId: camDef.id || ''
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

        // Stop and remove all room audio
        for (const audio of this.roomAudioElements) {
            audio.pause();
            audio.src = '';
            if (audio.parentNode) audio.parentNode.removeChild(audio);
        }
        this.roomAudioElements = [];

        this.currentRoomId = null;
    }
}
