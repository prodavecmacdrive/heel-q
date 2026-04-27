/* ═══════════════════════════════════════════════════════════════════════
   BottomPanel — Content Browser (Assets / 3D Primitives / Functional)
   ═══════════════════════════════════════════════════════════════════════ */

import type { EntityType, PrimitiveGeometry } from '../types/entities';

export type BrowserTab = 'assets' | 'primitives' | 'functional';

export interface DragData {
  entityType: EntityType;
  subType?: string;
  assetPath?: string;
}

export interface AssetData {
  sprites: string[];
  textures: string[];
  audio: string[];
}

export class BottomPanel {
  private container: HTMLElement;
  private currentTab: BrowserTab = 'primitives';
  private addEntityCallback: ((data: DragData) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  /** Register a callback for when a card is double-clicked (alternative to drag) */
  public onAddEntity(cb: (data: DragData) => void) {
    this.addEntityCallback = cb;
  }

  private render() {
    this.container.innerHTML = `
      <div class="browser-tabs">
        <button class="browser-tab" data-tab="assets" id="browser-tab-assets">
          <svg class="browser-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
          Assets
        </button>
        <button class="browser-tab active" data-tab="primitives" id="browser-tab-primitives">
          <svg class="browser-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7v10l10 5 10-5V7z"/>
          </svg>
          3D Primitives
        </button>
        <button class="browser-tab" data-tab="functional" id="browser-tab-functional">
          <svg class="browser-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          Functional
        </button>
      </div>
      <div class="browser-content" id="browser-content"></div>
    `;

    // Tab switching
    this.container.querySelectorAll('.browser-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const t = (tab as HTMLElement).dataset.tab as BrowserTab;
        this.setTab(t);
      });
    });

    this.renderTabContent();
  }

  private setTab(tab: BrowserTab) {
    this.currentTab = tab;
    this.container.querySelectorAll('.browser-tab').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
    });
    this.renderTabContent();
  }

  private renderTabContent() {
    const content = document.getElementById('browser-content');
    if (!content) return;

    switch (this.currentTab) {
      case 'assets':
        content.innerHTML = this.renderAssetsTab();
        break;
      case 'primitives':
        content.innerHTML = this.renderPrimitivesTab();
        break;
      case 'functional':
        content.innerHTML = this.renderFunctionalTab();
        break;
    }

    // Make cards draggable + double-click to add
    content.querySelectorAll('.browser-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const el = card as HTMLElement;
        const dragData: DragData = {
          entityType: el.dataset.entityType as EntityType,
          subType: el.dataset.subType || undefined,
          assetPath: el.dataset.assetPath || undefined,
        };
        (e as DragEvent).dataTransfer!.setData('application/json', JSON.stringify(dragData));
        (e as DragEvent).dataTransfer!.effectAllowed = 'copy';
      });

      // Double-click fallback: add entity at origin
      card.addEventListener('dblclick', () => {
        if (!this.addEntityCallback) return;
        const el = card as HTMLElement;
        this.addEntityCallback({
          entityType: el.dataset.entityType as EntityType,
          subType: el.dataset.subType || undefined,
        });
      });
    });
  }

  private loadedAssets: AssetData | null = null;

  private async fetchAssets() {
    try {
      const res = await fetch('/api/assets');
      if (res.ok) {
        this.loadedAssets = await res.json();
        if (this.currentTab === 'assets') {
          this.renderTabContent();
        }
      }
    } catch(e) {
      console.error(e);
    }
  }

  private renderAssetsTab(): string {
    if (!this.loadedAssets) {
      this.fetchAssets();
      return `<div style="padding: 20px; color: var(--text-muted);">Loading assets...</div>`;
    }

    const cards: string[] = [];

    // Textures
    if (this.loadedAssets.textures) {
      for (const file of this.loadedAssets.textures) {
        if (!file.match(/\.(jpg|jpeg|png|webp)$/i)) continue;
        const name = file.replace(/\.[^/.]+$/, '');
        cards.push(`
          <div class="browser-card" draggable="true"
               data-entity-type="primitive" data-sub-type="cube" data-asset-path="textures/${file}">
            <div class="browser-card-icon" style="background:linear-gradient(135deg, #3a6b9f, #2a5b8f)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
            </div>
            <span class="browser-card-label">${name}</span>
            <span class="browser-card-tag">texture</span>
          </div>
        `);
      }
    }

    // Sprites
    if (this.loadedAssets.sprites) {
      for (const file of this.loadedAssets.sprites) {
        if (!file.match(/\.(png|jpg|jpeg|webp)$/i)) continue;
        const name = file.replace(/\.[^/.]+$/, '');
        const hasJson = this.loadedAssets.sprites.includes(`${name}.json`);
        const type = hasJson ? 'animated_sprite' : 'sprite';
        const color = hasJson ? '#4a8a5f' : '#3a6b9f';
        const tag = hasJson ? 'animated' : 'sprite';

        cards.push(`
          <div class="browser-card" draggable="true"
               data-entity-type="${type}" data-sub-type="${name}" data-asset-path="sprites/${file}">
            <div class="browser-card-icon" style="background:linear-gradient(135deg, ${color}, ${this.darken(color)})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
              </svg>
            </div>
            <span class="browser-card-label">${name}</span>
            <span class="browser-card-tag">${tag}</span>
          </div>
        `);
      }
    }

    // Audio
    if (this.loadedAssets.audio) {
      for (const file of this.loadedAssets.audio) {
        if (!file.match(/\.(mp3|ogg|wav|flac)$/i)) continue;
        const name = file.replace(/\.[^/.]+$/, '');
        cards.push(`
          <div class="browser-card" draggable="true"
               data-entity-type="sound" data-sub-type="${name}" data-asset-path="audio/${file}">
            <div class="browser-card-icon" style="background:linear-gradient(135deg, #a48232, #7a5f20)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            </div>
            <span class="browser-card-label">${name}</span>
            <span class="browser-card-tag">audio</span>
          </div>
        `);
      }
    }

    if (cards.length === 0) {
      return `<div style="padding: 20px; color: var(--text-muted);">No assets found. Add files to the <code>assets/</code> directory.</div>`;
    }

    return `<div class="browser-grid">${cards.join('')}</div>`;
  }

  private renderPrimitivesTab(): string {
    const prims: Array<{ name: string; sub: PrimitiveGeometry; icon: string }> = [
      {
        name: 'Cube', sub: 'cube',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7v10l10 5 10-5V7z"/><path d="M12 22V12"/><path d="M22 7L12 12 2 7"/>
        </svg>`,
      },
      {
        name: 'Sphere', sub: 'sphere',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <ellipse cx="12" cy="12" rx="10" ry="4"/>
          <path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>
        </svg>`,
      },
      {
        name: 'Plane', sub: 'plane',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 16L12 21 22 16 12 11z"/>
        </svg>`,
      },
      {
        name: 'Cylinder', sub: 'cylinder',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <ellipse cx="12" cy="5" rx="8" ry="3"/>
          <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/>
        </svg>`,
      },
      {
        name: 'Cone', sub: 'cone',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L4 20c0 1.1 3.58 2 8 2s8-.9 8-2z"/>
        </svg>`,
      },
    ];

    return `<div class="browser-grid">
      ${prims.map(p => `
        <div class="browser-card card-${p.sub}" draggable="true"
             data-entity-type="primitive" data-sub-type="${p.sub}"
             id="prim-card-${p.sub}">
          <div class="browser-card-icon">${p.icon}</div>
          <span class="browser-card-label">${p.name}</span>
        </div>
      `).join('')}
    </div>`;
  }

  private renderFunctionalTab(): string {
    const funcs: Array<{ name: string; type: EntityType; cssClass: string; icon: string }> = [
      {
        name: 'Camera', type: 'camera', cssClass: 'card-camera',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
        </svg>`,
      },
      {
        name: 'Light', type: 'light', cssClass: 'card-light',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>`,
      },
      {
        name: 'Sound', type: 'sound', cssClass: 'card-sound',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>`,
      },
      {
        name: 'Trigger', type: 'trigger', cssClass: 'card-trigger',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>`,
      },
      {
        name: 'Spawn', type: 'spawn', cssClass: 'card-spawn',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>`,
      },
      {
        name: 'Customer', type: 'spawn', cssClass: 'card-customer',
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
          <path d="M7 14s1.5-2 5-2 5 2 5 2"/>
        </svg>`,
      },
    ];

    return `<div class="browser-grid">
      ${funcs.map(f => `
        <div class="browser-card ${f.cssClass}" draggable="true"
             data-entity-type="${f.type}" data-sub-type="${f.name === 'Customer' ? 'customer' : ''}"
             id="func-card-${f.type}-${f.name.toLowerCase()}">
          <div class="browser-card-icon">${f.icon}</div>
          <span class="browser-card-label">${f.name}</span>
        </div>
      `).join('')}
    </div>`;
  }

  private darken(hex: string): string {
    // Quick darken utility
    const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 40);
    const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 40);
    const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 40);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
}
