/**
 * ConnectionManager — WebSocket lifecycle state machine.
 *
 * States: DISCONNECTED → CONNECTING → CONNECTED → RECONNECTING → RESUMING
 *
 * Key design decisions:
 * 1. All incoming messages go through ReorderBuffer before dispatch.
 * 2. PING messages are handled immediately (bypass reorder buffer) for latency.
 * 3. On reconnect, RESUME is sent as the first message with lastProcessedSeq.
 * 4. Exponential backoff: 500ms → 1s → 2s → 4s → cap at 10s.
 * 5. The manager emits ordered, deduplicated messages via a callback.
 */

import type { ServerMessage, ClientMessage, ConnectionState } from './types';
import { isServerMessage } from './types';
import { ReorderBuffer } from './reorder-buffer';
import { HeartbeatManager } from './heartbeat';

export interface ConnectionManagerOptions {
  url: string;
  onMessage: (message: ServerMessage) => void;
  onStateChange: (state: ConnectionState) => void;
  onError?: (error: string) => void;
}

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'DISCONNECTED';
  private readonly url: string;
  private readonly onMessage: (message: ServerMessage) => void;
  private readonly onStateChange: (state: ConnectionState) => void;
  private readonly onError: (error: string) => void;

  private readonly reorderBuffer: ReorderBuffer;
  private readonly heartbeatManager: HeartbeatManager;

  // Reconnection
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasEverConnected = false;
  private intentionalClose = false;

  // Backoff constants
  private static readonly BASE_DELAY_MS = 500;
  private static readonly MAX_DELAY_MS = 10000;

  constructor(options: ConnectionManagerOptions) {
    this.url = options.url;
    this.onMessage = options.onMessage;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError ?? (() => {});

    this.reorderBuffer = new ReorderBuffer();
    this.heartbeatManager = new HeartbeatManager();

    // Wire heartbeat to send PONG via the connection
    this.heartbeatManager.setSendFn((pong) => {
      this.send(pong);
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.state !== 'DISCONNECTED' && this.state !== 'RECONNECTING') {
      return;
    }
    this.intentionalClose = false;
    this.setState('CONNECTING');
    this.createWebSocket();
  }

  /** Disconnect intentionally (clean close) */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setState('DISCONNECTED');
  }

  /** Send a client message */
  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      // Connection might have closed between the check and the send
    }
  }

  /** Send a user message to the agent */
  sendUserMessage(content: string): void {
    this.send({ type: 'USER_MESSAGE', content });
  }

  /** Send a TOOL_ACK for a tool call */
  sendToolAck(callId: string): void {
    this.send({ type: 'TOOL_ACK', call_id: callId });
  }

  /** Get current connection state */
  getState(): ConnectionState {
    return this.state;
  }

  /** Get the last fully processed seq (for debugging/display) */
  getLastProcessedSeq(): number {
    return this.reorderBuffer.lastProcessedSeq;
  }

  /** Mark a seq as fully processed (call from render layer after DOM commit) */
  markSeqProcessed(seq: number): void {
    this.reorderBuffer.markProcessed(seq);
  }

  /** Get heartbeat stats */
  getHeartbeatStats() {
    return this.heartbeatManager.getStats();
  }

  /** Get buffered message count */
  getBufferedCount(): number {
    return this.reorderBuffer.bufferedCount;
  }

  // ─── Private: WebSocket Lifecycle ──────────────────────────────────────

  private createWebSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.onError(`Failed to create WebSocket: ${err}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;

      if (this.hasEverConnected && this.reorderBuffer.lastProcessedSeq > 0) {
        // Reconnection: send RESUME as first message
        this.setState('RESUMING');
        const resumeMsg = {
          type: 'RESUME' as const,
          last_seq: this.reorderBuffer.lastProcessedSeq,
        };
        this.send(resumeMsg);
        this.reorderBuffer.resetTo(this.reorderBuffer.lastProcessedSeq);

        // Transition to CONNECTED after a short delay to allow replay
        setTimeout(() => {
          if (this.state === 'RESUMING') {
            this.setState('CONNECTED');
          }
        }, 500);
      } else {
        this.setState('CONNECTED');
      }

      this.hasEverConnected = true;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleRawMessage(event.data);
    };

    this.ws.onclose = () => {
      if (this.intentionalClose) {
        this.setState('DISCONNECTED');
        return;
      }

      // Unclean close → reconnect
      this.ws = null;
      this.setState('RECONNECTING');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // The error event is followed by a close event, so we handle reconnection there
      this.onError('WebSocket error');
    };
  }

  private handleRawMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      this.onError('Failed to parse WebSocket message');
      return;
    }

    if (!isServerMessage(parsed)) {
      this.onError('Received invalid server message');
      return;
    }

    const message = parsed;

    // PING is handled immediately for latency
    if (message.type === 'PING') {
      this.heartbeatManager.handlePing(message);
    }

    // All messages go through the reorder buffer to maintain sequence numbers
    const ready = this.reorderBuffer.insert(message);
    for (const msg of ready) {
      this.onMessage(msg);
    }
  }

  // ─── Private: Reconnection ────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = Math.min(
      ConnectionManager.BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      ConnectionManager.MAX_DELAY_MS
    );

    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Private: State Management ────────────────────────────────────────

  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.onStateChange(newState);
    console.log(`[ConnectionManager] ${oldState} → ${newState}`);
  }
}
