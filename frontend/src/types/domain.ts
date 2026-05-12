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

export type Day30Choice = 'DEFECT' | 'COOPERATE';
export type Day30Outcome = 'LEGACY' | 'ASH' | 'PENDING';

export interface Day30JudgmentPayload {
  connectionId: string;
  userId: string;
  choice: Day30Choice;
  heldMs: number;
}

export interface Day30JudgmentResult {
  outcome: Day30Outcome;
  msgCount: number;
  ticketTitle?: string;
  ticketPath?: string;
}
