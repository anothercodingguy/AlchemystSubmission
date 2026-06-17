/**
 * Protocol Types — Discriminated unions for every WebSocket message.
 *
 * All server messages carry a `seq` (monotonically increasing sequence number).
 * Client messages do not have seq — they are fire-and-forget.
 */

// ─── Server → Client Messages ────────────────────────────────────────────

export interface TokenMessage {
  readonly type: 'TOKEN';
  readonly seq: number;
  readonly stream_id: string;
  readonly text: string;
}

export interface ToolCallMessage {
  readonly type: 'TOOL_CALL';
  readonly seq: number;
  readonly call_id: string;
  readonly tool_name: string;
  readonly args: Record<string, unknown>;
  readonly stream_id: string;
}

export interface ToolResultMessage {
  readonly type: 'TOOL_RESULT';
  readonly seq: number;
  readonly call_id: string;
  readonly result: Record<string, unknown>;
  readonly stream_id: string;
}

export interface ContextSnapshotMessage {
  readonly type: 'CONTEXT_SNAPSHOT';
  readonly seq: number;
  readonly context_id: string;
  readonly data: Record<string, unknown>;
}

export interface PingMessage {
  readonly type: 'PING';
  readonly seq: number;
  readonly challenge: string;
}

export interface StreamEndMessage {
  readonly type: 'STREAM_END';
  readonly seq: number;
  readonly stream_id: string;
}

export interface ErrorMessage {
  readonly type: 'ERROR';
  readonly seq: number;
  readonly code: string;
  readonly message: string;
}

export type ServerMessage =
  | TokenMessage
  | ToolCallMessage
  | ToolResultMessage
  | ContextSnapshotMessage
  | PingMessage
  | StreamEndMessage
  | ErrorMessage;

// ─── Client → Server Messages ────────────────────────────────────────────

export interface UserMessagePayload {
  readonly type: 'USER_MESSAGE';
  readonly content: string;
}

export interface PongPayload {
  readonly type: 'PONG';
  readonly echo: string;
}

export interface ResumePayload {
  readonly type: 'RESUME';
  readonly last_seq: number;
}

export interface ToolAckPayload {
  readonly type: 'TOOL_ACK';
  readonly call_id: string;
}

export type ClientMessage =
  | UserMessagePayload
  | PongPayload
  | ResumePayload
  | ToolAckPayload;

// ─── Connection States ────────────────────────────────────────────────────

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'RESUMING';

// ─── Stream Segment Model ────────────────────────────────────────────────

/**
 * A stream response is modeled as an ordered list of segments.
 * This is the key to preventing layout shift during tool call interruptions.
 *
 * When tokens arrive: they accumulate into the current TextSegment.
 * When a TOOL_CALL arrives: the current TextSegment is frozen, a ToolCallSegment is appended.
 * When TOOL_RESULT arrives: a new TextSegment begins.
 * When STREAM_END arrives: the current TextSegment is finalized.
 */
export interface TextSegment {
  readonly kind: 'text';
  readonly text: string;
  readonly isComplete: boolean;
}

export interface ToolCallSegment {
  readonly kind: 'tool_call';
  readonly callId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
  readonly status: 'pending' | 'completed';
}

export type StreamSegment = TextSegment | ToolCallSegment;

// ─── Stream State ─────────────────────────────────────────────────────────

export type StreamStatus = 'streaming' | 'tool_paused' | 'ended';

export interface StreamState {
  readonly streamId: string;
  readonly segments: StreamSegment[];
  readonly status: StreamStatus;
}

// ─── Chat Message ─────────────────────────────────────────────────────────

export type ChatMessageRole = 'user' | 'agent';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly content: string; // For user messages
  readonly streamId: string | null; // For agent messages
  readonly timestamp: number;
}

// ─── Trace Event ──────────────────────────────────────────────────────────

export interface TraceEvent {
  readonly id: string;
  readonly seq: number;
  readonly type: ServerMessage['type'];
  readonly timestamp: number;
  readonly data: ServerMessage;
  readonly streamId?: string;
  readonly callId?: string;
}

// ─── Token Group (for timeline batching) ──────────────────────────────────

export interface TokenGroup {
  readonly id: string;
  readonly kind: 'token_group';
  readonly streamId: string;
  readonly startSeq: number;
  readonly endSeq: number;
  readonly tokenCount: number;
  readonly totalText: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
}

// ─── Context Diff ─────────────────────────────────────────────────────────

export type DiffChangeType = 'added' | 'removed' | 'changed' | 'unchanged';

export interface DiffEntry {
  readonly path: string[];
  readonly type: DiffChangeType;
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

export interface ContextSnapshot {
  readonly contextId: string;
  readonly seq: number;
  readonly data: Record<string, unknown>;
  readonly timestamp: number;
  readonly diff: DiffEntry[] | null; // null for first snapshot
}

// ─── Type Guards ──────────────────────────────────────────────────────────

export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj['type'] === 'string' &&
    typeof obj['seq'] === 'number' &&
    [
      'TOKEN',
      'TOOL_CALL',
      'TOOL_RESULT',
      'CONTEXT_SNAPSHOT',
      'PING',
      'STREAM_END',
      'ERROR',
    ].includes(obj['type'] as string)
  );
}
