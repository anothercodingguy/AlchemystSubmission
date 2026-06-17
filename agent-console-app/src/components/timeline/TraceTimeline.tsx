'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTraceStore } from '@/lib/stores/trace-store';
import type { TraceEvent, TokenGroup } from '@/lib/protocol/types';
import styles from './TraceTimeline.module.css';

const EVENT_TYPES = ['TOKEN', 'TOOL_CALL', 'TOOL_RESULT', 'CONTEXT_SNAPSHOT', 'PING', 'STREAM_END', 'ERROR'] as const;

// ─── Filter Bar ─────────────────────────────────────────────────────────────

interface FilterBarProps {
  activeFilters: Set<string>;
  onToggleFilter: (type: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

function FilterBar({ activeFilters, onToggleFilter, searchQuery, onSearchChange }: FilterBarProps) {
  return (
    <div className={styles.filterBar}>
      {EVENT_TYPES.map((type) => (
        <button
          key={type}
          className={`${styles.filterChip} ${activeFilters.has(type) ? styles.active : ''}`}
          data-type={type}
          onClick={() => onToggleFilter(type)}
        >
          {type.replace('_', ' ')}
        </button>
      ))}
      <input
        className={styles.searchInput}
        type="text"
        placeholder="Search events..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        id="timeline-search"
      />
    </div>
  );
}

// ─── Token Group Row ────────────────────────────────────────────────────────

interface TokenGroupRowProps {
  group: TokenGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onClick: () => void;
}

function TokenGroupRow({ group, isExpanded, onToggle, onClick }: TokenGroupRowProps) {
  const durationStr = group.durationMs < 1000
    ? `${group.durationMs}ms`
    : `${(group.durationMs / 1000).toFixed(1)}s`;

  return (
    <>
      <div
        className={styles.tokenGroupRow}
        onClick={() => { onClick(); onToggle(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
      >
        <span className={styles.eventBadge} data-type="TOKEN">
          TOKEN
        </span>
        <div className={styles.eventDetails}>
          <span className={styles.tokenGroupSummary}>
            Streamed {group.tokenCount} tokens{' '}
            <span className={styles.tokenGroupDuration}>({durationStr})</span>
          </span>
        </div>
        <span className={styles.eventSeq}>
          seq {group.startSeq}–{group.endSeq}
        </span>
      </div>
      {isExpanded && (
        <div className={styles.tokenGroupExpanded}>
          {group.totalText}
        </div>
      )}
    </>
  );
}

// ─── Event Row ──────────────────────────────────────────────────────────────

interface EventRowProps {
  event: TraceEvent;
  isHighlighted: boolean;
  onClick: () => void;
  previousEvent: TraceEvent | null;
}

function EventRow({ event, isHighlighted, onClick, previousEvent }: EventRowProps) {
  const getSummary = (): string => {
    switch (event.type) {
      case 'TOOL_CALL': {
        const data = event.data as { tool_name?: string };
        return `Calling ${data.tool_name ?? 'tool'}`;
      }
      case 'TOOL_RESULT': {
        const data = event.data as { call_id?: string };
        return `Result for ${data.call_id ?? 'unknown'}`;
      }
      case 'CONTEXT_SNAPSHOT': {
        const data = event.data as { context_id?: string };
        return `Context ${data.context_id ?? ''}`;
      }
      case 'PING': {
        const data = event.data as { challenge?: string };
        return `Challenge: ${data.challenge || '(empty)'}`;
      }
      case 'STREAM_END':
        return 'Stream completed';
      case 'ERROR': {
        const data = event.data as { code?: string; message?: string };
        return `${data.code}: ${data.message}`;
      }
      default:
        return '';
    }
  };

  // Show connector for TOOL_RESULT that follows TOOL_CALL
  const showConnector = event.type === 'TOOL_RESULT' &&
    previousEvent?.type === 'TOOL_CALL' &&
    previousEvent.callId === event.callId;

  return (
    <>
      {showConnector && (
        <div className={styles.toolCallConnector} />
      )}
      <div
        className={`${styles.eventRow} ${isHighlighted ? styles.highlighted : ''}`}
        onClick={onClick}
        id={`trace-event-${event.seq}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      >
        <span className={styles.eventBadge} data-type={event.type}>
          {event.type === 'CONTEXT_SNAPSHOT' ? 'CONTEXT' : event.type.replace('_', ' ')}
        </span>
        <div className={styles.eventDetails}>
          <span className={styles.eventSummary}>{getSummary()}</span>
        </div>
        <span className={styles.eventSeq}>seq {event.seq}</span>
      </div>
    </>
  );
}

// ─── Trace Timeline ─────────────────────────────────────────────────────────

interface TraceTimelineProps {
  highlightedCallId?: string | null;
  onClickEvent?: (event: TraceEvent) => void;
}

export function TraceTimeline({ highlightedCallId, onClickEvent }: TraceTimelineProps) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(EVENT_TYPES));
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

  const setFilter = useTraceStore((s) => s.setFilter);
  const setSearch = useTraceStore((s) => s.setSearch);
  const getFilteredItems = useTraceStore((s) => s.getFilteredItems);

  // Update store filters when local state changes
  useEffect(() => {
    setFilter(activeFilters);
  }, [activeFilters, setFilter]);

  useEffect(() => {
    setSearch(searchQuery);
  }, [searchQuery, setSearch]);

  const filteredItems = getFilteredItems();

  // Auto-scroll timeline
  useEffect(() => {
    if (isAutoScrolling.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filteredItems.length]);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 60;
  };

  const handleToggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleToggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Scroll to highlighted call_id
  useEffect(() => {
    if (highlightedCallId && listRef.current) {
      // Find the event with this call_id
      const events = useTraceStore.getState().events;
      const event = events.find((e) => e.callId === highlightedCallId);
      if (event) {
        const element = document.getElementById(`trace-event-${event.seq}`);
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightedCallId]);

  let prevTraceEvent: TraceEvent | null = null;

  return (
    <div className={styles.timeline} id="trace-timeline">
      <FilterBar
        activeFilters={activeFilters}
        onToggleFilter={handleToggleFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
      <div className={styles.eventList} ref={listRef} onScroll={handleScroll}>
        {filteredItems.length === 0 && (
          <div className={styles.emptyTimeline}>
            No events yet
          </div>
        )}
        {filteredItems.map((item) => {
          if ('kind' in item && item.kind === 'token_group') {
            return (
              <TokenGroupRow
                key={item.id}
                group={item}
                isExpanded={expandedGroups.has(item.id)}
                onToggle={() => handleToggleGroup(item.id)}
                onClick={() => {}}
              />
            );
          }

          const event = item as TraceEvent;
          const isHighlighted = event.callId === highlightedCallId;
          const prev = prevTraceEvent;
          prevTraceEvent = event;

          return (
            <EventRow
              key={event.id}
              event={event}
              isHighlighted={isHighlighted}
              previousEvent={prev}
              onClick={() => onClickEvent?.(event)}
            />
          );
        })}
      </div>
    </div>
  );
}
