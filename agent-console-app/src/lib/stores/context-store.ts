/**
 * Context Store — Manages context snapshots with diff history.
 *
 * Stores snapshots keyed by context_id.
 * Maintains a history array per context_id for the scrubber.
 * Computes diffs between consecutive snapshots.
 */

import { create } from 'zustand';
import type { ContextSnapshot, DiffEntry } from '../protocol/types';
import { computeDiff } from '../utils/json-diff';

interface ContextStore {
  // State: context_id → array of snapshots (history)
  contexts: Map<string, ContextSnapshot[]>;

  // Currently selected context_id
  selectedContextId: string | null;

  // Current history index for the scrubber (per context_id)
  scrubberIndex: Map<string, number>;

  // Actions
  addSnapshot: (
    contextId: string,
    seq: number,
    data: Record<string, unknown>
  ) => void;
  selectContext: (contextId: string | null) => void;
  setScrubberIndex: (contextId: string, index: number) => void;

  // Derived
  getCurrentSnapshot: () => ContextSnapshot | null;
  getHistoryLength: (contextId: string) => number;
  getSnapshotAtIndex: (contextId: string, index: number) => ContextSnapshot | null;
}

export const useContextStore = create<ContextStore>((set, get) => ({
  contexts: new Map(),
  selectedContextId: null,
  scrubberIndex: new Map(),

  addSnapshot: (contextId, seq, data) => {
    set((state) => {
      const newContexts = new Map(state.contexts);
      const history = [...(newContexts.get(contextId) ?? [])];

      // Compute diff against previous snapshot
      let diff: DiffEntry[] | null = null;
      if (history.length > 0) {
        const prevSnapshot = history[history.length - 1];
        diff = computeDiff(prevSnapshot.data, data);
      }

      const snapshot: ContextSnapshot = {
        contextId,
        seq,
        data,
        timestamp: Date.now(),
        diff,
      };

      history.push(snapshot);
      newContexts.set(contextId, history);

      // Auto-select first context, update scrubber to latest
      const newScrubberIndex = new Map(state.scrubberIndex);
      newScrubberIndex.set(contextId, history.length - 1);

      return {
        contexts: newContexts,
        selectedContextId: state.selectedContextId ?? contextId,
        scrubberIndex: newScrubberIndex,
      };
    });
  },

  selectContext: (contextId) => {
    set({ selectedContextId: contextId });
  },

  setScrubberIndex: (contextId, index) => {
    set((state) => {
      const newScrubberIndex = new Map(state.scrubberIndex);
      newScrubberIndex.set(contextId, index);
      return { scrubberIndex: newScrubberIndex };
    });
  },

  getCurrentSnapshot: () => {
    const { contexts, selectedContextId, scrubberIndex } = get();
    if (!selectedContextId) return null;
    const history = contexts.get(selectedContextId);
    if (!history || history.length === 0) return null;
    const index = scrubberIndex.get(selectedContextId) ?? history.length - 1;
    return history[index] ?? null;
  },

  getHistoryLength: (contextId) => {
    return get().contexts.get(contextId)?.length ?? 0;
  },

  getSnapshotAtIndex: (contextId, index) => {
    const history = get().contexts.get(contextId);
    if (!history) return null;
    return history[index] ?? null;
  },
}));
