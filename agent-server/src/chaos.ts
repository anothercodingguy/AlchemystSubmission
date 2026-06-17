/**
 * ChaosEngine — Randomly triggers chaos behaviors for testing.
 *
 * Each method returns true with a configured probability.
 * Probabilities are tuned so that chaos is disruptive but
 * doesn't make every single interaction fail.
 */
export class ChaosEngine {
  private messageCount = 0;
  private hasDroppedThisStream = false;
  private lastDropTime = 0;

  /** Roll a random chance (0-1) */
  private roll(probability: number): boolean {
    return Math.random() < probability;
  }

  /**
   * Should the server drop the connection mid-stream?
   * ~3% chance per token, but not within 10s of the last drop.
   */
  shouldDropConnection(): boolean {
    this.messageCount++;
    const now = Date.now();
    if (now - this.lastDropTime < 10000) return false;
    if (this.messageCount < 5) return false; // Let a few messages through first
    if (this.roll(0.03)) {
      this.lastDropTime = now;
      this.hasDroppedThisStream = true;
      return true;
    }
    return false;
  }

  /** Should a latency spike occur? ~5% chance per token. */
  shouldLatencySpike(): boolean {
    return this.roll(0.05);
  }

  /** Should this batch of messages be sent out of order? ~20% chance. */
  shouldReorder(): boolean {
    return this.roll(0.20);
  }

  /** Should we accumulate tokens into a batch for potential reordering? ~30% chance. */
  shouldBatchReorder(): boolean {
    return this.roll(0.30);
  }

  /** Should this message be sent as a duplicate? ~8% chance. */
  shouldDuplicate(): boolean {
    return this.roll(0.08);
  }

  /** Should we fire rapid tool calls (two in quick succession)? ~25% chance per tool call. */
  shouldRapidToolCall(): boolean {
    return this.roll(0.25);
  }

  /** Should the PING have an empty challenge? ~10% chance per heartbeat. */
  shouldCorruptHeartbeat(): boolean {
    return this.roll(0.10);
  }

  /** Should we send an oversized (500KB+) context snapshot? ~15% chance per response. */
  shouldSendOversizedContext(): boolean {
    return this.roll(0.15);
  }
}
