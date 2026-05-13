import { NavigationPanel } from './components/NavigationPanel';
import { ViewportPanel } from './components/ViewportPanel';
import { InventoryPanel } from './components/InventoryPanel';
import './styles/ui.css';

export class UIManager {
    private root: HTMLElement;
    private leftPanel!: NavigationPanel;
    private centerPanel!: ViewportPanel;
    private rightPanel!: InventoryPanel;

    constructor(container: HTMLElement) {
        this.root = document.createElement('div');
        this.root.id = 'game-ui-root';
        container.appendChild(this.root);

        this.initLayout();
    }

    private initLayout() {
        // Create the three main vertical zones
        const leftContainer = document.createElement('div');
        leftContainer.className = 'ui-panel-left';

        const centerContainer = document.createElement('div');
        centerContainer.className = 'ui-zone-center';

        const rightContainer = document.createElement('div');
        rightContainer.className = 'ui-panel-right';

        this.root.appendChild(leftContainer);
        this.root.appendChild(centerContainer);
        this.root.appendChild(rightContainer);

        // Initialize sub-components
        this.leftPanel = new NavigationPanel(leftContainer);
        this.centerPanel = new ViewportPanel(centerContainer);
        this.rightPanel = new InventoryPanel(rightContainer);
    }

    public getViewportContainer(): HTMLElement {
        return this.centerPanel.getViewportContainer();
    }

    public setLocationName(name: string) {
        this.centerPanel.setHeaderText(name);
    }

    // Additional methods to update UI state can be added here
}
