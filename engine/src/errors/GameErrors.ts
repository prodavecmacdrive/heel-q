export class GameError extends Error {
    public readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = new.target.name;
        this.cause = cause;
        Object.setPrototypeOf(this, new.target.prototype);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class InitializationError extends GameError {
    constructor(message: string, cause?: unknown) {
        super(message, cause);
    }
}

export class ResourceNotFoundError extends GameError {
    constructor(resource: string, details?: string, cause?: unknown) {
        super(`Resource not found: ${resource}${details ? ` (${details})` : ''}`, cause);
    }
}

export class WorldLoadError extends GameError {
    constructor(cause?: unknown) {
        super('Failed to load world data', cause);
    }
}

export class RoomNotFoundError extends ResourceNotFoundError {
    constructor(roomId: string) {
        super(`room:${roomId}`);
    }
}
