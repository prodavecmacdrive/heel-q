/* ═══════════════════════════════════════════════════════════════════════
   ContextMenu — Right-click context menu for the editor
   ═══════════════════════════════════════════════════════════════════════ */

export interface ContextMenuOption {
  id: string;
  label: string;
  keyboardShortcut?: string;
  divider?: boolean;
  disabled?: boolean;
  action: () => void;
}

export class ContextMenu {
  private menuElement: HTMLElement;
  private isOpen = false;

  constructor() {
    this.menuElement = document.createElement('div');
    this.menuElement.className = 'editor-context-menu';
    this.menuElement.style.position = 'fixed';
    this.menuElement.style.zIndex = '9999';
    this.menuElement.style.display = 'none';
    document.body.appendChild(this.menuElement);

    // Close menu when clicking elsewhere
    window.addEventListener('mousedown', (e) => {
      if (this.isOpen && !this.menuElement.contains(e.target as Node)) {
        this.hide();
      }
    }, true);

    // Prevent context menu on the menu itself
    this.menuElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  public show(x: number, y: number, options: ContextMenuOption[]) {
    this.render(options);
    
    this.menuElement.style.display = 'block';
    
    // Position check to stay on screen
    const menuRect = this.menuElement.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    if (x + menuRect.width > winW) x = winW - menuRect.width - 5;
    if (y + menuRect.height > winH) y = winH - menuRect.height - 5;

    this.menuElement.style.left = `${x}px`;
    this.menuElement.style.top = `${y}px`;
    this.isOpen = true;
  }

  public hide() {
    this.menuElement.style.display = 'none';
    this.isOpen = false;
  }

  private render(options: ContextMenuOption[]) {
    this.menuElement.innerHTML = '';
    
    options.forEach(opt => {
      if (opt.divider) {
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        this.menuElement.appendChild(div);
      }

      const item = document.createElement('div');
      item.className = `context-menu-item ${opt.disabled ? 'disabled' : ''}`;
      
      const label = document.createElement('span');
      label.className = 'context-menu-label';
      label.textContent = opt.label;
      item.appendChild(label);

      if (opt.keyboardShortcut) {
        const shortcut = document.createElement('span');
        shortcut.className = 'context-menu-shortcut';
        shortcut.textContent = opt.keyboardShortcut;
        item.appendChild(shortcut);
      }

      if (!opt.disabled) {
        item.onclick = () => {
          opt.action();
          this.hide();
        };
      }

      this.menuElement.appendChild(item);
    });
  }
}
