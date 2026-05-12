import { create } from 'zustand';
import type { LimboUserFragment, UserRole } from '../types/domain';

export interface SessionState {
  currentUserId: string;
  currentRole: UserRole;
  connectedDays: number;
  fragments: LimboUserFragment[];
  setRole: (role: UserRole) => void;
  setConnectedDays: (days: number) => void;
  setFragments: (fragments: LimboUserFragment[]) => void;
}

const initialFragments: LimboUserFragment[] = [
  { id: 'u-shadow-001', displayName: 'VOID-01', role: 'ACTIVE', firePoints: 3, tint: '#f8fafc', seed: 11 },
  { id: 'u-shadow-002', displayName: 'VOID-02', role: 'WATCHER', firePoints: 0, tint: '#94a3b8', seed: 23 },
  { id: 'u-shadow-003', displayName: 'VOID-03', role: 'ACTIVE', firePoints: 2, tint: '#e5e7eb', seed: 37 },
  { id: 'u-shadow-004', displayName: 'VOID-04', role: 'ACTIVE', firePoints: 1, tint: '#cbd5e1', seed: 41 }
];

const clampConnectedDays = (days: number): number => {
  if (!Number.isFinite(days)) {
    return 1;
  }

  return Math.min(30, Math.max(1, Math.trunc(days)));
};

export const useSessionStore = create<SessionState>((set) => ({
  currentUserId: 'u-shadow-001',
  currentRole: 'ACTIVE',
  connectedDays: 9,
  fragments: initialFragments,
  setRole: (role) => set({ currentRole: role }),
  setConnectedDays: (days) => set({ connectedDays: clampConnectedDays(days) }),
  setFragments: (fragments) => set({ fragments })
}));
