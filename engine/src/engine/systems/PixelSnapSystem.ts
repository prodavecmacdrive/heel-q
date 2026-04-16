import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { PIXEL_RATIO } from '../constants';
import { Transform, MeshRenderer } from '../ecs/Component';

/**
 * PixelSnapSystem — Snaps visual mesh positions to the virtual pixel grid.
 *
 * For sprite entities, only X and Z are snapped (Y is managed by SpriteSystem's
 * feet-first offset).  Scale and rotation are also left to SpriteSystem.
 * For non-sprite entities (walls, floor), everything is synced.
 */
export class PixelSnapSystem extends System {
    constructor(world: World) {
        super(world);
    }

    update(_dt: number) {
        const entities = this.world.queryEntities(['Transform', 'MeshRenderer']);

        for (const entity of entities) {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const renderer = this.world.getComponent(entity, 'MeshRenderer') as MeshRenderer;
            const isSprite = this.world.hasComponent(entity, 'Sprite');

            if (isSprite) {
                // Sprites: snap X and Z only; Y set by SpriteSystem
                const snappedX = Math.round(transform.position.x * PIXEL_RATIO) / PIXEL_RATIO;
                const snappedZ = Math.round(transform.position.z * PIXEL_RATIO) / PIXEL_RATIO;
                renderer.mesh.position.x = snappedX;
                renderer.mesh.position.z = snappedZ;
                // Y is already set by SpriteSystem — snap it too
                renderer.mesh.position.y = Math.round(renderer.mesh.position.y * PIXEL_RATIO) / PIXEL_RATIO;
            } else {
                // Non-sprites: full sync
                const snappedX = Math.round(transform.position.x * PIXEL_RATIO) / PIXEL_RATIO;
                const snappedY = Math.round(transform.position.y * PIXEL_RATIO) / PIXEL_RATIO;
                const snappedZ = Math.round(transform.position.z * PIXEL_RATIO) / PIXEL_RATIO;
                renderer.mesh.position.set(snappedX, snappedY, snappedZ);
                renderer.mesh.rotation.copy(transform.rotation);
                renderer.mesh.scale.copy(transform.scale);
            }
        }
    }
}
