import { System } from '../ecs/System';
import { World } from '../ecs/World';
import * as THREE from 'three';
import {
    Transform,
    Player,
    CharacterControl,
    SpriteAnimation,
    AtlasAnimation,
} from '../ecs/Component';

const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type FacingDirection = typeof DIRECTIONS[number];

export class CharacterControlSystem extends System {
    private camera: THREE.Camera;

    constructor(world: World, camera: THREE.Camera) {
        super(world);
        this.camera = camera;
    }

    update(dt: number) {
        const entities = this.world.queryEntities(['Player', 'Transform', 'CharacterControl']);

        for (const entity of entities) {
            const transform = this.world.getComponent(entity, 'Transform') as Transform;
            const player = this.world.getComponent(entity, 'Player') as Player;
            const control = this.world.getComponent(entity, 'CharacterControl') as CharacterControl;
            const spriteAnim = this.world.getComponent(entity, 'SpriteAnimation') as SpriteAnimation | undefined;
            const atlasAnim = this.world.getComponent(entity, 'AtlasAnimation') as AtlasAnimation | undefined;

            const facing = this.computeFacing(player, transform, control.facing);
            const action = this.computeAction(player, control);
            const group = this.resolveGroup(control, action, facing);

            if (control.facing !== facing || control.action !== action || control.currentGroup !== group) {
                control.facing = facing;
                control.action = action;
                control.currentGroup = group;

                if (atlasAnim && control.frameGroups[group]?.length) {
                    atlasAnim.frames = control.frameGroups[group].map(index => control.sourceFrames[index]);
                    atlasAnim.currentFrame = 0;
                    atlasAnim.timeAccumulator = 0;
                }

                if (spriteAnim) {
                    spriteAnim.state = group as any;
                    const range = spriteAnim.stateFrames[group];
                    if (range) {
                        spriteAnim.currentFrame = range.start;
                        spriteAnim.timeAccumulator = 0;
                    }
                }
            }
        }
    }

    private computeFacing(player: Player, transform: Transform, fallback: FacingDirection): FacingDirection {
        if (player.path.length > 0) {
            const target = player.path[0];
            const worldDir = new THREE.Vector3(target.x - transform.position.x, 0, target.z - transform.position.z);
            if (worldDir.lengthSq() < 1e-6) {
                return fallback;
            }

            const cameraQuat = this.camera.quaternion.clone();
            const invCameraQuat = cameraQuat.invert();
            const localDir = worldDir.applyQuaternion(invCameraQuat);

            const x = localDir.x;
            const z = localDir.z;

            if (Math.abs(x) > Math.abs(z)) {
                return x >= 0 ? 'right' : 'left';
            }

            return z >= 0 ? 'down' : 'up';
        }

        return fallback;
    }

    private computeAction(player: Player, control: CharacterControl) {
        if (control.requestedAction && control.requestedAction.startsWith('attack')) {
            return control.requestedAction;
        }
        return player.isMoving ? 'run' : 'idle';
    }

    private resolveGroup(control: CharacterControl, action: string, facing: FacingDirection): string {
        const candidates = [action];
        if (action === 'run') candidates.push('walk');
        if (action === 'walk') candidates.push('run');
        if (action !== 'idle') candidates.push('idle');

        for (const candidate of candidates) {
            const group = `${candidate}_${facing}`;
            if (control.frameGroups[group]?.length) {
                return group;
            }
        }

        for (const candidate of candidates) {
            for (const direction of DIRECTIONS) {
                const group = `${candidate}_${direction}`;
                if (control.frameGroups[group]?.length) {
                    return group;
                }
            }
        }

        return control.currentGroup || `${action}_${facing}`;
    }
}
