import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { ChaosEngine } from './chaos';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ClientMessage {
  type: 'USER_MESSAGE' | 'PONG' | 'RESUME' | 'TOOL_ACK';
  content?: string;
  echo?: string;
  last_seq?: number;
  call_id?: string;
}

interface ServerEvent {
  type: string;
  seq: number;
  [key: string]: unknown;
}

interface SessionLog {
  timestamp: string;
  direction: 'client_to_server' | 'server_to_client';
  message: Record<string, unknown>;
}

// ─── Response Templates ────────────────────────────────────────────────────

const AGENT_RESPONSES = [
  {
    context: {
      report: 'Q3-2025',
      pages: 47,
      sections: ['revenue', 'operations', 'forecast', 'risk_assessment'],
      last_updated: '2025-09-30T23:59:59Z',
      analyst: 'Agent-7B',
    },
    tokens: [
      'Based on ', 'the Q3 report, ', 'revenue grew ',
      ' year-over-year, ', 'driven primarily by ',
      'a 34% increase in ', 'enterprise subscriptions. ',
      'Operating margins ', 'improved to ',
      ', reflecting ', 'cost optimizations ',
      'in cloud infrastructure. ',
      'The forecast section ', 'projects ',
      'continued momentum ', 'into Q4, ',
      'with an expected ', 'revenue range of ',
      '$2.1B to $2.3B. ',
      'Key risks include ', 'regulatory changes ',
      'in the EU market ', 'and potential ',
      'supply chain disruptions ', 'in APAC.',
    ],
    toolCalls: [
      {
        insertAfterToken: 2,
        tool_name: 'lookup_metric',
        args: { metric: 'revenue_yoy', period: 'Q3-2025' },
        result: { value: '23.4%', period: 'YoY', confidence: 0.97 },
      },
      {
        insertAfterToken: 8,
        tool_name: 'lookup_metric',
        args: { metric: 'operating_margin', period: 'Q3-2025' },
        result: { value: '18.7%', baseline: '15.2%', delta: '+3.5pp' },
      },
    ],
  },
  {
    context: {
      customer: 'Acme Corp',
      account_id: 'ACC-4821',
      tier: 'Enterprise',
      contracts: 3,
      total_arr: 847000,
      health_score: 72,
    },
    tokens: [
      'Looking at ', 'the Acme Corp ', 'account, ',
      'they currently have ', '3 active contracts ',
      'with a total ARR of ',
      '. Their health score is ',
      ', which indicates ', 'moderate engagement. ',
      'I recommend scheduling ', 'a quarterly business review ',
      'to address the ', 'declining usage patterns ',
      'in their analytics module. ',
      'The contract renewal ', 'for their primary license ',
      'is coming up in ', '47 days, ',
      'which gives us ', 'a window to ',
      'discuss expansion opportunities.',
    ],
    toolCalls: [
      {
        insertAfterToken: 5,
        tool_name: 'format_currency',
        args: { amount: 847000, currency: 'USD' },
        result: { formatted: '$847,000', raw: 847000 },
      },
      {
        insertAfterToken: 6,
        tool_name: 'get_health_score',
        args: { account_id: 'ACC-4821', include_trend: true },
        result: { score: 72, trend: 'declining', previous: 81, period: '90d' },
      },
    ],
  },
  {
    context: {
      pipeline: 'CI/CD-main',
      build_id: 'build-7391',
      status: 'failed',
      stage: 'integration-tests',
      duration_ms: 184230,
      commit: 'a3f9c21',
    },
    tokens: [
      'The build ', 'pipeline failed ', 'at the ',
      'integration test stage. ',
      'Let me check the ', 'failure details. ',
      'The root cause is ', 'a timeout in the ',
      'database connection pool ', 'during parallel test execution. ',
      'The connection limit was set to ',
      ' connections, but the ', 'test suite attempted ',
      'to open 47 simultaneous connections. ',
      'I recommend increasing ', 'the pool size ',
      'to 64 in the ', 'test configuration, ',
      'or implementing ', 'connection queuing ',
      'with a 5-second timeout.',
    ],
    toolCalls: [
      {
        insertAfterToken: 5,
        tool_name: 'get_build_logs',
        args: { build_id: 'build-7391', stage: 'integration-tests', tail: 50 },
        result: {
          error: 'ConnectionPoolExhausted',
          message: 'Cannot acquire connection from pool: all 32 connections in use',
          timestamp: '2025-09-15T14:23:41Z',
        },
      },
      {
        insertAfterToken: 10,
        tool_name: 'get_config_value',
        args: { key: 'db.pool.max_connections', env: 'test' },
        result: { value: 32, source: 'test.env', overridable: true },
      },
    ],
  },
];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Server ─────────────────────────────────────────────────────────────────

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'normal';

