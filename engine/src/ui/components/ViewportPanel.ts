import { RadialMenu } from './RadialMenu';

export class ViewportPanel {
    private container: HTMLElement;
    private header!: HTMLElement;
    private viewport!: HTMLElement;
    private radialMenu!: RadialMenu;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    private render() {
        this.container.innerHTML = `
            <div class="info-header" id="info-header">THE HEEL JOURNEY - [LOCATION_NAME]</div>
            <div class="viewport-container" id="game-viewport">
                <!-- Three.js Canvas will be moved here -->
                <div class="radial-menu-overlay" id="radial-menu-overlay"></div>
            </div>
        `;

        this.header = this.container.querySelector('#info-header') as HTMLElement;
        this.viewport = this.container.querySelector('#game-viewport') as HTMLElement;

        const radialOverlay = this.container.querySelector('#radial-menu-overlay') as HTMLElement;
        this.radialMenu = new RadialMenu(radialOverlay);
    }

    public getViewportContainer(): HTMLElement {
        return this.viewport;
    }

    public setHeaderText(text: string) {
        this.header.textContent = `THE HEEL JOURNEY - ${text}`;
    }
}
