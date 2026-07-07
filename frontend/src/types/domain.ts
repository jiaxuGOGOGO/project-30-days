export type UserRole = 'ACTIVE' | 'WATCHER';

export type RevealLevel = 'SILHOUETTE' | 'FROSTED' | 'NEAR' | 'FULL';

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
  /** Server-provided signed URL at the appropriate reveal level */
  src: string;
  /** Server-determined reveal level */
  revealLevel: RevealLevel;
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

// --- Phase 0: Daily Echo Types ---

export interface DailyEchoPrompt {
  id: string;
  dayNumber: number;
  promptText: string;
  myAnswer: string | null;
  partnerAnswer: string | null;
  bothAnswered: boolean;
  canReveal: boolean;
}

// --- Phase 0: Boarding Types ---

export type RoomStatus = 'BOARDING' | 'RECRUITING' | 'RUNNING' | 'DESTROYED';

export interface BoardingStatus {
  roomId: string;
  status: RoomStatus;
  currentCount: number;
  minUsers: number;
  maxUsers: number;
  scheduledAt: string | null;
  estimatedWaitMessage: string;
}
