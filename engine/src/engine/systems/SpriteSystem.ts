import { System } from '../ecs/System';
import { World } from '../ecs/World';
import * as THREE from 'three';
import { MeshRenderer, Sprite, Transform } from '../ecs/Component';

/**
 * SpriteSystem — Y-axis (cylindrical) billboarding + discrete scaling + feet-first Y offset.
 *
 * Transform.position is the FEET position on the floor.
 * This system:
 *   1. Rotates the mesh around world-Y only so the sprite faces the camera horizontally
 *      while keeping itself perfectly vertical — feet always on the floor regardless
 *      of camera tilt or elevation.
 *   2. Computes discrete scale step from camera distance.
 *   3. Offsets the mesh Y upward by half the SCALED height so the sprite's bottom
 *      edge sits at the feet position.
 */
export class SpriteSystem extends System {
    private camera: THREE.Camera;
    private _yAxis = new THREE.Vector3(0, 1, 0);

    constructor(world: World, camera: THREE.Camera) {
        super(world);
        this.camera = camera;
    }

    update(_dt: number) {
        const entities = this.world.queryEntities(['Transform', 'Sprite', 'MeshRenderer']);

        for (const entity of entities) {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const renderer = this.world.getComponent(entity, 'MeshRenderer') as MeshRenderer;
            const sprite = this.world.getComponent(entity, 'Sprite') as Sprite;

            // 1. Y-axis cylindrical billboarding: rotate around world-Y only so the
            //    sprite always stands upright regardless of camera elevation.
            const dx = this.camera.position.x - transform.position.x;
            const dz = this.camera.position.z - transform.position.z;
            const angle = Math.atan2(dx, dz);
            renderer.mesh.quaternion.setFromAxisAngle(this._yAxis, angle);

            // 2. Discrete scaling logic (Linear Perspective Normalization)
            const cameraZ = this.camera.position.z;
            const objectZ = transform.position.z;
            const zDistance = Math.abs(cameraZ - objectZ);
            const distanceFactor = Math.max(0, Math.min(1, zDistance / 20));

            const maxScale = 1.0;
            const minScale = 0.65;
            let rawScale = maxScale + (minScale - maxScale) * distanceFactor;
            rawScale += sprite.discreteScaleOffset || 0;

            const stepSize = 0.05;
            let bestStep = Math.round(rawScale / stepSize) * stepSize;
            bestStep = Math.max(minScale, Math.min(maxScale + (sprite.discreteScaleOffset || 0), bestStep));

            const scaledW = sprite.baseWidth * bestStep;
            const scaledH = sprite.baseHeight * bestStep;

            renderer.mesh.scale.set(scaledW, scaledH, 1);

            // 3. Feet-first offset: shift mesh so the bottom edge sits slightly
            //    below the floor, giving the sprite a more grounded look.
            const floorSink = 0.7;
            (renderer.mesh as THREE.Mesh).position.y = transform.position.y + scaledH / 2 - floorSink;
        }
    }
}
