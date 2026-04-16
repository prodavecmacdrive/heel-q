import * as THREE from 'three';

export class TextureManager {
    private loader: THREE.TextureLoader;
    private textures: Map<string, THREE.Texture> = new Map();

    constructor() {
        this.loader = new THREE.TextureLoader();
    }

    /**
     * Loads a texture and strictly enforces nearest-neighbor filtering
     */
    async loadTexture(key: string, url: string): Promise<THREE.Texture> {
        // No early return here so we can overwrite placeholders with real PNGs

        return new Promise((resolve, reject) => {
            this.loader.load(url, (texture) => {
                // strict constraints for retro rendering
                texture.minFilter = THREE.NearestFilter;
                texture.magFilter = THREE.NearestFilter;
                texture.generateMipmaps = false;
                texture.colorSpace = THREE.SRGBColorSpace;
                
                this.textures.set(key, texture);
                resolve(texture);
            }, undefined, reject);
        });
    }

    /**
     * Store an already generated/loaded texture directly (useful for placeholder generator)
     */
    registerTexture(key: string, texture: THREE.Texture) {
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(key, texture);
    }

    getTexture(key: string): THREE.Texture | undefined {
        return this.textures.get(key);
    }
}
