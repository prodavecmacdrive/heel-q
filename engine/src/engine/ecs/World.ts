import { Entity } from './Entity';
import { ComponentName, ComponentRegistry } from './Component';
import { System } from './System';

export class World {
    private nextEntityId: Entity = 0;
    private entities: Set<Entity> = new Set();
    
    // Storage for components maps a component name to a map of entity -> component data
    private components: Map<ComponentName, Map<Entity, any>> = new Map();
    
    // Registered systems
    private systems: System[] = [];

    // Entities queued for deletion
    private entitiesToDestroy: Set<Entity> = new Set();

    constructor() {}

    createEntity(): Entity {
        const entity = this.nextEntityId++;
        this.entities.add(entity);
        return entity;
    }

    destroyEntity(entity: Entity) {
        this.entitiesToDestroy.add(entity);
    }

    addComponent<T extends ComponentName>(entity: Entity, componentName: T, data: ComponentRegistry[T]): void {
        if (!this.components.has(componentName)) {
            this.components.set(componentName, new Map());
        }
        this.components.get(componentName)!.set(entity, data);
    }

    removeComponent(entity: Entity, componentName: ComponentName): void {
        this.components.get(componentName)?.delete(entity);
    }

    getComponent<T extends ComponentName>(entity: Entity, componentName: T): ComponentRegistry[T] | undefined {
        return this.components.get(componentName)?.get(entity);
    }

    hasComponent(entity: Entity, componentName: ComponentName): boolean {
        return this.components.get(componentName)?.has(entity) || false;
    }

    queryEntities(requiredComponents: ComponentName[]): Entity[] {
        const result: Entity[] = [];
        for (const entity of this.entities) {
            let hasAll = true;
            for (const comp of requiredComponents) {
                if (!this.hasComponent(entity, comp)) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll && !this.entitiesToDestroy.has(entity)) {
                result.push(entity);
            }
        }
        return result;
    }

    addSystem(system: System) {
        this.systems.push(system);
    }

    getSystem<T extends System>(constructor: new (...args: any[]) => T): T | undefined {
        return this.systems.find(s => s instanceof constructor) as T;
    }

    update(dt: number) {
        const frameStart = performance.now();

        for (const system of this.systems) {
            const sysStart = performance.now();
            system.update(dt);
            const sysEnd = performance.now();
            const sysDuration = sysEnd - sysStart;
            if (sysDuration > 50) {
                console.warn(`[World] Slow system ${system.constructor.name}: ${sysDuration.toFixed(1)}ms`);
            }
        }

        const cleanupStart = performance.now();
        if (this.entitiesToDestroy.size > 0) {
            for (const entity of this.entitiesToDestroy) {
                for (const map of this.components.values()) {
                    map.delete(entity);
                }
                this.entities.delete(entity);
            }
            this.entitiesToDestroy.clear();
        }
        const cleanupEnd = performance.now();
        const cleanupDuration = cleanupEnd - cleanupStart;
        if (cleanupDuration > 10) {
            console.warn(`[World] cleanup took ${cleanupDuration.toFixed(1)}ms`);
        }

        const frameEnd = performance.now();
        const frameDuration = frameEnd - frameStart;
        if (frameDuration > 100) {
            console.warn(`[World] update frame took ${frameDuration.toFixed(1)}ms`);
        }
    }
}
