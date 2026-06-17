/**
 * JSON Diff Engine — Deep diff for arbitrary nested JSON objects.
 *
 * Outputs a flat list of DiffEntry objects describing what changed.
 * Uses iterative approach with an explicit stack to handle large objects
 * (500KB+) without call stack overflow.
 *
 * Performance considerations:
 * - Short-circuits on reference equality (===)
 * - Short-circuits on identical primitive values
 * - Array comparison by index (not element matching)
 */

import type { DiffEntry, DiffChangeType } from '../protocol/types';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface StackEntry {
  path: string[];
  oldVal: unknown;
  newVal: unknown;
}

/**
 * Compute the diff between two JSON objects.
 *
 * @returns Array of DiffEntry describing added, removed, and changed paths.
 *          Returns empty array if objects are identical.
 */
export function computeDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const stack: StackEntry[] = [{ path: [], oldVal: oldObj, newVal: newObj }];

  while (stack.length > 0) {
    const entry = stack.pop()!;
    const { path, oldVal, newVal } = entry;

    // Reference equality → no diff
    if (oldVal === newVal) continue;

    // Both null/undefined
    if (oldVal == null && newVal == null) continue;

    // Type mismatch or one is null
    if (
      oldVal == null ||
      newVal == null ||
      typeof oldVal !== typeof newVal ||
      Array.isArray(oldVal) !== Array.isArray(newVal)
    ) {
      diffs.push({
        path,
        type: oldVal == null ? 'added' : newVal == null ? 'removed' : 'changed',
        oldValue: oldVal,
        newValue: newVal,
      });
      continue;
    }

    // Both arrays
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      const maxLen = Math.max(oldVal.length, newVal.length);
      for (let i = maxLen - 1; i >= 0; i--) {
        const childPath = [...path, String(i)];
        if (i >= oldVal.length) {
          diffs.push({ path: childPath, type: 'added', newValue: newVal[i] });
        } else if (i >= newVal.length) {
          diffs.push({ path: childPath, type: 'removed', oldValue: oldVal[i] });
        } else {
          stack.push({ path: childPath, oldVal: oldVal[i], newVal: newVal[i] });
        }
      }
      continue;
    }

    // Both objects
    if (typeof oldVal === 'object' && typeof newVal === 'object') {
      const oldRecord = oldVal as Record<string, unknown>;
      const newRecord = newVal as Record<string, unknown>;
      const allKeys = Array.from(new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]));

      for (const key of allKeys) {
        const childPath = [...path, key];
        const hasOld = key in oldRecord;
        const hasNew = key in newRecord;

        if (hasOld && !hasNew) {
          diffs.push({ path: childPath, type: 'removed', oldValue: oldRecord[key] });
        } else if (!hasOld && hasNew) {
          diffs.push({ path: childPath, type: 'added', newValue: newRecord[key] });
        } else {
          stack.push({ path: childPath, oldVal: oldRecord[key], newVal: newRecord[key] });
        }
      }
      continue;
    }

    // Primitives that differ
    if (oldVal !== newVal) {
      diffs.push({ path, type: 'changed', oldValue: oldVal, newValue: newVal });
    }
  }

  return diffs;
}

/**
 * Format a path array as a dot-notation string.
 * Array indices are shown as [n].
 */
export function formatPath(path: string[]): string {
  if (path.length === 0) return '(root)';
  return path.reduce((acc, key, i) => {
    if (/^\d+$/.test(key)) {
      return `${acc}[${key}]`;
    }
    return i === 0 ? key : `${acc}.${key}`;
  }, '');
}

/**
 * Flatten a nested object into path → value pairs.
 * Used for the tree view component.
 */
export function flattenObject(
  obj: Record<string, unknown>,
  maxDepth = 10
): Array<{ path: string[]; value: unknown; isExpandable: boolean }> {
  const result: Array<{ path: string[]; value: unknown; isExpandable: boolean }> = [];
  const stack: Array<{ path: string[]; value: unknown; depth: number }> = [
    { path: [], value: obj, depth: 0 },
  ];

  while (stack.length > 0) {
    const { path, value, depth } = stack.pop()!;

    if (depth >= maxDepth || value === null || typeof value !== 'object') {
      result.push({ path, value, isExpandable: false });
      continue;
    }

    const isArray = Array.isArray(value);
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);

    result.push({
      path,
      value: isArray ? `Array(${entries.length})` : `Object(${entries.length} keys)`,
      isExpandable: entries.length > 0,
    });

    // Push children in reverse order so they come out in correct order
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, val] = entries[i];
      stack.push({ path: [...path, key], value: val, depth: depth + 1 });
    }
  }

  return result;
}
