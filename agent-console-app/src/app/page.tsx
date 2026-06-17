'use client';

import { useState, useCallback } from 'react';
import { useAgent } from '@/lib/hooks/use-agent';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { TraceTimeline } from '@/components/timeline/TraceTimeline';
import { ContextInspector } from '@/components/context/ContextInspector';
import { ConnectionStatus } from '@/components/connection/ConnectionStatus';
import type { TraceEvent } from '@/lib/protocol/types';

export default function Home() {
  const { sendMessage } = useAgent();
  const [highlightedCallId, setHighlightedCallId] = useState<string | null>(null);

  // Bidirectional linking: chat → timeline
  const handleChatClickCallId = useCallback((callId: string) => {
    setHighlightedCallId(callId);
  }, []);

  // Bidirectional linking: timeline → chat
  const handleTimelineClickEvent = useCallback((event: TraceEvent) => {
    if (event.callId) {
      setHighlightedCallId(event.callId);
      // Scroll chat to the tool card
      const element = document.getElementById(`tool-card-${event.callId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, []);

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <h1>Agent Console</h1>
        <div className="app-header-right">
          <ConnectionStatus />
        </div>
      </header>

      {/* Chat Panel */}
      <ChatPanel
        onSend={sendMessage}
        onClickCallId={handleChatClickCallId}
      />

      {/* Trace Timeline */}
      <div className="panel">
        <div className="panel-header">
          <h2>Trace Timeline</h2>
        </div>
        <div className="panel-body">
          <TraceTimeline
            highlightedCallId={highlightedCallId}
            onClickEvent={handleTimelineClickEvent}
          />
        </div>
      </div>

      {/* Context Inspector */}
      <div className="panel">
        <div className="panel-header">
          <h2>Context Inspector</h2>
        </div>
        <div className="panel-body">
          <ContextInspector />
        </div>
      </div>
    </div>
  );
}
