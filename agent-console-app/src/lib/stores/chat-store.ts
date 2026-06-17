/**
 * Chat Store — Manages messages, active streams, and tool calls.
 *
 * The segment model is the core architecture for preventing layout shift:
 * - Each stream is an ordered list of TextSegment | ToolCallSegment.
 * - When TOOL_CALL arrives, current text is frozen, new segment begins.
 * - When TOOL_RESULT arrives, tool card updates, new text segment begins.
 * - Renderer maps segments to DOM nodes sequentially — no reflow.
 *
 * State management choice: Zustand
 * WHY: Lightweight (< 1KB), no boilerplate, works naturally with
 * event-driven WebSocket updates. Multiple components (chat, timeline,
 * context) need shared access to the same protocol state without
 * prop drilling. Zustand's subscribe model prevents unnecessary rerenders.
 */

import { create } from 'zustand';
import type {
  ChatMessage,
  StreamState,
  StreamSegment,
  TextSegment,
  ToolCallSegment,
} from '../protocol/types';

interface ChatStore {
  // State
  messages: ChatMessage[];
  streams: Map<string, StreamState>;

  // Actions
  addUserMessage: (content: string) => string;
  ensureAgentMessage: (streamId: string) => void;
  appendToken: (streamId: string, text: string) => void;
  startToolCall: (
    streamId: string,
    callId: string,
    toolName: string,
    args: Record<string, unknown>
  ) => void;
  completeToolCall: (
    streamId: string,
    callId: string,
    result: Record<string, unknown>
  ) => void;
  endStream: (streamId: string) => void;
  getStreamText: (streamId: string) => string;
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  streams: new Map(),

  addUserMessage: (content: string) => {
    const id = generateId();
    const message: ChatMessage = {
      id,
      role: 'user',
      content,
      streamId: null,
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, message],
    }));
    return id;
  },

  ensureAgentMessage: (streamId: string) => {
    const state = get();

    // Check if we already have a message for this streamId
    const existing = state.messages.find(
      (m) => m.role === 'agent' && m.streamId === streamId
    );
    if (existing) return;

    // Create new agent message
    const message: ChatMessage = {
      id: generateId(),
      role: 'agent',
      content: '',
      streamId,
      timestamp: Date.now(),
    };

    // Create new stream state
    const newStream: StreamState = {
      streamId,
      segments: [{ kind: 'text', text: '', isComplete: false }],
      status: 'streaming',
    };

    const newStreams = new Map(state.streams);
    newStreams.set(streamId, newStream);

    set({
      messages: [...state.messages, message],
      streams: newStreams,
    });
  },

  appendToken: (streamId: string, text: string) => {
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;

      const segments = [...stream.segments];
      const lastSegment = segments[segments.length - 1];

      if (lastSegment && lastSegment.kind === 'text' && !lastSegment.isComplete) {
        // Append to the current text segment
        segments[segments.length - 1] = {
          ...lastSegment,
          text: lastSegment.text + text,
        };
      } else {
        // Create new text segment (after a tool call result)
        segments.push({ kind: 'text', text, isComplete: false });
      }

      const newStreams = new Map(state.streams);
      newStreams.set(streamId, { ...stream, segments, status: 'streaming' });

      return { streams: newStreams };
    });
  },

  startToolCall: (streamId, callId, toolName, args) => {
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;

      const segments = [...stream.segments];

      // Freeze the current text segment
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.kind === 'text') {
        segments[segments.length - 1] = {
          ...lastSegment,
          isComplete: true, // Frozen!
        };
      }

      // Add tool call segment
      const toolCallSegment: ToolCallSegment = {
        kind: 'tool_call',
        callId,
        toolName,
        args,
        result: null,
        status: 'pending',
      };
      segments.push(toolCallSegment);

      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        segments,
        status: 'tool_paused',
      });

      return { streams: newStreams };
    });
  },

  completeToolCall: (streamId, callId, result) => {
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;

      const segments = stream.segments.map((seg): StreamSegment => {
        if (seg.kind === 'tool_call' && seg.callId === callId) {
          return { ...seg, result, status: 'completed' };
        }
        return seg;
      });

      // Add a new empty text segment for resumed streaming
      segments.push({ kind: 'text', text: '', isComplete: false });

      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        segments,
        status: 'streaming',
      });

      return { streams: newStreams };
    });
  },

  endStream: (streamId: string) => {
    set((state) => {
      const stream = state.streams.get(streamId);
      if (!stream) return state;

      const segments = stream.segments.map((seg): StreamSegment => {
        if (seg.kind === 'text') {
          return { ...seg, isComplete: true };
        }
        return seg;
      });

      const newStreams = new Map(state.streams);
      newStreams.set(streamId, {
        ...stream,
        segments,
        status: 'ended',
      });

      return { streams: newStreams };
    });
  },

  getStreamText: (streamId: string) => {
    const stream = get().streams.get(streamId);
    if (!stream) return '';
    return stream.segments
      .filter((s): s is TextSegment => s.kind === 'text')
      .map((s) => s.text)
      .join('');
  },
}));
