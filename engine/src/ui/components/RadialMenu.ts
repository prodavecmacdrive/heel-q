export interface RadialAction {
    id: string;
    label: string;
    icon?: string;
}

export class RadialMenu {
    private container: HTMLElement;
    private svg!: SVGSVGElement;
    private visible: boolean = false;

    constructor(container: HTMLElement) {
        this.container = container;
        this.init();
    }

    private init() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.style.display = 'none';
        this.svg.style.pointerEvents = 'auto';
        this.container.appendChild(this.svg);
    }

    public show(x: number, y: number, actions: RadialAction[]) {
        this.visible = true;
        this.svg.style.display = 'block';
        this.renderActions(x, y, actions);
    }

    public hide() {
        this.visible = false;
        this.svg.style.display = 'none';
        this.svg.innerHTML = '';
    }

    private renderActions(x: number, y: number, actions: RadialAction[]) {
        this.svg.innerHTML = '';
        const count = Math.max(3, actions.length);
        const radiusInner = 40;
        const radiusOuter = 90;
        const angleStep = (Math.PI * 2) / count;

        actions.forEach((action, i) => {
            const startAngle = i * angleStep - Math.PI / 2;
            const endAngle = (i + 1) * angleStep - Math.PI / 2;

            const pathData = this.describeArc(x, y, radiusInner, radiusOuter, startAngle, endAngle);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            path.setAttribute('fill', 'rgba(0, 255, 0, 0.2)');
            path.setAttribute('stroke', '#00ff00');
            path.setAttribute('stroke-width', '2');
            path.style.cursor = 'pointer';

            path.addEventListener('mouseenter', () => path.setAttribute('fill', 'rgba(0, 255, 0, 0.4)'));
            path.addEventListener('mouseleave', () => path.setAttribute('fill', 'rgba(0, 255, 0, 0.2)'));

            this.svg.appendChild(path);

            // Add label/icon at center of segment
            const midAngle = (startAngle + endAngle) / 2;
            const textX = x + Math.cos(midAngle) * (radiusInner + radiusOuter) / 2;
            const textY = y + Math.sin(midAngle) * (radiusInner + radiusOuter) / 2;

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', textX.toString());
            text.setAttribute('y', textY.toString());
            text.setAttribute('fill', '#fff');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('font-size', '10');
            text.textContent = action.label;
            text.style.pointerEvents = 'none';
            this.svg.appendChild(text);
        });
    }

    private describeArc(x: number, y: number, innerR: number, outerR: number, startAngle: number, endAngle: number): string {
        const x1 = x + Math.cos(startAngle) * innerR;
        const y1 = y + Math.sin(startAngle) * innerR;
        const x2 = x + Math.cos(endAngle) * innerR;
        const y2 = y + Math.sin(endAngle) * innerR;

        const x3 = x + Math.cos(endAngle) * outerR;
        const y3 = y + Math.sin(endAngle) * outerR;
        const x4 = x + Math.cos(startAngle) * outerR;
        const y4 = y + Math.sin(startAngle) * outerR;

        const largeArc = endAngle - startAngle <= Math.PI ? '0' : '1';

        return [
            `M ${x1} ${y1}`,
            `A ${innerR} ${innerR} 0 ${largeArc} 1 ${x2} ${y2}`,
            `L ${x3} ${y3}`,
            `A ${outerR} ${outerR} 0 ${largeArc} 0 ${x4} ${y4}`,
            `Z`
        ].join(' ');
    }
}
