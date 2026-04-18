import * as THREE from 'three';

/**
 * NavGrid — 2D grid-based A* pathfinding on the XZ floor plane.
 *
 * The grid is constructed from the room's floor dimensions minus a walk padding.
 * Obstacle entities stamp blocked cells.  The A* implementation returns a
 * simplified waypoint list (corners only) for the MovementSystem to follow.
 */

const CELL_SIZE = 0.5; // world units per cell
export { CELL_SIZE };

interface Cell {
    x: number;       // grid col
    z: number;       // grid row
    blocked: boolean;
}

interface AStarNode {
    x: number;
    z: number;
    g: number;       // cost from start
    h: number;       // heuristic to goal
    f: number;       // g + h
    parent: AStarNode | null;
}

export class NavGrid {
    private grid: Cell[][] = []; // grid[row][col]
    private cols: number = 0;
    private rows: number = 0;

    // World-space bounds of the navigable area
    private minX: number = 0;
    private minZ: number = 0;
    private maxX: number = 0;
    private maxZ: number = 0;

    /**
     * Build the grid from floor geometry + padding.
     * floorCenter/floorWidth/floorDepth describe the visual floor mesh.
     * padding is inset from the edges to keep sprites off walls.
     */
    public build(
        floorCenterX: number,
        floorCenterZ: number,
        floorWidth: number,
        floorDepth: number,
        padding: number
    ) {
        this.minX = floorCenterX - floorWidth / 2 + padding;
        this.maxX = floorCenterX + floorWidth / 2 - padding;
        this.minZ = floorCenterZ - floorDepth / 2 + padding;
        this.maxZ = floorCenterZ + floorDepth / 2 - padding;

        this.cols = Math.max(1, Math.ceil((this.maxX - this.minX) / CELL_SIZE));
        this.rows = Math.max(1, Math.ceil((this.maxZ - this.minZ) / CELL_SIZE));

        this.grid = [];
        for (let r = 0; r < this.rows; r++) {
            const row: Cell[] = [];
            for (let c = 0; c < this.cols; c++) {
                row.push({ x: c, z: r, blocked: false });
            }
            this.grid.push(row);
        }
    }

