/* ═══════════════════════════════════════════════════════════════════════
   WorldLoader — parses WorldProject JSON and returns engine-ready RoomData[]
   ═══════════════════════════════════════════════════════════════════════ */

import type { WorldProject } from '@heel-quest/shared-core';
import type { RoomData, EntitySpawnDef, CameraDef } from '../engine/rooms/RoomData';
import type { TextureManager } from '../engine/rendering/TextureManager';
import { normalizeAssetPath } from '@heel-quest/shared-core';
import type { SpriteSheetMeta } from '@heel-quest/shared-core';

export interface WorldLoadResult {
    rooms: RoomData[];
    initialRoomId: string | null;
    sheetMeta: Map<string, SpriteSheetMeta>;
}

export class WorldLoader {

    /**
     * Load and map a WorldProject JSON into engine-ready RoomData[],
     * preloading all textures and atlas JSONs along the way.
     */
    static async load(worldData: WorldProject, tm: TextureManager): Promise<WorldLoadResult> {
        console.log(`Loaded World Project: ${worldData.projectId} with ${worldData.rooms.length} rooms`);

        const mappedRooms = worldData.rooms.map(r => {
            const legacyCam = WorldLoader.extractLegacyCamera(r.entities);
            const spawnChar = WorldLoader.extractSpawnCharacter(r.entities);
            return {
                id: r.id,
                name: r.name,
                ambientColor: r.ambientColor || '#ffffff',
                walkPadding: 0.5,
                spawnPoints: r.spawnPoints,
                outline: WorldLoader.expandOutline(r.outline, r.cornerRadii),
                entities: r.entities
                    .filter((e): e is typeof e =>
                        e.type === 'sprite' || e.type === 'animated_sprite' ||
                        e.type === 'primitive' || e.type === 'light' ||
                        e.type === 'door' || e.type === 'sound' || e.type === 'trigger'
                    )
                    .map((e): EntitySpawnDef => WorldLoader.mapEntity(e)),
                boundaries: {
                    floor: {
                        width: 100, depth: 100,
                        texture: 'floor_default',
                        position: { x: 0, y: 0, z: 0 }
                    },
                    walls: []
                },
                portals: WorldLoader.mapPortals(r.id, worldData.doors),
                cameras: WorldLoader.extractCameras(r.entities),
                cameraPosition: legacyCam.position,
                cameraRotation: legacyCam.rotation,
                cameraFov: legacyCam.fov,
                cameraNear: legacyCam.near,
                cameraFar: legacyCam.far,
                characterSpeed: spawnChar.characterSpeed,
                characterAsset: spawnChar.characterAsset,
                characterSequenceSource: spawnChar.characterSequenceSource,
                characterSequenceJson: spawnChar.characterSequenceJson,
                characterSequenceFps: spawnChar.characterSequenceFps,
                characterSequenceLoop: spawnChar.characterSequenceLoop,
                characterSequenceAutoplay: spawnChar.characterSequenceAutoplay,
                characterCastShadow: spawnChar.characterCastShadow,
                characterReceiveShadow: spawnChar.characterReceiveShadow,
            } as RoomData;
        });

        // ── Preload textures, atlas JSONs, and sheet metadata ──────
        const sheetMeta = await WorldLoader.preloadAssets(mappedRooms, tm);

        // Determine initial room
        const spawnRoom = worldData.rooms.find(r => Array.isArray(r.spawnPoints) && r.spawnPoints.length > 0);
        const initialRoomId = spawnRoom?.id || worldData.rooms[0]?.id || null;

        return { rooms: mappedRooms, initialRoomId, sheetMeta };
    }

    // ── Entity Mapping ──────────────────────────────────────────────

