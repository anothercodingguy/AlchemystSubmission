/**
 * ReorderBuffer — Min-heap priority queue for seq-based message reordering.
 *
 * Design rationale (documented in DECISIONS.md):
 * - In normal mode, messages arrive in order → the heap drains immediately (pass-through).
 * - In chaos mode, out-of-order messages accumulate until gaps are filled.
 * - O(log n) insert via binary heap, O(1) peek-min for draining.
 * - Deduplication via Set<number> of processed seq values.
 *
 * The buffer is the single source of truth for "what have we processed?"
 * which is critical for RESUME correctness.
 */

import type { ServerMessage } from './types';

export class ReorderBuffer {
  /** Min-heap: smallest seq at index 0 */
  private heap: ServerMessage[] = [];

  /** Set of seq values we've already processed (for dedup) */
  private processedSeqs: Set<number> = new Set();

  /** The next seq we expect to consume. Starts at 1 (first server message is seq=1). */
  private nextExpectedSeq = 1;

  /** The highest seq we've fully processed. Used for RESUME. */
  private _lastProcessedSeq = 0;

  get lastProcessedSeq(): number {
    return this._lastProcessedSeq;
  }

  /**
   * Insert a message and drain all consecutive messages ready for processing.
   *
   * @returns Array of messages ready to process, in seq order.
   *          Empty array if the message fills no gaps.
   */
  insert(message: ServerMessage): ServerMessage[] {
    const seq = message.seq;

    // Deduplicate: skip if we've already processed this seq
    if (this.processedSeqs.has(seq)) {
      return [];
    }

    // Insert into heap
    this.heapPush(message);

    // Drain consecutive messages from nextExpectedSeq
    return this.drain();
  }

  /**
   * Mark a seq as fully processed (rendered to DOM).
   * This updates lastProcessedSeq for RESUME.
   */
  markProcessed(seq: number): void {
    this._lastProcessedSeq = Math.max(this._lastProcessedSeq, seq);
  }

  /**
   * Reset the buffer state. Used when connection is re-established
   * and we want to start fresh from a known seq.
   */
  resetTo(lastSeq: number): void {
    this.heap = [];
    this.nextExpectedSeq = lastSeq + 1;
    // Keep processedSeqs — we still need dedup for replayed messages
  }

  /** How many messages are buffered (waiting for gap fill) */
  get bufferedCount(): number {
    return this.heap.length;
  }

  // ─── Private: Heap Operations ──────────────────────────────────────────

  /**
   * Drain all consecutive messages starting from nextExpectedSeq.
   * After draining, nextExpectedSeq points to the next gap.
   */
  private drain(): ServerMessage[] {
    const ready: ServerMessage[] = [];

    while (this.heap.length > 0) {
      const top = this.heap[0];

      if (top.seq < this.nextExpectedSeq) {
        // Already processed (duplicate that snuck in). Remove and skip.
        this.heapPop();
        continue;
      }

      if (top.seq === this.nextExpectedSeq) {
        // This is the next message we need. Consume it.
        this.heapPop();

        // Check dedup again (race condition between insert and drain)
        if (!this.processedSeqs.has(top.seq)) {
          this.processedSeqs.add(top.seq);
          ready.push(top);
        }

        this.nextExpectedSeq++;
      } else {
        // Gap: top.seq > nextExpectedSeq. Stop draining.
        break;
      }
    }

    return ready;
  }

  /** Push onto the min-heap (sorted by seq ascending) */
  private heapPush(msg: ServerMessage): void {
    this.heap.push(msg);
    this.bubbleUp(this.heap.length - 1);
  }

  /** Pop the minimum element from the heap */
  private heapPop(): ServerMessage | undefined {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return min;
  }

  /** Bubble up element at index to maintain heap property */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent].seq <= this.heap[index].seq) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  /** Sink down element at index to maintain heap property */
  private sinkDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < length && this.heap[left].seq < this.heap[smallest].seq) {
        smallest = left;
      }
      if (right < length && this.heap[right].seq < this.heap[smallest].seq) {
        smallest = right;
      }

      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  /** Swap two elements in the heap */
  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}
