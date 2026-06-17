'use client';

import { useState, useMemo, useCallback } from 'react';
import { useContextStore } from '@/lib/stores/context-store';
import type { DiffEntry } from '@/lib/protocol/types';
import styles from './ContextInspector.module.css';

// ─── JSON Tree Node (Lazy, Virtualized-Friendly) ────────────────────────────

interface TreeNodeProps {
  keyName: string;
  value: unknown;
  depth: number;
  diffEntries: Map<string, DiffEntry>;
  currentPath: string[];
  maxInitialDepth?: number;
}

function TreeNode({ keyName, value, depth, diffEntries, currentPath, maxInitialDepth = 2 }: TreeNodeProps) {
  const pathStr = currentPath.join('.');
  const diff = diffEntries.get(pathStr);
  const [isExpanded, setIsExpanded] = useState(depth < maxInitialDepth);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const entries = isObject
    ? Object.entries(value as Record<string, unknown>)
    : [];

  const diffClass = diff
    ? diff.type === 'added' ? styles.diffAdded
      : diff.type === 'removed' ? styles.diffRemoved
        : diff.type === 'changed' ? styles.diffChanged
          : ''
    : '';

  const getValueDisplay = (): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value.length > 100 ? value.substring(0, 100) + '...' : value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (isArray) return `Array(${(value as unknown[]).length})`;
    if (isObject) return `{${entries.length} keys}`;
    return String(value);
  };

  const getValueClass = (): string => {
    if (value === null) return styles.null;
    if (typeof value === 'string') return styles.string;
    if (typeof value === 'number') return styles.number;
    if (typeof value === 'boolean') return styles.boolean;
    return '';
  };

  return (
    <div className={styles.treeNode}>
      <div className={`${styles.treeNodeRow} ${diffClass}`}>
        {isObject && entries.length > 0 ? (
          <span
            className={styles.treeToggle}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className={styles.treeToggle} />
        )}
        <span className={styles.treeKey}>{keyName}</span>
        <span className={styles.treeColon}>:</span>
        {(!isObject || !isExpanded) && (
          <span className={`${styles.treeValue} ${getValueClass()}`}>
            {getValueDisplay()}
          </span>
        )}
        {diff && diff.type === 'changed' && (
          <span className={`${styles.treeValue} ${styles.null}`}>
            {' ← was: '}
            {JSON.stringify(diff.oldValue)?.substring(0, 50)}
          </span>
        )}
      </div>
      {isObject && isExpanded && entries.length > 0 && (
        <div className={styles.treeChildren}>
          {entries.map(([k, v]) => (
            <TreeNode
              key={k}
              keyName={k}
              value={v}
              depth={depth + 1}
              diffEntries={diffEntries}
              currentPath={[...currentPath, k]}
              maxInitialDepth={maxInitialDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Diff Summary ───────────────────────────────────────────────────────────

function DiffSummary({ diffs }: { diffs: DiffEntry[] }) {
  const added = diffs.filter(d => d.type === 'added').length;
  const removed = diffs.filter(d => d.type === 'removed').length;
  const changed = diffs.filter(d => d.type === 'changed').length;

  if (added === 0 && removed === 0 && changed === 0) {
    return (
      <div className={styles.diffSummary}>
        <span style={{ color: 'var(--text-muted)' }}>No changes</span>
      </div>
    );
  }

  return (
    <div className={styles.diffSummary}>
      {added > 0 && (
        <div className={styles.diffCount}>
          <div className={`${styles.diffDot} ${styles.added}`} />
          {added} added
        </div>
      )}
      {removed > 0 && (
        <div className={styles.diffCount}>
          <div className={`${styles.diffDot} ${styles.removed}`} />
          {removed} removed
        </div>
      )}
      {changed > 0 && (
        <div className={styles.diffCount}>
          <div className={`${styles.diffDot} ${styles.changed}`} />
          {changed} changed
        </div>
      )}
    </div>
  );
}

// ─── Context Inspector ──────────────────────────────────────────────────────

export function ContextInspector() {
  const [activeTab, setActiveTab] = useState<'data' | 'diff'>('data');
  const contexts = useContextStore((s) => s.contexts);
  const selectedContextId = useContextStore((s) => s.selectedContextId);
  const scrubberIndex = useContextStore((s) => s.scrubberIndex);
  const selectContext = useContextStore((s) => s.selectContext);
  const setScrubberIndex = useContextStore((s) => s.setScrubberIndex);
  const getCurrentSnapshot = useContextStore((s) => s.getCurrentSnapshot);

  const contextIds = useMemo(() => Array.from(contexts.keys()), [contexts]);
  const currentSnapshot = getCurrentSnapshot();
  const historyLength = selectedContextId
    ? (contexts.get(selectedContextId)?.length ?? 0)
    : 0;
  const currentIndex = selectedContextId
    ? (scrubberIndex.get(selectedContextId) ?? 0)
    : 0;

  // Build diff entry lookup map for the tree view
  const diffMap = useMemo(() => {
    const map = new Map<string, DiffEntry>();
    if (currentSnapshot?.diff) {
      for (const entry of currentSnapshot.diff) {
        map.set(entry.path.join('.'), entry);
      }
    }
    return map;
  }, [currentSnapshot]);

  const handleScrub = useCallback((index: number) => {
    if (selectedContextId) {
      setScrubberIndex(selectedContextId, index);
    }
  }, [selectedContextId, setScrubberIndex]);

  if (contextIds.length === 0) {
    return (
      <div className={styles.inspector} id="context-inspector">
        <div className={styles.noContext}>
          No context snapshots received yet
        </div>
      </div>
    );
  }

  return (
    <div className={styles.inspector} id="context-inspector">
      {/* Context selector */}
      {contextIds.length > 1 && (
        <div className={styles.contextSelector}>
          <select
            className={styles.contextSelect}
            value={selectedContextId ?? ''}
            onChange={(e) => selectContext(e.target.value)}
          >
            {contextIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'data' ? styles.active : ''}`}
          onClick={() => setActiveTab('data')}
        >
          Data
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'diff' ? styles.active : ''}`}
          onClick={() => setActiveTab('diff')}
        >
          Diff {currentSnapshot?.diff ? `(${currentSnapshot.diff.length})` : ''}
        </button>
      </div>

      {/* History scrubber */}
      {historyLength > 1 && (
        <div className={styles.scrubber}>
          <span className={styles.scrubberLabel}>
            {currentIndex + 1} / {historyLength}
          </span>
          <input
            className={styles.scrubberSlider}
            type="range"
            min={0}
            max={historyLength - 1}
            value={currentIndex}
            onChange={(e) => handleScrub(Number(e.target.value))}
            id="context-scrubber"
          />
          <div className={styles.scrubberButtons}>
            <button
              className={styles.scrubberBtn}
              onClick={() => handleScrub(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
            >
              ◀
            </button>
            <button
              className={styles.scrubberBtn}
              onClick={() => handleScrub(Math.min(historyLength - 1, currentIndex + 1))}
              disabled={currentIndex === historyLength - 1}
            >
              ▶
            </button>
          </div>
        </div>
      )}

      {/* Diff summary */}
      {activeTab === 'diff' && currentSnapshot?.diff && (
        <DiffSummary diffs={currentSnapshot.diff} />
      )}

      {/* Tree view */}
      <div className={styles.treeView}>
        {currentSnapshot && (
          <TreeNode
            keyName="context"
            value={currentSnapshot.data}
            depth={0}
            diffEntries={activeTab === 'diff' ? diffMap : new Map()}
            currentPath={[]}
            maxInitialDepth={activeTab === 'diff' ? 10 : 2}
          />
        )}
      </div>
    </div>
  );
}
