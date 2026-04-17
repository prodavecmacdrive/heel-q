import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { SpriteAnimation, AtlasAnimation, MeshRenderer } from '../ecs/Component';
import * as THREE from 'three';

/**
 * AnimationSystem — ticks sprite-sheet frame counters and sets UV offsets.
 *
 * Handles two animation formats:
 *  1. SpriteAnimation – uniform row/column grid (legacy character sheets).
 *  2. AtlasAnimation  – Texture Packer pixel-coordinate frames (free-tex-packer JSON).
 */
export class AnimationSystem extends System {
    constructor(world: World) {
        super(world);
    }

    update(dt: number) {
        // ── 1. Uniform-grid sprite sheets ─────────────────────────────────────
        const entities = this.world.queryEntities(['SpriteAnimation', 'MeshRenderer']);

        for (const entity of entities) {
            const anim = this.world.getComponent(entity, 'SpriteAnimation') as SpriteAnimation;
            const mr = this.world.getComponent(entity, 'MeshRenderer') as MeshRenderer;

            // Determine frame range from current state
            const range = anim.stateFrames[anim.state];
            if (!range) continue;

            // Tick accumulator
            anim.timeAccumulator += dt;
            const frameDuration = 1 / anim.frameRate;

            if (anim.timeAccumulator >= frameDuration) {
                anim.timeAccumulator -= frameDuration;
                anim.currentFrame++;

                // Wrap within state range
                if (anim.currentFrame > range.end) {
                    anim.currentFrame = range.start;
                }
            }

            // Clamp frame into range (handles state changes mid-cycle)
            if (anim.currentFrame < range.start || anim.currentFrame > range.end) {
                anim.currentFrame = range.start;
                anim.timeAccumulator = 0;
            }

            // Update texture UV offset
            const mesh = mr.mesh as THREE.Mesh;
            const mat = mesh.material as THREE.MeshBasicMaterial;
            if (mat.map) {
                const col = anim.currentFrame % anim.columns;
                // Row 0 = top of image.  Three.js UV origin is bottom-left,
                // so we flip: row 0 maps to offset.y = 1 - (1/rows).
                const row = Math.floor(anim.currentFrame / anim.columns);

                mat.map.repeat.set(1 / anim.columns, 1 / anim.rows);
                mat.map.offset.x = col / anim.columns;
                mat.map.offset.y = 1 - (row + 1) / anim.rows;
            }
        }

        // ── 2. Texture Packer atlas (pixel-coordinate frames) ─────────────────
        const atlasEntities = this.world.queryEntities(['AtlasAnimation', 'MeshRenderer']);

        for (const entity of atlasEntities) {
            const anim = this.world.getComponent(entity, 'AtlasAnimation') as AtlasAnimation;
            const mr  = this.world.getComponent(entity, 'MeshRenderer') as MeshRenderer;

            if (!anim.autoplay || anim.frames.length === 0) continue;

            anim.timeAccumulator += dt;
            const frameDuration = 1 / anim.frameRate;
            if (anim.timeAccumulator >= frameDuration) {
                anim.timeAccumulator -= frameDuration;
                anim.currentFrame++;
                if (anim.currentFrame >= anim.frames.length) {
                    anim.currentFrame = anim.loop ? 0 : anim.frames.length - 1;
                }
            }

            const frame = anim.frames[anim.currentFrame];
            if (!frame) continue;

            const mesh = mr.mesh as THREE.Mesh;
            const mat  = mesh.material as THREE.MeshBasicMaterial;
            if (mat.map) {
                // Ensure the map is using high-res coordinates
                mat.map.matrixAutoUpdate = false;
                mat.map.repeat.set(frame.w / anim.imageWidth, frame.h / anim.imageHeight);
                mat.map.offset.set(
                    frame.x / anim.imageWidth,
                    1 - (frame.y + frame.h) / anim.imageHeight
                );
                mat.map.updateMatrix();
                mat.map.needsUpdate = true;
                mat.needsUpdate = true;
            }
        }
    }
}
