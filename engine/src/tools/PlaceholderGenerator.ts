import { TextureManager } from '../engine/rendering/TextureManager';
import * as THREE from 'three';

/**
 * PlaceholderGenerator — draws procedural pixel-art assets.
 * Deeply upgraded for Phase 2 Lab aesthetics.
 */
export class PlaceholderGenerator {

    public generateAll(textureManager: TextureManager) {
        this.generateFloorCheckerboard(textureManager);
        this.generateBrickWall(textureManager, 'wall_dark', '#4A2A2A', '#2A2A3A');
        this.generateBrickWall(textureManager, 'wall_hallway', '#5A3030', '#3A2A2A');
        // 'door' placeholder texture removed — doors use their own textureSource field
        this.generateCharacterSheet(textureManager, 'elias_sheet', '#D4A574', '#2B2B3C', '#1A1A28');
        this.generateCharacterSheet(textureManager, 'vance_sheet', '#8B7355', '#3C2B2B', '#281A1A');
        this.generateDogSheet(textureManager, 'dog_sheet', '#C4956A');
        this.generatePropSprite(textureManager, 'desk', 48, 32, '#4A3520', '#362818');
        this.generatePropSprite(textureManager, 'lamp', 16, 32, '#FFD700', '#CCAA00');
        this.generatePropSprite(textureManager, 'filing_cabinet', 24, 40, '#708090', '#556677');
        
        // Lab Room assets
        this.generateFloorLab(textureManager);
        this.generateLabWall(textureManager, 'lab_wall');
        this.generateCryoPod(textureManager, 'cryo_pod');
        this.generateSecurityCamera(textureManager, 'sec_camera');
        this.generateScifiCharacterSheet(textureManager, 'scifi_sheet');
        this.generateBrokenDoor(textureManager, 'broken_door');
    }

    private generateFloorCheckerboard(tm: TextureManager) {
        const size = 64;
        const c = this.makeCanvas(size, size);
        const ctx = c.getContext('2d')!;
        for (let y = 0; y < size; y += 8) {
            for (let x = 0; x < size; x += 8) {
                ctx.fillStyle = (x + y) / 8 % 2 === 0 ? '#5C3A1E' : '#4A2E16';
                ctx.fillRect(x, y, 8, 8);
            }
        }
        tm.registerTexture('floor', new THREE.CanvasTexture(c));
    }

    private generateBrickWall(tm: TextureManager, key: string, cA: string, cB: string) {
        const size = 64;
        const c = this.makeCanvas(size, size);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = cA; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = cB;
        for (let y = 0; y < size; y += 8) {
            const off = (y / 8 % 2) * 8;
            for (let x = 0; x < size; x += 16) ctx.fillRect(x + off, y, 14, 6);
        }
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generateCharacterSheet(tm: TextureManager, key: string, skin: string, coat: string, pants: string) {
        const fw = 32, fh = 32;
        const c = this.makeCanvas(fw * 4, fh * 2);
        const ctx = c.getContext('2d')!;
        for (let i = 0; i < 8; i++) {
            const x = (i % 4) * fw, y = Math.floor(i / 4) * fh;
            ctx.fillStyle = pants; ctx.fillRect(x + 12, y + 24, 8, 8);
            ctx.fillStyle = coat; ctx.fillRect(x + 10, y + 14, 12, 12);
            ctx.fillStyle = skin; ctx.fillRect(x + 12, y + 6, 8, 8);
        }
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generateDogSheet(tm: TextureManager, key: string, fur: string) {
        const fw = 32, fh = 32;
        const c = this.makeCanvas(fw * 2, fh * 1);
        const ctx = c.getContext('2d')!;
        for (let i = 0; i < 2; i++) {
            const x = i * fw;
            ctx.fillStyle = fur; ctx.fillRect(x + 8, x + 16, 16, 10);
            ctx.fillStyle = '#000'; ctx.fillRect(x + 22, x + 18, 2, 2);
        }
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generatePropSprite(tm: TextureManager, key: string, w: number, h: number, c1: string, c2: string) {
        const c = this.makeCanvas(w, h);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = c2; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = c1; ctx.fillRect(2, 2, w - 4, h - 4);
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    // ── Lab Aesthetics ─────────────────────────────────────────────

    private generateFloorLab(tm: TextureManager) {
        const size = 128;
        const c = this.makeCanvas(size, size);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#1e2427'; ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#2c3539';
        for (let i = 0; i <= size; i += 32) {
            ctx.strokeRect(i, 0, 1, size); ctx.strokeRect(0, i, size, 1);
        }
        ctx.fillStyle = '#b68026'; // Chevrons
        for (let i = 16; i < size; i += 64) {
            ctx.beginPath(); ctx.moveTo(i, 20); ctx.lineTo(i+8, 28); ctx.lineTo(i, 36); ctx.fill();
        }
        tm.registerTexture('lab_floor', new THREE.CanvasTexture(c));
    }

    private generateLabWall(tm: TextureManager, key: string) {
        const size = 128;
        const c = this.makeCanvas(size, size);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#2c3539'; ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#1a1f21'; ctx.fillRect(0, 48, size, 12);
        ctx.fillStyle = '#cc5500'; ctx.fillRect(10, 10, 40, 16); // Warning sign
        ctx.fillStyle = '#ffaa33'; ctx.fillRect(12, 12, 36, 12);
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generateCryoPod(tm: TextureManager, key: string) {
        const w = 64, h = 128;
        const c = this.makeCanvas(w, h);
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#3c4f56'; ctx.fillRect(8, 0, 48, h);
        ctx.fillStyle = '#114433'; ctx.fillRect(12, 12, 40, h - 24); // Liquid
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; ctx.fillRect(16, 12, 4, h - 24); // Reflection
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generateBrokenDoor(tm: TextureManager, key: string) {
        const w = 128, h = 128;
        const c = this.makeCanvas(w, h);
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#3c4f56'; ctx.fillRect(0, 0, 40, h); ctx.fillRect(w - 40, 0, 40, h);
        ctx.strokeStyle = '#aaddff'; ctx.beginPath(); ctx.moveTo(40, 60); ctx.lineTo(60, 50); ctx.stroke();
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generateSecurityCamera(tm: TextureManager, key: string) {
        const w = 32, h = 32;
        const c = this.makeCanvas(w, h);
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#666'; ctx.fillRect(4, 10, 24, 12);
        ctx.fillStyle = '#f00'; ctx.fillRect(20, 14, 2, 2);
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private generateScifiCharacterSheet(tm: TextureManager, key: string) {
        const fw = 64, fh = 64;
        const c = this.makeCanvas(fw * 4, fh * 2);
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        for (let i = 0; i < 4; i++) {
            [0, fh].forEach((y, row) => {
                const x = i * fw, bx = x + 32, by = y + 74;
                const walk = row === 0 ? 0 : Math.sin(i * Math.PI / 2) * 6;
                ctx.fillStyle = '#444c50'; ctx.fillRect(bx - 10, by - 36, 20, 22); // Torso
                ctx.fillStyle = '#d1d1d1'; ctx.fillRect(bx - 8, by - 52, 16, 14); // Helmet
                ctx.fillStyle = '#4488ff'; ctx.fillRect(bx - 6, by - 48, 12, 6); // Visor
                ctx.fillStyle = '#5c4033'; ctx.fillRect(bx - 9, by - 14 + walk, 8, 4); ctx.fillRect(bx + 1, by - 14 - walk, 8, 4); // Boots
            });
        }
        tm.registerTexture(key, new THREE.CanvasTexture(c));
    }

    private makeCanvas(w: number, h: number): HTMLCanvasElement {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }
}
