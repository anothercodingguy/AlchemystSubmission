/**
 * Connection Store — Tracks WebSocket connection state for UI display.
 */

import { create } from 'zustand';
import type { ConnectionState } from '../protocol/types';

interface ConnectionStore {
  state: ConnectionState;
  reconnectAttempt: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastProcessedSeq: number;
  bufferedCount: number;

  // Actions
  setState: (state: ConnectionState) => void;
  setReconnectAttempt: (attempt: number) => void;
  setLastProcessedSeq: (seq: number) => void;
  setBufferedCount: (count: number) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  state: 'DISCONNECTED',
  reconnectAttempt: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastProcessedSeq: 0,
  bufferedCount: 0,

  setState: (connectionState) => {
    set((prev) => ({
      state: connectionState,
      lastConnectedAt:
        connectionState === 'CONNECTED'
          ? Date.now()
          : prev.lastConnectedAt,
      lastDisconnectedAt:
        connectionState === 'RECONNECTING' || connectionState === 'DISCONNECTED'
          ? Date.now()
          : prev.lastDisconnectedAt,
    }));
  },

  setReconnectAttempt: (attempt) => set({ reconnectAttempt: attempt }),
  setLastProcessedSeq: (seq) => set({ lastProcessedSeq: seq }),
  setBufferedCount: (count) => set({ bufferedCount: count }),
}));
