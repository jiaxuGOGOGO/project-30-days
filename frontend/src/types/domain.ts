export type UserRole = 'ACTIVE' | 'WATCHER' | 'OBSERVER';

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

/**
 * Progressive Trust Reveal terminology:
 * - COOPERATE = STAY (留下)
 * - DEFECT = PAUSE (暂停)
 */
export type Day30Choice = 'DEFECT' | 'COOPERATE';
export type Day30Outcome = 'LEGACY' | 'ASH' | 'PENDING' | 'EXTENSION' | 'COOLDOWN';

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
  /** ISO timestamp when extension period ends (7 days) */
  extensionEndsAt?: string;
  /** ISO timestamp when cooldown period ends (14 days) */
  cooldownEndsAt?: string;
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

// --- P2: Hourglass Freeze Types ---

export interface HourglassFreezeStatus {
  userId: string;
  connectionId: string;
  freezeRemaining: number;
  frozenToday: boolean;
  partnerNotified: boolean;
}

// --- P2: Observer Types ---

export type BlessingType = 'COURAGE' | 'PATIENCE' | 'TRUST' | 'HOPE';

export interface ObserverDailyReward {
  userId: string;
  fragmentsEarned: number;
  totalFragments: number;
  message: string;
}

// --- P2: Season Types ---

export interface SeasonInfo {
  seasonNumber: number;
  theme: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

// --- P2: Stardust Ticket (Redesigned as Growth Record) ---

export interface StardustTicketData {
  outcome: 'LEGACY' | 'ASH';
  participatedDays: number;
  echoCount: number;
  growthTags: string[];
  highlightAnswers: string[];
  soulSummary: string | null;
}

// --- P1: Collision Confirmation ---

export interface CollisionConfirmation {
  selfFragment: LimboUserFragment;
  otherFragment: LimboUserFragment;
  confirmed: boolean;
}
