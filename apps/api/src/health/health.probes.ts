export interface DependencyProbe {
  check(): Promise<void>;
}

export const DATABASE_PROBE = Symbol("DATABASE_PROBE");
export const QUEUE_PROBE = Symbol("QUEUE_PROBE");
