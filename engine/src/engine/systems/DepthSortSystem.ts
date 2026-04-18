import { System } from '../ecs/System';
import { World } from '../ecs/World';
import { Transform, MeshRenderer, Sprite } from '../ecs/Component';
import { DEPTH_SORT_SCALE } from '../constants';

/**
 * DepthSortSystem — strict 2.5D Z-based draw ordering.
 *
 * For every sprite entity, renderOrder is set proportional to the feet Z
 * coordinate (Transform.position.z, which IS the feet position in Phase 3).
 * Objects closer to the camera (higher Z) get higher renderOrder and
 * render on top.  depthTest is disabled on sprite materials to prevent
 * Z-buffer fighting with the 3D boundary geometry.
 */
export class DepthSortSystem extends System {

    constructor(world: World) {
        super(world);
    }

    update(_dt: number) {
        const entities = this.world.queryEntities(['Transform', 'Sprite', 'MeshRenderer']);

        for (const entity of entities) {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const mr = this.world.getComponent(entity, 'MeshRenderer') as MeshRenderer;

            // Feet Z → renderOrder.  Higher Z = closer to camera = on top.
            const feetZ = transform.position.z;
            mr.mesh.renderOrder = Math.round(feetZ * DEPTH_SORT_SCALE);
        }
    }
}
