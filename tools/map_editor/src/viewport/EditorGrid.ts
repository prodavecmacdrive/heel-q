/* ═══════════════════════════════════════════════════════════════════════
   EditorGrid — ground grid + axes helper
   ═══════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';

const GRID_SIZE = 50;
const SUB_GRID_STEP = 0.25;

export class EditorGrid {
  public readonly gridGroup: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.gridGroup = new THREE.Group();
    this.gridGroup.name = '__editor_grid';

    // ── Main grid (1-unit spacing) ──
    const mainGrid = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, 0x2a3040, 0x1a2030);
    mainGrid.material.transparent = true;
    (mainGrid.material as THREE.Material).opacity = 0.6;
    this.gridGroup.add(mainGrid);

    // ── Sub-grid (finer lines — shown as thin overlay) ──
    const subDivisions = GRID_SIZE / SUB_GRID_STEP;
    const subGrid = new THREE.GridHelper(GRID_SIZE, subDivisions, 0x1a2030, 0x141a24);
    subGrid.material.transparent = true;
    (subGrid.material as THREE.Material).opacity = 0.25;
    subGrid.position.y = -0.001; // slightly below main grid
    this.gridGroup.add(subGrid);

    // ── Axes ──
    const axes = new THREE.AxesHelper(3);
    axes.position.y = 0.01;
    this.gridGroup.add(axes);

    // ── Floor reference plane (for raycasting / visual ground) ──
    const planeGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
    const planeMat = new THREE.MeshStandardMaterial({
      color: 0x0d1117,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.3,
    });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.rotation.x = -Math.PI / 2;
    planeMesh.position.y = -0.01;
    planeMesh.receiveShadow = true;
    planeMesh.name = '__floor_plane';
    this.gridGroup.add(planeMesh);

    scene.add(this.gridGroup);
  }

  public setVisible(v: boolean) {
    this.gridGroup.visible = v;
  }
}