    private static mapEntity(e: any): EntitySpawnDef {
        const result: EntitySpawnDef = {
            entityType: e.type,
            spriteKey: '',
            width: e.transform.scale.x,
            height: e.transform.scale.y,
            position: e.transform.position,
            rotation: e.transform.rotation,
            scale: e.transform.scale,
            isObstacle: false
        };

        if (e.type === 'primitive') {
            result.geometryType = e.geometryType || 'cube';
            result.color = e.color || '#808080';
            result.opacity = e.opacity ?? 1;
            result.isObstacle = e.isCollider ?? false;
            result.textureSource = normalizeAssetPath(e.textureSource || '');
            result.sequenceSource = normalizeAssetPath(e.sequenceSource || '');
            result.sequenceJson = normalizeAssetPath(e.sequenceJson || '');
            result.fps = e.playbackSpeed ?? 12;
            result.loop = e.sequenceLoop ?? true;
            result.autoplay = e.sequenceAutoplay ?? true;
            result.uvTilingX = e.uvTilingX ?? 1;
            result.uvTilingY = e.uvTilingY ?? 1;
            result.uvOffsetX = e.uvOffsetX ?? 0;
            result.uvOffsetY = e.uvOffsetY ?? 0;
            result.castShadow = e.castShadows ?? false;
            result.receiveShadow = e.receiveShadows ?? true;
        } else if (e.type === 'light') {
            result.lightType = e.lightType || 'point';
            result.lightColor = e.color || '#ffffff';
            result.lightIntensity = e.intensity ?? 1;
            result.lightDistance = e.distance ?? 10;
            result.castShadows = e.castShadows ?? false;
        } else if (e.type === 'door') {
            result.targetRoomId = e.targetRoomId || '';
            result.targetSpawnId = e.targetSpawnId || '';
            result.interactionState = e.interactionState || 'closed';
            result.color = e.color || '#8B4513';
            result.opacity = e.opacity ?? 1;
            result.textureSource = normalizeAssetPath(e.textureSource || '');
            result.sequenceSource = normalizeAssetPath(e.sequenceSource || '');
            result.sequenceJson = normalizeAssetPath(e.sequenceJson || '');
            result.fps = e.playbackSpeed ?? 12;
            result.loop = e.sequenceLoop ?? true;
            result.autoplay = e.sequenceAutoplay ?? true;
            result.uvTilingX = e.uvTilingX ?? 1;
            result.uvTilingY = e.uvTilingY ?? 1;
            result.uvOffsetX = e.uvOffsetX ?? 0;
            result.uvOffsetY = e.uvOffsetY ?? 0;
            result.isObstacle = true;
            result.castShadow = e.castShadow ?? false;
            result.receiveShadow = e.receiveShadow ?? true;
            result.portalId = e.worldDoorId || '';
        } else if (e.type === 'animated_sprite') {
            result.spriteKey = e.textureSource || '';
            result.sequenceJson = e.textureSource ? `${e.textureSource}.json` : '';
            result.sequenceSource = e.textureSource || '';
            result.fps = e.fps ?? 12;
            result.loop = e.loop ?? true;
            result.autoplay = e.autoplay ?? true;
            result.sheetColumns = e.columns ?? 1;
            result.sheetRows = e.rows ?? 1;
            result.castShadow = e.castShadows ?? false;
            result.receiveShadow = e.receiveShadows ?? false;
        } else if (e.type === 'sound') {
            result.audioSource = e.audioSource || e.src || '';
            result.volume = e.volume ?? 1;
            result.loop = e.loop ?? true;
            result.spatialAudio = e.spatialAudio ?? false;
        } else if (e.type === 'trigger') {
            result.triggerShape = e.shape || 'box';
            result.onEnterEvent = e.onEnterEvent || '';
            result.onLeaveEvent = e.onLeaveEvent || '';
            result.triggerOnce = e.triggerOnce ?? false;
            result.triggerExtents = e.extents ?? { x: 2, y: 2, z: 2 };
            result.conditionType = e.conditionType || 'always';
            result.conditionValue = e.conditionValue || '';
            result.targetEntityIds = e.targetEntityIds ?? [];
            result.payload = e.payload || '';
        } else {
            result.spriteKey = e.textureSource || e.spriteKey || '';
            result.castShadow = e.castShadows ?? false;
            result.receiveShadow = e.receiveShadows ?? false;
        }

        return result;
    }