    /** Mark cells blocked by an obstacle centered at (wx, wz) with half-extents */
    public stampObstacle(wx: number, wz: number, halfW: number, halfD: number) {
        const cMinX = this.worldToCol(wx - halfW);
        const cMaxX = this.worldToCol(wx + halfW);
        const rMinZ = this.worldToRow(wz - halfD);
        const rMaxZ = this.worldToRow(wz + halfD);

        for (let r = rMinZ; r <= rMaxZ; r++) {
            for (let c = cMinX; c <= cMaxX; c++) {
                if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
                    this.grid[r][c].blocked = true;
                }
            }
        }
    }

    /** Clamp a world position to the navigable bounds */
    public clamp(pos: THREE.Vector3): THREE.Vector3 {
        return new THREE.Vector3(
            Math.max(this.minX, Math.min(this.maxX, pos.x)),
            pos.y,
            Math.max(this.minZ, Math.min(this.maxZ, pos.z))
        );
    }

    /**
     * A* pathfind from start to goal (world coordinates).
     * Returns an array of world-space waypoints (feet positions) or
     * an empty array if no path exists.
     */
    public findPath(start: THREE.Vector3, goal: THREE.Vector3): THREE.Vector3[] {
        const sc = this.worldToCol(start.x);
        const sr = this.worldToRow(start.z);
        const gc = this.worldToCol(goal.x);
        const gr = this.worldToRow(goal.z);

        // If start or goal is blocked, snap to nearest open cell
        const startCell = this.nearestOpen(sc, sr);
        const goalCell = this.nearestOpen(gc, gr);
        if (!startCell || !goalCell) return [];

        // Trivial case
        if (startCell.x === goalCell.x && startCell.z === goalCell.z) {
            return [this.cellToWorld(goalCell.x, goalCell.z, goal.y)];
        }

        // A* open/closed
        const open: AStarNode[] = [];
        const closed = new Set<string>();
        const key = (c: number, r: number) => `${c},${r}`;

        const startNode: AStarNode = {
            x: startCell.x, z: startCell.z,
            g: 0,
            h: this.heuristic(startCell.x, startCell.z, goalCell.x, goalCell.z),
            f: 0,
            parent: null
        };
        startNode.f = startNode.g + startNode.h;
        open.push(startNode);

        const dirs = [
            [0, -1], [0, 1], [-1, 0], [1, 0],         // cardinal
            [-1, -1], [-1, 1], [1, -1], [1, 1]          // diagonal
        ];

        let iterations = 0;
        const maxIter = this.cols * this.rows * 2;

        while (open.length > 0 && iterations++ < maxIter) {
            // Find lowest f
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) bestIdx = i;
            }
            const current = open.splice(bestIdx, 1)[0];

            if (current.x === goalCell.x && current.z === goalCell.z) {
                // Reconstruct path
                return this.reconstructPath(current, start.y);
            }

            closed.add(key(current.x, current.z));

            for (const [dc, dr] of dirs) {
                const nc = current.x + dc;
                const nr = current.z + dr;

                if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
                if (this.grid[nr][nc].blocked) continue;
                if (closed.has(key(nc, nr))) continue;

                // Diagonal: block if either adjacent cardinal is blocked (prevent corner cutting)
                if (dc !== 0 && dr !== 0) {
                    if (this.grid[current.z + dr]?.[current.x]?.blocked) continue;
                    if (this.grid[current.z]?.[current.x + dc]?.blocked) continue;
                }

                const moveCost = (dc !== 0 && dr !== 0) ? 1.414 : 1.0;
                const g = current.g + moveCost;
                const h = this.heuristic(nc, nr, goalCell.x, goalCell.z);
                const f = g + h;

                // Check if already in open with better g
                const existing = open.find(n => n.x === nc && n.z === nr);
                if (existing) {
                    if (g < existing.g) {
                        existing.g = g;
                        existing.f = f;
                        existing.parent = current;
                    }
                    continue;
                }

                open.push({ x: nc, z: nr, g, h, f, parent: current });
            }
        }

        // No path found — just return the goal clamped (walk as close as possible)
        return [this.clamp(goal)];
    }

    // ── Internals ──────────────────────────────────────────────────

    private heuristic(ax: number, az: number, bx: number, bz: number): number {
        // Octile distance
        const dx = Math.abs(ax - bx);
        const dz = Math.abs(az - bz);
        return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    }

    private reconstructPath(node: AStarNode, y: number): THREE.Vector3[] {
        const raw: THREE.Vector3[] = [];
        let cur: AStarNode | null = node;
        while (cur) {
            raw.unshift(this.cellToWorld(cur.x, cur.z, y));
            cur = cur.parent;
        }
        // Simplify: remove collinear intermediate nodes
        if (raw.length <= 2) return raw;
        const simplified: THREE.Vector3[] = [raw[0]];
        for (let i = 1; i < raw.length - 1; i++) {
            const prev = raw[i - 1];
            const curr = raw[i];
            const next = raw[i + 1];
            const dx1 = curr.x - prev.x;
            const dz1 = curr.z - prev.z;
            const dx2 = next.x - curr.x;
            const dz2 = next.z - curr.z;
            // If direction changed, keep this waypoint
            if (Math.abs(dx1 - dx2) > 0.001 || Math.abs(dz1 - dz2) > 0.001) {
                simplified.push(curr);
            }
        }
        simplified.push(raw[raw.length - 1]);
        return simplified;
    }

    private nearestOpen(col: number, row: number): { x: number; z: number } | null {
        col = Math.max(0, Math.min(this.cols - 1, col));
        row = Math.max(0, Math.min(this.rows - 1, row));
        if (!this.grid[row][col].blocked) return { x: col, z: row };

        // BFS spiral outward
        for (let radius = 1; radius < Math.max(this.cols, this.rows); radius++) {
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                    const nr = row + dr;
                    const nc = col + dc;
                    if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                        if (!this.grid[nr][nc].blocked) return { x: nc, z: nr };
                    }
                }
            }
        }
        return null;
    }

    private worldToCol(wx: number): number {
        return Math.max(0, Math.min(this.cols - 1, Math.floor((wx - this.minX) / CELL_SIZE)));
    }

    private worldToRow(wz: number): number {
        return Math.max(0, Math.min(this.rows - 1, Math.floor((wz - this.minZ) / CELL_SIZE)));
    }

    private cellToWorld(col: number, row: number, y: number): THREE.Vector3 {
        return new THREE.Vector3(
            this.minX + (col + 0.5) * CELL_SIZE,
            y,
            this.minZ + (row + 0.5) * CELL_SIZE
        );
    }
}
