/**
 * HeartbeatManager — Handles PING/PONG protocol.
 *
 * Responsibilities:
 * - Responds to every PING with a PONG containing the echoed challenge.
 * - Handles corrupt PINGs (empty challenge) gracefully — sends PONG with empty echo.
 * - Does NOT crash on malformed data.
 */

import type { PingMessage, PongPayload } from './types';

export class HeartbeatManager {
  private sendFn: ((msg: PongPayload) => void) | null = null;
  private lastPingTime = 0;
  private totalPings = 0;
  private totalPongs = 0;
  private corruptPings = 0;

  /** Set the function used to send PONG responses */
  setSendFn(fn: (msg: PongPayload) => void): void {
    this.sendFn = fn;
  }

  /**
   * Handle an incoming PING message.
   * Sends a PONG response with the echoed challenge.
   *
   * @returns true if the PONG was sent successfully
   */
  handlePing(ping: PingMessage): boolean {
    this.totalPings++;
    this.lastPingTime = Date.now();

    // Handle corrupt heartbeat: empty or missing challenge
    const challenge = ping.challenge ?? '';
    if (challenge === '') {
      this.corruptPings++;
    }

    if (!this.sendFn) {
      console.warn('HeartbeatManager: no send function set');
      return false;
    }

    // Always respond, even with empty challenge
    const pong: PongPayload = {
      type: 'PONG',
      echo: challenge,
    };

    try {
      this.sendFn(pong);
      this.totalPongs++;
      return true;
    } catch {
      return false;
    }
  }

  /** Get heartbeat stats for debugging */
  getStats(): {
    totalPings: number;
    totalPongs: number;
    corruptPings: number;
    lastPingTime: number;
  } {
    return {
      totalPings: this.totalPings,
      totalPongs: this.totalPongs,
      corruptPings: this.corruptPings,
      lastPingTime: this.lastPingTime,
    };
  }

  /** Reset state (on reconnection) */
  reset(): void {
    this.lastPingTime = 0;
    // Keep cumulative stats
  }
}