const isChaos = mode === 'chaos';
console.log(`Agent server starting in ${isChaos ? 'CHAOS' : 'NORMAL'} mode`);

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', mode, uptime: process.uptime() }));
    return;
  }

  if (req.url === '/log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessionLogs));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const sessionLogs: SessionLog[] = [];

function logEvent(direction: 'client_to_server' | 'server_to_client', message: Record<string, unknown>) {
  sessionLogs.push({
    timestamp: new Date().toISOString(),
    direction,
    message,
  });
}

// ─── Connection Handler ─────────────────────────────────────────────────────

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  let seq = 0;
  let missedPongs = 0;
  const chaosEngine: ChaosEngine | null = isChaos ? new ChaosEngine() : null;
  const sentMessages: ServerEvent[] = [];
  const toolAckResolvers = new Map<string, () => void>();
  const pendingToolAckTimeouts = new Map<string, NodeJS.Timeout>();

  const nextSeq = (): number => ++seq;

  // ─── Send helpers ────────────────────────────────────────────────────

  const rawSend = (msg: ServerEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* connection may have closed */
    }
  };

  const sendMessage = (msg: ServerEvent) => {
    sentMessages.push(msg);
    logEvent('server_to_client', msg as unknown as Record<string, unknown>);

    if (chaosEngine && chaosEngine.shouldDuplicate()) {
      console.log(`[CHAOS] Duplicate seq=${msg.seq}`);
      rawSend(msg);
      rawSend(msg);
      return;
    }

    rawSend(msg);
  };

  const sendBatch = (messages: ServerEvent[]) => {
    if (chaosEngine && chaosEngine.shouldReorder() && messages.length > 1) {
      const shuffled = [...messages].sort(() => Math.random() - 0.5);
      console.log(`[CHAOS] Reordered batch of ${messages.length} messages`);
      shuffled.forEach(m => sendMessage(m));
    } else {
      messages.forEach(m => sendMessage(m));
    }
  };

  // ─── Heartbeat ──────────────────────────────────────────────────────

  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    let challenge: string;
    if (chaosEngine && chaosEngine.shouldCorruptHeartbeat()) {
      challenge = '';
      console.log('[CHAOS] Corrupt heartbeat (empty challenge)');
    } else {
      challenge = Math.random().toString(36).substring(2, 10);
    }

    sendMessage({ type: 'PING', seq: nextSeq(), challenge });

    missedPongs++;
    if (missedPongs >= 3) {
      console.log('3 missed PONGs → terminating connection');
      ws.terminate();
    }
  }, 5000 + Math.random() * 3000);

  // ─── Tool ACK waiting ──────────────────────────────────────────────

  const waitForToolAck = (callId: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`TOOL_ACK timeout for ${callId} (protocol violation)`);
        pendingToolAckTimeouts.delete(callId);
        toolAckResolvers.delete(callId);
        resolve();
      }, 5000);

      pendingToolAckTimeouts.set(callId, timeout);
      toolAckResolvers.set(callId, () => {
        clearTimeout(timeout);
        pendingToolAckTimeouts.delete(callId);
        toolAckResolvers.delete(callId);
        resolve();
      });
    });
  };

  // ─── Agent Response Stream ─────────────────────────────────────────

  const handleUserMessage = async (content: string) => {
    const response = AGENT_RESPONSES[Math.floor(Math.random() * AGENT_RESPONSES.length)];
    const streamId = `s_${Date.now().toString(36)}`;
    const contextId = `ctx_${Date.now().toString(36)}`;

    // Initial context snapshot
    let contextData = { ...response.context } as Record<string, unknown>;
    if (chaosEngine && chaosEngine.shouldSendOversizedContext()) {
      console.log('[CHAOS] Oversized context snapshot (500KB+)');
      const bigArray: string[] = [];
      for (let i = 0; i < 10000; i++) {
        bigArray.push(`data_entry_${i}_${'x'.repeat(50)}_${Math.random().toString(36)}`);
      }
      contextData = {
        ...contextData,
        extended_data: bigArray,
        metadata: {
          records: Array.from({ length: 1000 }, (_, i) => ({
            id: `rec_${i}`,
            value: Math.random() * 10000,
            label: `Record ${i} with extended description for size padding`,
            tags: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'],
            nested: { sub1: `v_${i}_a`, sub2: `v_${i}_b`, sub3: { deep: `n_${i}` } },
          })),
        },
      };
    }

    sendMessage({
      type: 'CONTEXT_SNAPSHOT',
      seq: nextSeq(),
      context_id: contextId,
      data: contextData,
    });

    // Build tool call index map
    const toolCallsByTokenIndex = new Map<number, typeof response.toolCalls[0]>();
    for (const tc of response.toolCalls) {
      toolCallsByTokenIndex.set(tc.insertAfterToken, tc);
    }

    const batchBuffer: ServerEvent[] = [];

    for (let i = 0; i < response.tokens.length; i++) {
      // Chaos: drop connection mid-stream
      if (chaosEngine && chaosEngine.shouldDropConnection()) {
        console.log('[CHAOS] Connection drop mid-stream');
        ws.terminate();
        return;
      }

      // Chaos: latency spike
      if (chaosEngine && chaosEngine.shouldLatencySpike()) {
        const spike = 2000 + Math.random() * 6000;
        console.log(`[CHAOS] Latency spike: ${Math.round(spike)}ms`);
        await delay(spike);
      }

      // Token event
      const tokenMsg: ServerEvent = {
        type: 'TOKEN',
        seq: nextSeq(),
        stream_id: streamId,
        text: response.tokens[i],
      };

      if (chaosEngine && chaosEngine.shouldBatchReorder()) {
        batchBuffer.push(tokenMsg);
        if (batchBuffer.length >= 3 + Math.floor(Math.random() * 3)) {
          sendBatch([...batchBuffer]);
          batchBuffer.length = 0;
        }
      } else {
        sendMessage(tokenMsg);
      }

      // Tool call after this token?
      const toolCall = toolCallsByTokenIndex.get(i);
      if (toolCall) {
        // Flush batch first
        if (batchBuffer.length > 0) {
          sendBatch([...batchBuffer]);
          batchBuffer.length = 0;
        }

        const callId = `tc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

        if (chaosEngine && chaosEngine.shouldRapidToolCall()) {
          // ─── Rapid double tool call ─────────────────────────────
          console.log('[CHAOS] Rapid tool calls');
          const callId2 = `tc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

          sendMessage({
            type: 'TOOL_CALL', seq: nextSeq(), call_id: callId,
            tool_name: toolCall.tool_name, args: toolCall.args, stream_id: streamId,
          });
          sendMessage({
            type: 'TOOL_CALL', seq: nextSeq(), call_id: callId2,
            tool_name: 'validate_data',
            args: { source: toolCall.tool_name, cross_check: true },
            stream_id: streamId,
          });

          await waitForToolAck(callId);
          sendMessage({
            type: 'TOOL_RESULT', seq: nextSeq(), call_id: callId,
            result: toolCall.result, stream_id: streamId,
          });

          await waitForToolAck(callId2);
          sendMessage({
            type: 'TOOL_RESULT', seq: nextSeq(), call_id: callId2,
            result: { valid: true, confidence: 0.94, source: 'cross_reference' },
            stream_id: streamId,
          });

          // Updated context
          sendMessage({
            type: 'CONTEXT_SNAPSHOT', seq: nextSeq(), context_id: contextId,
            data: { ...response.context, last_tool_call: callId2, validation: 'passed' },
          });
        } else {
          // ─── Normal single tool call ────────────────────────────
          sendMessage({
            type: 'TOOL_CALL', seq: nextSeq(), call_id: callId,
            tool_name: toolCall.tool_name, args: toolCall.args, stream_id: streamId,
          });

          await waitForToolAck(callId);
          await delay(500 + Math.random() * 1500);

          sendMessage({
            type: 'TOOL_RESULT', seq: nextSeq(), call_id: callId,
            result: toolCall.result, stream_id: streamId,
          });
        }
      }

      // Inter-token delay
      await delay(30 + Math.random() * 50);
    }

    // Flush remaining
    if (batchBuffer.length > 0) {
      sendBatch([...batchBuffer]);
    }

    sendMessage({ type: 'STREAM_END', seq: nextSeq(), stream_id: streamId });
  };

  // ─── Client Message Handler ───────────────────────────────────────

  ws.on('message', (data: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.error('Failed to parse client message');
      return;
    }

    logEvent('client_to_server', msg as unknown as Record<string, unknown>);
    console.log(`← ${msg.type}`, msg.type === 'PONG' ? `echo=${msg.echo}` : JSON.stringify(msg));

    switch (msg.type) {
      case 'USER_MESSAGE':
        if (msg.content) handleUserMessage(msg.content);
        break;

      case 'PONG':
        missedPongs = Math.max(0, missedPongs - 1);
        break;

      case 'RESUME': {
        const lastSeq = msg.last_seq ?? 0;
        console.log(`RESUME from seq ${lastSeq}, replaying ${sentMessages.filter(e => e.seq > lastSeq).length} events`);
        const toReplay = sentMessages.filter(e => e.seq > lastSeq);
        for (const event of toReplay) {
          rawSend(event);
        }
        break;
      }

      case 'TOOL_ACK':
        if (msg.call_id) {
          console.log(`TOOL_ACK for ${msg.call_id}`);
          const resolver = toolAckResolvers.get(msg.call_id);
          if (resolver) resolver();
        }
        break;
    }
  });

  // ─── Cleanup ──────────────────────────────────────────────────────

  ws.on('close', () => {
    console.log('Client disconnected');
    clearInterval(heartbeatInterval);
    for (const timeout of pendingToolAckTimeouts.values()) clearTimeout(timeout);
  });

  ws.on('error', (err) => console.error('WS error:', err.message));
});

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = 4747;
httpServer.listen(PORT, () => {
  console.log(`Agent server on :${PORT} [${isChaos ? 'CHAOS' : 'NORMAL'}]`);
  console.log(`  ws://localhost:${PORT}/ws`);
  console.log(`  http://localhost:${PORT}/health`);
  console.log(`  http://localhost:${PORT}/log`);
});
