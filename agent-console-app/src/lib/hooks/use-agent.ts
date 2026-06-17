/**
 * useAgent — Main hook that connects the protocol layer to the state stores.
 *
 * This is the single integration point between:
 * - ConnectionManager (protocol layer)
 * - ChatStore, TraceStore, ContextStore, ConnectionStore (state layer)
 *
 * The hook creates and manages the ConnectionManager lifecycle,
 * dispatches ordered messages to the appropriate stores,
 * and provides actions for the UI to call.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ConnectionManager } from '../protocol/connection';
import type { ServerMessage } from '../protocol/types';
import { useChatStore } from '../stores/chat-store';
import { useTraceStore } from '../stores/trace-store';
import { useContextStore } from '../stores/context-store';
import { useConnectionStore } from '../stores/connection-store';

const WS_URL = typeof window !== 'undefined'
  ? `ws://${window.location.hostname}:4747/ws`
  : 'ws://localhost:4747/ws';

interface UseAgentReturn {
  sendMessage: (content: string) => void;
  connect: () => void;
  disconnect: () => void;
}

export function useAgent(): UseAgentReturn {
  const managerRef = useRef<ConnectionManager | null>(null);

  // Store actions (stable references from Zustand)
  const chatStore = useChatStore();
  const addTraceEvent = useTraceStore((s) => s.addEvent);
  const addContextSnapshot = useContextStore((s) => s.addSnapshot);
  const setConnectionState = useConnectionStore((s) => s.setState);

  // Refs for latest store actions (avoid stale closures)
  const chatStoreRef = useRef(chatStore);
  chatStoreRef.current = chatStore;

  const addTraceEventRef = useRef(addTraceEvent);
  addTraceEventRef.current = addTraceEvent;

  const addContextSnapshotRef = useRef(addContextSnapshot);
  addContextSnapshotRef.current = addContextSnapshot;

  const setConnectionStateRef = useRef(setConnectionState);
  setConnectionStateRef.current = setConnectionState;

  /**
   * Message dispatcher — routes ordered, deduplicated messages to stores.
   * Called by ConnectionManager after messages pass through ReorderBuffer.
   */
  const handleMessage = useCallback((message: ServerMessage) => {
    const chat = chatStoreRef.current;
    const manager = managerRef.current;

    // Always add to trace timeline
    addTraceEventRef.current(message);

    switch (message.type) {
      case 'TOKEN': {
        chat.ensureAgentMessage(message.stream_id);
        chat.appendToken(message.stream_id, message.text);
        // Mark as processed (rendered to DOM)
        manager?.markSeqProcessed(message.seq);
        break;
      }

      case 'TOOL_CALL': {
        chat.ensureAgentMessage(message.stream_id);
        chat.startToolCall(
          message.stream_id,
          message.call_id,
          message.tool_name,
          message.args
        );
        // Send TOOL_ACK immediately (within 2s requirement)
        manager?.sendToolAck(message.call_id);
        manager?.markSeqProcessed(message.seq);
        break;
      }

      case 'TOOL_RESULT': {
        chat.completeToolCall(
          message.stream_id,
          message.call_id,
          message.result
        );
        manager?.markSeqProcessed(message.seq);
        break;
      }

      case 'CONTEXT_SNAPSHOT': {
        addContextSnapshotRef.current(
          message.context_id,
          message.seq,
          message.data
        );
        manager?.markSeqProcessed(message.seq);
        break;
      }

      case 'STREAM_END': {
        chat.endStream(message.stream_id);
        manager?.markSeqProcessed(message.seq);
        break;
      }

      case 'PING': {
        // Handled by HeartbeatManager in ConnectionManager
        // Already marked processed there
        break;
      }

      case 'ERROR': {
        console.error(`[Agent Error] ${message.code}: ${message.message}`);
        manager?.markSeqProcessed(message.seq);
        break;
      }
    }
  }, []);

  // Initialize ConnectionManager once
  useEffect(() => {
    const manager = new ConnectionManager({
      url: WS_URL,
      onMessage: handleMessage,
      onStateChange: (state) => {
        setConnectionStateRef.current(state);
      },
      onError: (error) => {
        console.error('[ConnectionManager]', error);
      },
    });

    managerRef.current = manager;

    // Auto-connect on mount
    manager.connect();

    return () => {
      manager.disconnect();
      managerRef.current = null;
    };
  }, [handleMessage]);

  const sendMessage = useCallback((content: string) => {
    const chat = chatStoreRef.current;
    chat.addUserMessage(content);
    managerRef.current?.sendUserMessage(content);
  }, []);

  const connect = useCallback(() => {
    managerRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    managerRef.current?.disconnect();
  }, []);

  return { sendMessage, connect, disconnect };
}
