import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { SpriteAnimation, MeshRenderer } from '../ecs/Component';
import * as THREE from 'three';

/**
 * AnimationSystem — ticks sprite-sheet frame counters and sets UV offsets.
 *
 * Each entity with SpriteAnimation + MeshRenderer has its texture offset
 * updated every frame to show the correct atlas cell.
 */
export class AnimationSystem extends System {
    constructor(world: World) {
        super(world);
    }

    update(dt: number) {
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
    }
}
