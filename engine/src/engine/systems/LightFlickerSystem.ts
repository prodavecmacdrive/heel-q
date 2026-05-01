import { System } from '../ecs/System';
import { World } from '../ecs/World';
import * as THREE from 'three';

/**
 * LightFlickerSystem — applies simple flicker effects to lights that
 * have `flickerMode` set by RoomManager. Supports `pattern` (sinus)
 * and `random` (per-light pseudo-random noise) modes.
 */
export class LightFlickerSystem extends System {
    private scene: THREE.Scene;
    private time = 0;

    constructor(world: World, scene: THREE.Scene) {
        super(world);
        this.scene = scene;
    }

    update(dt: number) {
        this.time += dt;

        // Iterate lights that RoomManager tagged with flicker properties
        this.scene.traverse((obj) => {
            const light = obj as any;
            if (!light || !light.flickerMode || light.flickerMode === 'none') return;

            const mode: string = light.flickerMode;
            const speed: number = light.flickerSpeed ?? 1;
            const amp: number = light.flickerAmplitude ?? 0.1;
            const base: number = light.flickerBaseIntensity ?? (light.intensity ?? 1);
            let target = base;
            if (mode === 'pattern') {
                const pattern: number[] = Array.isArray(light.flickerPattern) ? light.flickerPattern : [0,1,0,1];
                if (pattern.length === 0) {
                    target = base;
                } else {
                    const idx = Math.floor(this.time * speed) % pattern.length;
                    const on = pattern[idx] ? 1 : 0;
                    target = base * on;
                }
            } else if (mode === 'random') {
                const seed = this.hashPhase(light.uuid) * 1000;
                const t = this.time * speed;
                const delta = (Math.sin(t * 3.1 + seed) * 0.5 + Math.sin(t * 1.7 + seed * 0.7) * 0.25) * amp;
                target = Math.max(0, base * (1 + delta));
            } else {
                target = base;
            }

            // smoothing / decay: 0 = instant, >0 = smoothed (higher = faster)
            const decay: number = light.flickerDecay ?? 0;
            if (decay <= 0) {
                if (typeof light.intensity === 'number') light.intensity = target;
                light.flickerCurrent = target;
            } else {
                const cur = typeof light.flickerCurrent === 'number' ? light.flickerCurrent : (light.intensity ?? base);
                // exponential smoothing factor
                const alpha = 1 - Math.exp(-decay * dt);
                const next = cur + (target - cur) * alpha;
                light.flickerCurrent = next;
                if (typeof light.intensity === 'number') light.intensity = next;
            }
        });
    }

    private hashPhase(uuid: string): number {
        // Simple deterministic hash -> [0, 2PI)
        let h = 2166136261 >>> 0;
        for (let i = 0; i < uuid.length; i++) {
            h ^= uuid.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return (h % 1000) / 1000 * Math.PI * 2;
    }
}
