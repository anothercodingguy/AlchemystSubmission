/**
 * JSON Diff Engine — Unit Tests
 */

import { computeDiff, formatPath } from '../src/lib/utils/json-diff';

describe('computeDiff', () => {
  test('identical objects → no diff', () => {
    const obj = { a: 1, b: 'hello', c: [1, 2, 3] };
    const result = computeDiff(obj, { ...obj });
    expect(result).toHaveLength(0);
  });

  test('added key', () => {
    const result = computeDiff({ a: 1 }, { a: 1, b: 2 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: ['b'],
      type: 'added',
      newValue: 2,
    });
  });

  test('removed key', () => {
    const result = computeDiff({ a: 1, b: 2 }, { a: 1 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: ['b'],
      type: 'removed',
      oldValue: 2,
    });
  });

  test('changed value', () => {
    const result = computeDiff({ a: 1 }, { a: 2 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: ['a'],
      type: 'changed',
      oldValue: 1,
      newValue: 2,
    });
  });

  test('nested object changes', () => {
    const old = { user: { name: 'Alice', age: 30 } };
    const next = { user: { name: 'Bob', age: 30 } };
    const result = computeDiff(old, next);
    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual(['user', 'name']);
    expect(result[0].type).toBe('changed');
    expect(result[0].oldValue).toBe('Alice');
    expect(result[0].newValue).toBe('Bob');
  });

  test('deeply nested addition', () => {
    const old = { a: { b: { c: 1 } } };
    const next = { a: { b: { c: 1, d: 2 } } };
    const result = computeDiff(old, next);
    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual(['a', 'b', 'd']);
    expect(result[0].type).toBe('added');
  });

  test('array element added', () => {
    const result = computeDiff(
      { items: [1, 2] },
      { items: [1, 2, 3] }
    );
    const added = result.find(d => d.type === 'added');
    expect(added).toBeTruthy();
    expect(added!.path).toEqual(['items', '2']);
    expect(added!.newValue).toBe(3);
  });

  test('array element removed', () => {
    const result = computeDiff(
      { items: [1, 2, 3] },
      { items: [1, 2] }
    );
    const removed = result.find(d => d.type === 'removed');
    expect(removed).toBeTruthy();
    expect(removed!.path).toEqual(['items', '2']);
    expect(removed!.oldValue).toBe(3);
  });

  test('array element changed', () => {
    const result = computeDiff(
      { items: [1, 2, 3] },
      { items: [1, 99, 3] }
    );
    const changed = result.find(d => d.type === 'changed');
    expect(changed).toBeTruthy();
    expect(changed!.path).toEqual(['items', '1']);
    expect(changed!.oldValue).toBe(2);
    expect(changed!.newValue).toBe(99);
  });

  test('type change (string to number)', () => {
    const result = computeDiff({ a: 'hello' }, { a: 42 });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('changed');
  });

  test('null to value', () => {
    const result = computeDiff({ a: null }, { a: 'hello' });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('added');
  });

  test('value to null', () => {
    const result = computeDiff({ a: 'hello' }, { a: null });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('removed');
  });

  test('multiple changes at once', () => {
    const old = { a: 1, b: 2, c: 3, d: 4 };
    const next = { a: 1, b: 20, c: 3, e: 5 };
    const result = computeDiff(old, next);

    const types = result.map(d => `${d.path.join('.')}:${d.type}`).sort();
    expect(types).toEqual(['b:changed', 'd:removed', 'e:added']);
  });

  test('empty objects', () => {
    expect(computeDiff({}, {})).toHaveLength(0);
  });

  test('both empty to populated', () => {
    const result = computeDiff({}, { a: 1, b: 2 });
    expect(result).toHaveLength(2);
    expect(result.every(d => d.type === 'added')).toBe(true);
  });

  test('handles large objects without stack overflow', () => {
    const old: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    for (let i = 0; i < 1000; i++) {
      old[`key_${i}`] = { nested: { deep: { value: i } } };
      next[`key_${i}`] = { nested: { deep: { value: i } } };
    }
    // Change one key
    (next['key_500'] as Record<string, unknown>).nested = { deep: { value: 999 } };

    const result = computeDiff(old, next);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const changed = result.find(d => d.path[0] === 'key_500');
    expect(changed).toBeTruthy();
  });
});

describe('formatPath', () => {
  test('empty path → "(root)"', () => {
    expect(formatPath([])).toBe('(root)');
  });

  test('simple path', () => {
    expect(formatPath(['user', 'name'])).toBe('user.name');
  });

  test('array index', () => {
    expect(formatPath(['items', '0'])).toBe('items[0]');
  });

  test('nested array', () => {
    expect(formatPath(['users', '2', 'addresses', '0', 'city'])).toBe(
      'users[2].addresses[0].city'
    );
  });
});
