/**
 * Trace Store — Manages the agent trace timeline.
 *
 * Stores all protocol events with timestamps.
 * Groups consecutive TOKEN events by stream_id into batches.
 * Supports filtering by event type and content search.
 */

import { create } from 'zustand';
import type { TraceEvent, TokenGroup, ServerMessage } from '../protocol/types';

type TimelineItem = TraceEvent | TokenGroup;

interface TraceStore {
  // Raw events
  events: TraceEvent[];

  // Grouped timeline items (TOKEN events batched)
  timelineItems: TimelineItem[];

  // Filters
  activeFilters: Set<string>;
  searchQuery: string;

  // Actions
  addEvent: (message: ServerMessage) => void;
  setFilter: (types: Set<string>) => void;
  setSearch: (query: string) => void;
  getEventByCallId: (callId: string) => TraceEvent | undefined;
  getEventBySeq: (seq: number) => TraceEvent | undefined;

  // Filtered view
  getFilteredItems: () => TimelineItem[];
}

function generateId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Build grouped timeline items from raw events.
 * Consecutive TOKEN events for the same stream_id are batched into TokenGroups.
 */
function buildTimelineItems(events: TraceEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let currentTokenGroup: {
    streamId: string;
    tokens: TraceEvent[];
    startTime: number;
    startSeq: number;
    totalText: string;
  } | null = null;

  const flushTokenGroup = () => {
    if (currentTokenGroup && currentTokenGroup.tokens.length > 0) {
      const lastToken = currentTokenGroup.tokens[currentTokenGroup.tokens.length - 1];
      items.push({
        id: `tg_${currentTokenGroup.startSeq}`,
        kind: 'token_group',
        streamId: currentTokenGroup.streamId,
        startSeq: currentTokenGroup.startSeq,
        endSeq: lastToken.seq,
        tokenCount: currentTokenGroup.tokens.length,
        totalText: currentTokenGroup.totalText,
        startTime: currentTokenGroup.startTime,
        endTime: lastToken.timestamp,
        durationMs: lastToken.timestamp - currentTokenGroup.startTime,
      });
    }
    currentTokenGroup = null;
  };

  for (const event of events) {
    if (event.type === 'TOKEN') {
      const tokenData = event.data as { text?: string; stream_id?: string };
      const streamId = tokenData.stream_id ?? event.streamId ?? '';

      if (currentTokenGroup && currentTokenGroup.streamId === streamId) {
        // Continue the current group
        currentTokenGroup.tokens.push(event);
        currentTokenGroup.totalText += tokenData.text ?? '';
      } else {
        // New stream or different stream — flush previous group
        flushTokenGroup();
        currentTokenGroup = {
          streamId,
          tokens: [event],
          startTime: event.timestamp,
          startSeq: event.seq,
          totalText: tokenData.text ?? '',
        };
      }
    } else {
      // Non-token event — flush any pending token group
      flushTokenGroup();
      items.push(event);
    }
  }

  // Flush final group
  flushTokenGroup();

  return items;
}

export const useTraceStore = create<TraceStore>((set, get) => ({
  events: [],
  timelineItems: [],
  activeFilters: new Set<string>(),
  searchQuery: '',

  addEvent: (message: ServerMessage) => {
    const event: TraceEvent = {
      id: generateId(),
      seq: message.seq,
      type: message.type,
      timestamp: Date.now(),
      data: message,
      streamId: 'stream_id' in message ? (message as unknown as Record<string, unknown>).stream_id as string : undefined,
      callId: 'call_id' in message ? (message as unknown as Record<string, unknown>).call_id as string : undefined,
    };

    set((state) => {
      const newEvents = [...state.events, event];
      return {
        events: newEvents,
        timelineItems: buildTimelineItems(newEvents),
      };
    });
  },

  setFilter: (types: Set<string>) => {
    set({ activeFilters: types });
  },

  setSearch: (query: string) => {
    set({ searchQuery: query });
  },

  getEventByCallId: (callId: string) => {
    return get().events.find((e) => e.callId === callId);
  },

  getEventBySeq: (seq: number) => {
    return get().events.find((e) => e.seq === seq);
  },

  getFilteredItems: () => {
    const { timelineItems, activeFilters, searchQuery } = get();
    let filtered = timelineItems;

    if (activeFilters.size > 0) {
      filtered = filtered.filter((item) => {
        if ('kind' in item && item.kind === 'token_group') {
          return activeFilters.has('TOKEN');
        }
        return activeFilters.has((item as TraceEvent).type);
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) => {
        if ('kind' in item && item.kind === 'token_group') {
          return item.totalText.toLowerCase().includes(query);
        }
        const event = item as TraceEvent;
        return JSON.stringify(event.data).toLowerCase().includes(query);
      });
    }

    return filtered;
  },
}));
