export const VIRTUAL_WIDTH = 480;
export const VIRTUAL_HEIGHT = 270;
export const PIXEL_RATIO = 8; // 1 world unit = 8 pixels

/** Multiplier for DepthSortSystem: renderOrder = round(feetZ × DEPTH_SORT_SCALE) */
export const DEPTH_SORT_SCALE = 1000;

// Discrete scale steps for fake 2.5D perspective scaling
export const SCALE_STEPS = [1.0, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125];

/** Height in world units that the player occupies (for under-pass clearance) */
export const CHARACTER_HEIGHT = 2.0;

export const COLORS = {
    BACKGROUND: '#000000',
    FLOOR: '#5C3A1E',
    WALL_DARK: '#2A2A3A',
    WALL_HALLWAY: '#3A2A2A',
    CEILING: '#1A1A2A',
    ELIAS: '#D4A574',
    VANCE: '#8B7355',
    DOG: '#C4956A',
    DESK: '#4A3520',
    DOOR: '#6B4423',
    LAMP: '#FFD700',
    FILES: '#708090',
    PORTAL: '#FF4444'
};