    // ── Camera Extraction ───────────────────────────────────────────

    private static extractCameras(entities: any[]): CameraDef[] {
        const cams = entities.filter((e: any) => e.type === 'camera');
        return cams.map((cam: any, i: number) => ({
            id: cam.id || `camera_${i}`,
            position: cam.transform.position,
            rotation: {
                x: cam.transform.rotation.x * Math.PI / 180,
                y: cam.transform.rotation.y * Math.PI / 180,
                z: cam.transform.rotation.z * Math.PI / 180
            },
            fov: cam.fov || 45,
            near: cam.near || 0.1,
            far: cam.far || 100,
            isDefault: cam.isDefault ?? (i === 0),
            targetLookAt: cam.lookAtTarget || ''
        }));
    }

    private static extractLegacyCamera(entities: any[]) {
        const cam = entities.find((e: any) => e.type === 'camera');
        if (cam) return {
            position: cam.transform.position,
            rotation: {
                x: cam.transform.rotation.x * Math.PI / 180,
                y: cam.transform.rotation.y * Math.PI / 180,
                z: cam.transform.rotation.z * Math.PI / 180
            },
            fov: cam.fov || 45,
            near: cam.near || 0.1,
            far: cam.far || 100
        };
        return {
            position: { x: -8, y: 10, z: 12 },
            rotation: { x: -35 * Math.PI / 180, y: 35 * Math.PI / 180, z: 0 },
            fov: 45,
            near: 0.1,
            far: 100
        };
    }

    // ── Spawn / Character Extraction ────────────────────────────────

    private static extractSpawnCharacter(entities: any[]) {
        const spawn = entities.find((e: any) => e.type === 'spawn');
        return {
            characterSpeed: spawn?.characterSpeed,
            characterAsset: spawn?.characterAsset,
            characterSequenceSource: normalizeAssetPath(spawn?.characterSequenceSource || ''),
            characterSequenceJson: normalizeAssetPath(spawn?.characterSequenceJson || ''),
            characterSequenceFps: spawn?.characterSequenceFps ?? 12,
            characterSequenceLoop: spawn?.characterSequenceLoop ?? true,
            characterSequenceAutoplay: spawn?.characterSequenceAutoplay ?? true,
            characterCastShadow: spawn?.characterCastShadow ?? false,
            characterReceiveShadow: spawn?.characterReceiveShadow ?? false,
        };
    }

    // ── Portal Mapping ──────────────────────────────────────────────

    private static mapPortals(roomId: string, doors: any[]) {
        const portals: any[] = [];
        for (const door of doors) {
            if (door.room1Id === roomId && door.room2Id) {
                portals.push({
                    id: door.id,
                    targetRoom: door.room2Id,
                    targetSpawnId: undefined,
                    position: { x: (door.points[0].x + door.points[1].x) / 2, y: 0, z: (door.points[0].y + door.points[1].y) / 2 },
                    boundary: { width: door.width * 2, height: 3, depth: door.width * 2 }
                });
            } else if (door.room2Id === roomId && door.room1Id) {
                portals.push({
                    id: door.id,
                    targetRoom: door.room1Id,
                    targetSpawnId: undefined,
                    position: { x: (door.points[0].x + door.points[1].x) / 2, y: 0, z: (door.points[0].y + door.points[1].y) / 2 },
                    boundary: { width: door.width * 2, height: 3, depth: door.width * 2 }
                });
            }
        }
        return portals;
    }

    // ── Outline Expansion (corner rounding) ─────────────────────────

