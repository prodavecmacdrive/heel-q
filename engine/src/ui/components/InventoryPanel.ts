export class InventoryPanel {
    private container: HTMLElement;
    private gridContainer!: HTMLElement;
    private currentOffset: number = 0;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    private render() {
        this.container.innerHTML = `
            <div class="inventory-grid-container" id="inventory-grid">
                ${Array(16).fill(0).map((_, i) => `<div class="inventory-slot" data-index="${i}"></div>`).join('')}
            </div>
            <div class="inventory-scroll-btns">
                <button class="scroll-btn" id="inv-left"> &lt; </button>
                <button class="scroll-btn" id="inv-right"> &gt; </button>
            </div>
        `;

        this.gridContainer = this.container.querySelector('#inventory-grid') as HTMLElement;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        this.container.querySelector('#inv-left')?.addEventListener('click', () => this.scroll(-1));
        this.container.querySelector('#inv-right')?.addEventListener('click', () => this.scroll(1));
    }

    private scroll(direction: number) {
        // Implementation for horizontal scrolling if items exceed 16 slots
        // For now, it's a stub as the requirement mentions scrolling if more than 16 items.
        console.log('Scroll inventory:', direction);
    }
}
