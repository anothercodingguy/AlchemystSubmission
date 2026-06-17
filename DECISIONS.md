# DECISIONS.md — Architectural Rationale

## 1. Seq-Based Ordering and Deduplication

### Data Structure: Min-Heap Priority Queue

I chose a **binary min-heap** keyed on `seq` for the reorder buffer. Here's why:

**Why not a sorted array?** Insertion is O(n) due to shifting. With tokens arriving at 30+ per second, this adds up.

**Why not a Map + iteration?** A Map<seq, message> gives O(1) insert, but draining consecutive messages requires iterating from `nextExpectedSeq` upward. In the worst case (large gap), you check many missing keys. The heap gives O(1) peek at the minimum, which is exactly what we need for draining.

**Why a heap specifically?** The access pattern is: insert arbitrarily, always consume the minimum. That's the textbook priority queue pattern. O(log n) insert, O(log n) pop, O(1) peek-min.

**Deduplication**: A `Set<number>` of processed seq values. Checked before insertion (O(1)). The set is retained across `resetTo()` calls because replayed messages after RESUME may include seqs we already processed.

**In practice**: In normal mode, the heap always has 0–1 elements (messages arrive in order, drain immediately). The heap's complexity only matters in chaos mode with burst reordering.

---

## 2. Preventing Layout Shift During Tool Call Interruptions

### The Segment Model

The key insight: a streaming response is not a "growing string" — it's an **ordered list of segments**.

```
TextSegment("Based on the Q3 report, revenue grew ")
ToolCallSegment(lookup_metric, {metric: "revenue_yoy"}) → {value: "23.4%"}
TextSegment("23.4% year-over-year, driven primarily by...")
```

**When a TOOL_CALL arrives:**
1. The current TextSegment is frozen (its text stops growing, `isComplete = true`)
2. A ToolCallSegment is appended to the array
3. The DOM for the frozen TextSegment is **never modified again** — no reflow

**When TOOL_RESULT arrives:**
1. The ToolCallSegment updates its `result` field and `status → completed`
2. A new empty TextSegment is appended
3. Subsequent TOKENs flow into this new segment

**CSS strategy:**
- Each segment is a `display: block` (or `display: inline` for text) element
- Text uses `white-space: pre-wrap` for faithful rendering
- New segments **append below** — they never modify elements above them
- The tool card is a self-contained component that transitions between states without changing dimensions

**Why this prevents layout shift:** The browser never needs to recalculate layout for elements above the insertion point. Frozen text stays put. The tool card is inserted, not replacing anything. Resumed text starts in a new element below. This is structural stability, not a CSS hack.

---

## 3. Reconnection State Recovery

### DOM-Consumed vs Socket-Received

The critical distinction:

- **Socket-received**: The message arrived on the WebSocket and was parsed.
- **DOM-consumed**: The message was processed by the store and its effects are reflected in the DOM.

For RESUME, we need to send `last_seq` = the highest seq that was **DOM-consumed**, not socket-received. Why? Because if the connection drops after we receive seq 15 but before we process it (e.g., it's in the reorder buffer waiting for seq 14), we'd lose seq 15 if we reported it as processed.

**Implementation:**
1. `ReorderBuffer.lastProcessedSeq` — updated by `markProcessed(seq)` which is called **after** the message handler dispatches to stores.
2. The store updates are synchronous (Zustand set() is sync), so by the time `markProcessed` is called, React will have the data in its next render.
3. On reconnect, we send `RESUME { last_seq: reorderBuffer.lastProcessedSeq }`.
4. The server replays everything after `last_seq`.
5. The reorder buffer's dedup set filters out any messages we already processed.

**Edge case — TOOL_ACK race condition:**
If the connection drops after we send TOOL_ACK but before the server processes it, the server may replay from before the TOOL_ACK. This means:
- We'll receive the TOOL_CALL again → dedup catches it (already processed)
- The server may timeout on TOOL_ACK → it sends TOOL_RESULT anyway (per protocol spec)
- We'll receive TOOL_RESULT → process it normally

This is a protocol-level race condition. The 5-second TOOL_ACK timeout creates a window where the client thinks it acknowledged, but the server hasn't received it. The protocol handles this by proceeding anyway, but there's a brief period where the server logs a "protocol violation" that's actually a network partition. **If I were designing the protocol, I'd make TOOL_ACK idempotent and resendable on reconnection.**

---

## 4. Scaling to 50 Concurrent Agent Streams

If this needed to handle 50 concurrent streams on one operations dashboard:

1. **Move the protocol layer to a Web Worker.** WebSocket parsing, reorder buffering, and dedup should not block the main thread. The worker posts ordered messages to the main thread via `postMessage`.

2. **Virtualize the chat list.** With 50 streams, you might have thousands of DOM nodes. Use virtual scrolling (react-window or a custom implementation) to only render visible messages.

3. **Aggregate the trace timeline.** 50 streams × 30 tokens/sec = 1500 events/sec. The timeline would need:
   - Worker-side batching (send timeline updates at 10fps, not per-event)
   - Virtual scrolling (absolute positioning, manual windowing)
   - Collapse all token groups by default

4. **Shard the stores.** Instead of one `streams` Map, use per-stream stores or a normalized store with selectors that only trigger re-renders for the stream being viewed.

5. **Connection multiplexing.** Instead of 50 WebSocket connections, use a single connection with stream-level multiplexing (the protocol already supports this via `stream_id`).

---

## 5. Scaling to 100x Longer Responses

For full document generation (think: 100-page reports instead of chat messages):

1. **Windowed text rendering.** Don't keep the entire accumulated text in a single DOM node. Split into chunks (e.g., 1000-character blocks) and only render visible chunks. This is essentially virtual scrolling for text.

2. **Incremental DOM updates.** Instead of setting `textContent = accumulated`, append a `TextNode` for each token batch. This avoids re-parsing the entire string on every update.

3. **Offscreen buffer.** Accumulate text in a string buffer in the store, but only render the last N characters in the "live" view. Add a "full view" mode that loads the complete text on demand.

4. **Memory management.** With 100x longer responses, the `segments` array could grow large. Consider a max segment count with compaction (merge consecutive completed TextSegments).

5. **Streaming persistence.** Write the accumulated text to IndexedDB periodically so a page refresh doesn't lose a 100-page document.

---

## State Management: Why Zustand?

**Considered alternatives:**
- **useState + useReducer**: Works for simple cases but leads to prop drilling across Chat, Timeline, and Context panels. All three need access to the same stream state.
- **Redux Toolkit**: Overkill for this. The boilerplate (slices, actions, reducers) adds complexity without benefit. RTK Query doesn't help here — we're not doing REST.
- **Jotai/Recoil**: Atomic state works but makes it harder to express the "segment model" as a coherent unit. The stream state machine (streaming → tool_paused → streaming → ended) is better modeled as a store with methods.
- **Zustand**: < 1KB, no boilerplate, no context providers. The `create()` function returns a hook that components can subscribe to with selectors (`useChatStore(s => s.streams.get(streamId))`). This means the Timeline doesn't re-render when the Chat updates, and vice versa. Perfect for high-frequency WebSocket updates.
