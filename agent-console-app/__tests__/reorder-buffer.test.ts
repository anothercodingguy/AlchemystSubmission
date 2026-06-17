/**
 * ReorderBuffer — Unit Tests
 *
 * Tests cover:
 * - Empty buffer
 * - Single element
 * - In-order (pass-through)
 * - Fully reversed sequence
 * - Duplicates
 * - Gaps that get filled later
 * - Mixed duplicates + out-of-order
 * - Large sequences
 */

import { ReorderBuffer } from '../src/lib/protocol/reorder-buffer';
import type { ServerMessage, TokenMessage } from '../src/lib/protocol/types';

/** Helper to create a TOKEN message with a given seq */
function makeToken(seq: number, text = `token_${seq}`): TokenMessage {
  return {
    type: 'TOKEN',
    seq,
    stream_id: 's_test',
    text,
  };
}

describe('ReorderBuffer', () => {
  let buffer: ReorderBuffer;

  beforeEach(() => {
    buffer = new ReorderBuffer();
  });

  // ─── Basic Operations ──────────────────────────────────────────────────

  test('empty buffer has lastProcessedSeq = 0', () => {
    expect(buffer.lastProcessedSeq).toBe(0);
    expect(buffer.bufferedCount).toBe(0);
  });

  test('single message at seq=1 drains immediately', () => {
    const result = buffer.insert(makeToken(1));
    expect(result).toHaveLength(1);
    expect(result[0].seq).toBe(1);
    expect(buffer.bufferedCount).toBe(0);
  });

  test('in-order messages pass through immediately', () => {
    const r1 = buffer.insert(makeToken(1));
    const r2 = buffer.insert(makeToken(2));
    const r3 = buffer.insert(makeToken(3));

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);
    expect(r1[0].seq).toBe(1);
    expect(r2[0].seq).toBe(2);
    expect(r3[0].seq).toBe(3);
    expect(buffer.bufferedCount).toBe(0);
  });

  // ─── Out of Order ─────────────────────────────────────────────────────

  test('out-of-order: seq 2 arrives before seq 1', () => {
    const r2 = buffer.insert(makeToken(2));
    expect(r2).toHaveLength(0); // Can't drain, waiting for seq 1
    expect(buffer.bufferedCount).toBe(1);

    const r1 = buffer.insert(makeToken(1));
    // Should drain both 1 and 2
    expect(r1).toHaveLength(2);
    expect(r1[0].seq).toBe(1);
    expect(r1[1].seq).toBe(2);
    expect(buffer.bufferedCount).toBe(0);
  });

  test('fully reversed sequence', () => {
    buffer.insert(makeToken(5));
    buffer.insert(makeToken(4));
    buffer.insert(makeToken(3));
    buffer.insert(makeToken(2));
    expect(buffer.bufferedCount).toBe(4);

    const result = buffer.insert(makeToken(1));
    expect(result).toHaveLength(5);
    expect(result.map(m => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(buffer.bufferedCount).toBe(0);
  });

  test('gap in sequence: 1, 2, 4, 5 then 3 fills the gap', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    const r4 = buffer.insert(makeToken(4));
    expect(r4).toHaveLength(0); // Waiting for 3

    const r5 = buffer.insert(makeToken(5));
    expect(r5).toHaveLength(0); // Still waiting for 3

    expect(buffer.bufferedCount).toBe(2); // 4 and 5 buffered

    const r3 = buffer.insert(makeToken(3));
    expect(r3).toHaveLength(3); // Drains 3, 4, 5
    expect(r3.map(m => m.seq)).toEqual([3, 4, 5]);
  });

  // ─── Deduplication ─────────────────────────────────────────────────────

  test('duplicate seq is ignored', () => {
    const r1 = buffer.insert(makeToken(1));
    expect(r1).toHaveLength(1);

    const r1dup = buffer.insert(makeToken(1, 'duplicate'));
    expect(r1dup).toHaveLength(0);
  });

  test('duplicate seq in buffer (before drain) is handled', () => {
    buffer.insert(makeToken(2));
    buffer.insert(makeToken(2)); // Duplicate while buffered

    const result = buffer.insert(makeToken(1));
    // Should get 1 and 2 (only once)
    expect(result).toHaveLength(2);
    expect(result.map(m => m.seq)).toEqual([1, 2]);
  });

  test('mixed duplicates and out-of-order', () => {
    buffer.insert(makeToken(3));
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(3)); // dup
    buffer.insert(makeToken(2));
    buffer.insert(makeToken(1)); // dup

    // After inserting 1: drains 1, 2, 3 (since 2 and 3 were buffered)
    // The duplicates should not cause extra items
    // Let's verify by inserting seq 4
    const r4 = buffer.insert(makeToken(4));
    expect(r4).toHaveLength(1);
    expect(r4[0].seq).toBe(4);
  });

  // ─── markProcessed ────────────────────────────────────────────────────

  test('markProcessed updates lastProcessedSeq', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    buffer.insert(makeToken(3));

    buffer.markProcessed(1);
    expect(buffer.lastProcessedSeq).toBe(1);

    buffer.markProcessed(3); // Can skip 2
    expect(buffer.lastProcessedSeq).toBe(3);

    buffer.markProcessed(2); // Earlier seq doesn't go backwards
    expect(buffer.lastProcessedSeq).toBe(3);
  });

  // ─── resetTo ──────────────────────────────────────────────────────────

  test('resetTo clears buffer and adjusts nextExpectedSeq', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    buffer.markProcessed(2);

    buffer.resetTo(2);
    expect(buffer.bufferedCount).toBe(0);

    // Now seq 3 should be the next expected
    const r3 = buffer.insert(makeToken(3));
    expect(r3).toHaveLength(1);
    expect(r3[0].seq).toBe(3);
  });

  test('resetTo still deduplicates previously processed seqs', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    buffer.markProcessed(2);

    buffer.resetTo(2);

    // Replayed message with seq=2 should be ignored (dedup)
    const r2 = buffer.insert(makeToken(2));
    expect(r2).toHaveLength(0);

    // Replayed message with seq=1 should be ignored
    const r1 = buffer.insert(makeToken(1));
    expect(r1).toHaveLength(0);
  });

  // ─── Large Sequences ──────────────────────────────────────────────────

  test('handles 1000 messages in random order', () => {
    const seqs = Array.from({ length: 1000 }, (_, i) => i + 1);
    // Shuffle
    for (let i = seqs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seqs[i], seqs[j]] = [seqs[j], seqs[i]];
    }

    const allDrained: ServerMessage[] = [];
    for (const seq of seqs) {
      const result = buffer.insert(makeToken(seq));
      allDrained.push(...result);
    }

    expect(allDrained).toHaveLength(1000);
    // Verify they come out in order
    for (let i = 0; i < allDrained.length; i++) {
      expect(allDrained[i].seq).toBe(i + 1);
    }
  });

  test('handles 1000 messages with 10% duplicates', () => {
    const seqs = Array.from({ length: 1000 }, (_, i) => i + 1);
    // Add 10% duplicates
    for (let i = 0; i < 100; i++) {
      seqs.push(Math.floor(Math.random() * 1000) + 1);
    }
    // Shuffle
    for (let i = seqs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seqs[i], seqs[j]] = [seqs[j], seqs[i]];
    }

    const allDrained: ServerMessage[] = [];
    for (const seq of seqs) {
      const result = buffer.insert(makeToken(seq));
      allDrained.push(...result);
    }

    // Should still get exactly 1000 unique messages
    expect(allDrained).toHaveLength(1000);
    for (let i = 0; i < allDrained.length; i++) {
      expect(allDrained[i].seq).toBe(i + 1);
    }
  });
});
