/**
 * Seq Tracker — Tests for the seq tracking aspects of ReorderBuffer.
 *
 * Focuses on the DOM-consumed vs socket-received distinction,
 * which is critical for correct RESUME behavior.
 */

import { ReorderBuffer } from '../src/lib/protocol/reorder-buffer';
import type { TokenMessage } from '../src/lib/protocol/types';

function makeToken(seq: number): TokenMessage {
  return { type: 'TOKEN', seq, stream_id: 's_test', text: `t${seq}` };
}

describe('Seq Tracking (RESUME correctness)', () => {
  let buffer: ReorderBuffer;

  beforeEach(() => {
    buffer = new ReorderBuffer();
  });

  test('lastProcessedSeq starts at 0', () => {
    expect(buffer.lastProcessedSeq).toBe(0);
  });

  test('inserting messages does not auto-update lastProcessedSeq', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    // Messages were drained (processed by reorder buffer) but NOT marked as DOM-consumed
    expect(buffer.lastProcessedSeq).toBe(0);
  });

  test('markProcessed updates lastProcessedSeq correctly', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    buffer.insert(makeToken(3));

    buffer.markProcessed(1);
    expect(buffer.lastProcessedSeq).toBe(1);

    buffer.markProcessed(2);
    expect(buffer.lastProcessedSeq).toBe(2);

    buffer.markProcessed(3);
    expect(buffer.lastProcessedSeq).toBe(3);
  });

  test('markProcessed handles out-of-order DOM commits', () => {
    buffer.insert(makeToken(1));
    buffer.insert(makeToken(2));
    buffer.insert(makeToken(3));

    // DOM commits can happen out of order (e.g., context snapshot processed before token)
    buffer.markProcessed(3);
    expect(buffer.lastProcessedSeq).toBe(3);

    // Earlier seq doesn't decrease lastProcessedSeq
    buffer.markProcessed(1);
    expect(buffer.lastProcessedSeq).toBe(3);
  });

  test('RESUME scenario: connection drops mid-stream', () => {
    // Receive and process seq 1-5
    for (let i = 1; i <= 5; i++) {
      buffer.insert(makeToken(i));
      buffer.markProcessed(i);
    }
    expect(buffer.lastProcessedSeq).toBe(5);

    // Receive seq 6 but DON'T process it (connection drops after receive, before render)
    buffer.insert(makeToken(6));
    // lastProcessedSeq should still be 5 — this is what we send in RESUME
    expect(buffer.lastProcessedSeq).toBe(5);
  });

  test('RESUME scenario: resetTo and replay', () => {
    // Process seq 1-5
    for (let i = 1; i <= 5; i++) {
      buffer.insert(makeToken(i));
      buffer.markProcessed(i);
    }

    // Simulate reconnection: reset to last processed seq
    buffer.resetTo(5);

    // Server replays from seq 6
    const r6 = buffer.insert(makeToken(6));
    expect(r6).toHaveLength(1);
    expect(r6[0].seq).toBe(6);

    // Server also replays seq 5 (already processed) — should be deduped
    const r5 = buffer.insert(makeToken(5));
    expect(r5).toHaveLength(0);
  });

  test('RESUME scenario: gap during replay', () => {
    for (let i = 1; i <= 3; i++) {
      buffer.insert(makeToken(i));
      buffer.markProcessed(i);
    }
    buffer.resetTo(3);

    // Server replays: 4, 6, 5 (out of order in chaos mode)
    const r4 = buffer.insert(makeToken(4));
    expect(r4).toHaveLength(1);

    const r6 = buffer.insert(makeToken(6));
    expect(r6).toHaveLength(0); // Gap at 5

    const r5 = buffer.insert(makeToken(5));
    expect(r5).toHaveLength(2); // Drains 5 and 6
    expect(r5.map(m => m.seq)).toEqual([5, 6]);
  });
});
