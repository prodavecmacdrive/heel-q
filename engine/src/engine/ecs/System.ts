import { World } from './World';
import { Entity } from './Entity';

export abstract class System {
    protected world: World;

    constructor(world: World) {
        this.world = world;
    }

    // Returning true means this system runs every frame
    abstract update(dt: number, entities?: Entity[]): void;
}
