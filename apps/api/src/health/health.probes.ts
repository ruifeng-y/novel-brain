export interface DependencyProbe {
  check(): Promise<void>;
  isConfigured?(): boolean;
}

export const DATABASE_PROBE = Symbol("DATABASE_PROBE");
export const QUEUE_PROBE = Symbol("QUEUE_PROBE");
export const STORAGE_PROBE = Symbol("STORAGE_PROBE");