    private static expandOutline(outline: { x: number; y: number }[], radii?: number[]): { x: number; y: number }[] {
        const n = outline.length;
        if (!radii || radii.every(r => r <= 0) || n < 3) return outline;
        const result: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
            const r = radii[i] ?? 0;
            if (r <= 0.001) { result.push(outline[i]); continue; }
            const prev = outline[(i - 1 + n) % n];
            const curr = outline[i];
            const next = outline[(i + 1) % n];
            const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
            const toNext = { x: next.x - curr.x, y: next.y - curr.y };
            const lenPrev = Math.sqrt(toPrev.x ** 2 + toPrev.y ** 2);
            const lenNext = Math.sqrt(toNext.x ** 2 + toNext.y ** 2);
            if (lenPrev < 0.001 || lenNext < 0.001) { result.push(curr); continue; }
            const uPrev = { x: toPrev.x / lenPrev, y: toPrev.y / lenPrev };
            const uNext = { x: toNext.x / lenNext, y: toNext.y / lenNext };
            const maxR = Math.min(r, lenPrev * 0.45, lenNext * 0.45);
            if (maxR < 0.01) { result.push(curr); continue; }
            const t1 = { x: curr.x + uPrev.x * maxR, y: curr.y + uPrev.y * maxR };
            const t2 = { x: curr.x + uNext.x * maxR, y: curr.y + uNext.y * maxR };
            const STEPS = 16;
            result.push(t1);
            for (let s = 1; s < STEPS; s++) {
                const tt = s / STEPS;
                result.push({
                    x: (1 - tt) ** 2 * t1.x + 2 * (1 - tt) * tt * curr.x + tt ** 2 * t2.x,
                    y: (1 - tt) ** 2 * t1.y + 2 * (1 - tt) * tt * curr.y + tt ** 2 * t2.y,
                });
            }
            result.push(t2);
        }
        return result;
    }

    // ── Asset Preloading ────────────────────────────────────────────

    private static async preloadAssets(rooms: RoomData[], tm: TextureManager): Promise<Map<string, SpriteSheetMeta>> {
        const preloads: Promise<void>[] = [];
        const loadedKeys = new Set<string>();
        const sheetMeta = new Map<string, SpriteSheetMeta>();

        for (const room of rooms) {
            // Character sequence texture
            if (room.characterSequenceSource) {
                const seqKey = room.characterSequenceSource;
                if (seqKey && !loadedKeys.has(seqKey)) {
                    loadedKeys.add(seqKey);
                    preloads.push(WorldLoader.loadTextureWithFallback(tm, seqKey));
                }
            }

            // Character sequence atlas JSON
            if (room.characterSequenceJson) {
                preloads.push(WorldLoader.loadCharacterAtlas(room, tm, loadedKeys));
            }

            // Entity assets
            for (const e of room.entities) {
                if (e.sequenceSource) {
                    const seqKey = e.sequenceSource;
                    if (seqKey && !loadedKeys.has(seqKey)) {
                        loadedKeys.add(seqKey);
                        preloads.push(WorldLoader.loadTextureWithFallback(tm, seqKey));
                    }
                }

                if (e.sequenceJson) {
                    preloads.push(WorldLoader.loadEntityAtlas(e, tm, loadedKeys));
                }

                if (e.textureSource && e.entityType !== 'sound' && !e.sequenceSource) {
                    const key = e.spriteKey || e.textureSource;
                    if (key && !loadedKeys.has(key)) {
                        loadedKeys.add(key);
                        preloads.push(WorldLoader.loadTextureWithFallback(tm, key, e.textureSource));
                    }
                }

                // Try loading sheet metadata for sprite keys
                if (e.spriteKey && !sheetMeta.has(e.spriteKey)) {
                    preloads.push(
                        WorldLoader.loadSheetMeta(e.spriteKey, sheetMeta)
                    );
                }
            }

            // Try loading sheet metadata for character asset
            const charKey = room.characterSequenceSource || room.characterAsset;
            if (charKey && !sheetMeta.has(charKey)) {
                preloads.push(WorldLoader.loadSheetMeta(charKey, sheetMeta));
            }
        }

        await Promise.all(preloads);
        return sheetMeta;
    }

    private static async loadTextureWithFallback(tm: TextureManager, key: string, source?: string): Promise<void> {
        const src = source || key;
        const path = src.startsWith('textures/') || src.startsWith('sprites/')
            ? src
            : `sprites/${src}`;
        try {
            await tm.loadTexture(key, `/assets/${path}`);
        } catch {
            const altPath = path.startsWith('sprites/')
                ? path.replace('sprites/', 'textures/')
                : path.replace('textures/', 'sprites/');
            try { await tm.loadTexture(key, `/assets/${altPath}`); } catch { /* best effort */ }
        }
    }

    private static async loadCharacterAtlas(room: RoomData, tm: TextureManager, loadedKeys: Set<string>): Promise<void> {
        const jsonPath = room.characterSequenceJson!.startsWith('sprites/') || room.characterSequenceJson!.startsWith('textures/')
            ? room.characterSequenceJson!
            : `sprites/${room.characterSequenceJson}`;
        const jsonUrl = `/assets/${jsonPath}`;
        try {
            const resp = await fetch(jsonUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const atlas = await resp.json();
            console.log(`Successfully parsed player atlas JSON: ${jsonPath}`);
            room.characterSequenceFrames = atlas.frames.map((f: any) => f.frame as { x: number; y: number; w: number; h: number });
            room.characterSequenceImageWidth = atlas.meta.size.w;
            room.characterSequenceImageHeight = atlas.meta.size.h;
            const imgName = atlas.meta.image as string;
            if (!room.characterSequenceSource) {
                room.characterSequenceSource = imgName;
            }
            room.characterAsset = room.characterSequenceSource || room.characterAsset || imgName;
            const texKey = room.characterSequenceSource || room.characterAsset || imgName;
            if (!loadedKeys.has(texKey)) {
                loadedKeys.add(texKey);
                const imgPath = imgName.startsWith('sprites/') || imgName.startsWith('textures/')
                    ? imgName
                    : `sprites/${imgName}`;
                try { await tm.loadTexture(texKey, `/assets/${imgPath}`); } catch { /* best effort */ }
            }
        } catch (err) {
            console.error(`Failed to preload player atlas JSON: ${jsonUrl}`, err);
        }
    }

    private static async loadEntityAtlas(e: EntitySpawnDef, tm: TextureManager, loadedKeys: Set<string>): Promise<void> {
        const jsonPath = e.sequenceJson!.startsWith('sprites/') || e.sequenceJson!.startsWith('textures/')
            ? e.sequenceJson!
            : `sprites/${e.sequenceJson}`;
        const jsonUrl = `/assets/${jsonPath}`;
        try {
            const resp = await fetch(jsonUrl);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const atlas = await resp.json();
            console.log(`Successfully parsed atlas JSON: ${jsonPath}`);
            e.atlasFrames = atlas.frames.map((f: any) => f.frame as { x: number; y: number; w: number; h: number });
            e.imageWidth = atlas.meta.size.w;
            e.imageHeight = atlas.meta.size.h;
            const imgName = atlas.meta.image as string;
            if (!e.sequenceSource) {
                e.sequenceSource = imgName;
            }
            const texKey = e.sequenceSource || e.spriteKey || imgName;
            e.spriteKey = texKey;
            if (!loadedKeys.has(texKey)) {
                loadedKeys.add(texKey);
                const imgPath = imgName.startsWith('sprites/') || imgName.startsWith('textures/')
                    ? imgName
                    : `sprites/${imgName}`;
                try { await tm.loadTexture(texKey, `/assets/${imgPath}`); } catch { /* best effort */ }
            }
        } catch (err) {
            console.error(`Failed to preload atlas JSON: ${jsonUrl}`, err);
        }
    }

    /**
     * Attempt to load a .sheet.json sidecar for a given sprite key.
     * Sheet metadata is stored in assets/sprites/{key}.sheet.json.
     */
    private static async loadSheetMeta(spriteKey: string, target: Map<string, SpriteSheetMeta>): Promise<void> {
        const url = `/assets/sprites/${spriteKey}.sheet.json`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) return; // No sidecar — that's fine
            const meta = await resp.json() as SpriteSheetMeta;
            if (meta.columns && meta.rows && meta.totalFrames) {
                target.set(spriteKey, meta);
            }
        } catch {
            // No sheet metadata available — not an error
        }
    }
}
