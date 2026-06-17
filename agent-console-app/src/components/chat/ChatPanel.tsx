'use client';

import { useRef, useEffect } from 'react';
import { useChatStore } from '@/lib/stores/chat-store';
import type { TextSegment, ToolCallSegment } from '@/lib/protocol/types';
import styles from './ChatPanel.module.css';

// ─── ToolCallCard ───────────────────────────────────────────────────────────

interface ToolCallCardProps {
  segment: ToolCallSegment;
  onClickCallId?: (callId: string) => void;
}

function ToolCallCard({ segment, onClickCallId }: ToolCallCardProps) {
  const statusClass = segment.status === 'pending' ? styles.pending : styles.completed;

  return (
    <div
      className={`${styles.toolCallCard} ${statusClass}`}
      data-call-id={segment.callId}
      id={`tool-card-${segment.callId}`}
      onClick={() => onClickCallId?.(segment.callId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClickCallId?.(segment.callId);
      }}
    >
      <div className={styles.toolCallHeader}>
        <div className={`${styles.toolCallIcon} ${statusClass}`}>
          {segment.status === 'pending' ? '⚡' : '✓'}
        </div>
        <span className={styles.toolCallName}>{segment.toolName}</span>
        <span className={styles.toolCallStatus}>
          {segment.status === 'pending' ? 'Running...' : 'Completed'}
        </span>
      </div>
      <div className={styles.toolCallBody}>
        <div className={styles.toolCallSection}>
          <div className={styles.toolCallLabel}>Arguments</div>
          <pre className={styles.toolCallJson}>
            {JSON.stringify(segment.args, null, 2)}
          </pre>
        </div>
        {segment.result && (
          <div className={styles.toolCallSection}>
            <div className={styles.toolCallLabel}>Result</div>
            <pre className={styles.toolCallJson}>
              {JSON.stringify(segment.result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── StreamingText ──────────────────────────────────────────────────────────

interface StreamingTextProps {
  segment: TextSegment;
}

function StreamingText({ segment }: StreamingTextProps) {
  return (
    <span className={styles.streamSegment}>
      {segment.text}
      {!segment.isComplete && <span className={styles.streamCursor} />}
    </span>
  );
}

// ─── AgentMessage ───────────────────────────────────────────────────────────

interface AgentMessageProps {
  streamId: string;
  onClickCallId?: (callId: string) => void;
}

function AgentMessage({ streamId, onClickCallId }: AgentMessageProps) {
  const stream = useChatStore((s) => s.streams.get(streamId));

  if (!stream) return null;

  return (
    <div className={`${styles.messageBubble} ${styles.agent}`}>
      <div className={styles.messageRole}>Agent</div>
      <div className={styles.messageContent}>
        {stream.segments.map((segment, i) => {
          if (segment.kind === 'text') {
            // Don't render empty text segments
            if (!segment.text && segment.isComplete) return null;
            return <StreamingText key={`text-${i}`} segment={segment} />;
          }
          return (
            <ToolCallCard
              key={`tool-${segment.callId}`}
              segment={segment}
              onClickCallId={onClickCallId}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── ChatInput ──────────────────────────────────────────────────────────────

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

function ChatInput({ onSend, disabled }: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const value = inputRef.current?.value.trim();
    if (!value) return;
    onSend(value);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className={styles.inputContainer}>
      <div className={styles.inputWrapper}>
        <input
          ref={inputRef}
          className={styles.inputField}
          type="text"
          placeholder="Send a message to the agent..."
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          id="chat-input"
        />
        <button
          className={styles.sendButton}
          onClick={handleSubmit}
          disabled={disabled}
          id="send-button"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── ChatPanel ──────────────────────────────────────────────────────────────

interface ChatPanelProps {
  onSend: (content: string) => void;
  onClickCallId?: (callId: string) => void;
}

export function ChatPanel({ onSend, onClickCallId }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (isAutoScrolling.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Subscribe to streams to trigger re-renders on token updates (for auto-scroll)
  const _streams = useChatStore((s) => s.streams);
  useEffect(() => {
    if (isAutoScrolling.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If within 100px of bottom, auto-scroll is active
    isAutoScrolling.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  return (
    <div className={styles.chatContainer} id="chat-panel">
      <div
        className={styles.messageList}
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>💬</div>
            <div className={styles.emptyText}>
              Send a message to start a conversation with the agent
            </div>
          </div>
        )}
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div
                key={msg.id}
                className={`${styles.messageBubble} ${styles.user}`}
              >
                <div className={styles.messageRole}>You</div>
                <div className={styles.messageContent}>{msg.content}</div>
              </div>
            );
          }

          if (msg.streamId) {
            return (
              <AgentMessage
                key={msg.id}
                streamId={msg.streamId}
                onClickCallId={onClickCallId}
              />
            );
          }

          return null;
        })}
      </div>
      <ChatInput onSend={onSend} />
    </div>
  );
}
