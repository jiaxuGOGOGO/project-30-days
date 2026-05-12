export type UserRole = 'ACTIVE' | 'WATCHER';

export interface LimboUserFragment {
  id: string;
  displayName: string;
  role: UserRole;
  firePoints: number;
  shadowVideoUrl?: string;
  tint?: string;
  seed?: number;
}

export interface GatingVideoSource {
  src: string;
  poster?: string;
  connectedDays: number;
}

export interface PhysicsRuntimeMetrics {
  width: number;
  height: number;
  pixelRatio: number;
  lastCollisionAt: number;
}
