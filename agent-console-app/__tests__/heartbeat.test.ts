/**
 * HeartbeatManager — Unit Tests
 */

import { HeartbeatManager } from '../src/lib/protocol/heartbeat';
import type { PingMessage, PongPayload } from '../src/lib/protocol/types';

function makePing(seq: number, challenge: string): PingMessage {
  return { type: 'PING', seq, challenge };
}

describe('HeartbeatManager', () => {
  let manager: HeartbeatManager;
  let sentPongs: PongPayload[];

  beforeEach(() => {
    manager = new HeartbeatManager();
    sentPongs = [];
    manager.setSendFn((pong) => sentPongs.push(pong));
  });

  test('responds to normal PING with correct echo', () => {
    const result = manager.handlePing(makePing(1, 'abc123'));
    expect(result).toBe(true);
    expect(sentPongs).toHaveLength(1);
    expect(sentPongs[0]).toEqual({ type: 'PONG', echo: 'abc123' });
  });

  test('responds to PING with empty challenge (corrupt heartbeat)', () => {
    const result = manager.handlePing(makePing(1, ''));
    expect(result).toBe(true);
    expect(sentPongs).toHaveLength(1);
    expect(sentPongs[0]).toEqual({ type: 'PONG', echo: '' });
  });

  test('tracks stats correctly', () => {
    manager.handlePing(makePing(1, 'a'));
    manager.handlePing(makePing(2, ''));
    manager.handlePing(makePing(3, 'b'));

    const stats = manager.getStats();
    expect(stats.totalPings).toBe(3);
    expect(stats.totalPongs).toBe(3);
    expect(stats.corruptPings).toBe(1);
    expect(stats.lastPingTime).toBeGreaterThan(0);
  });

  test('returns false if no send function set', () => {
    const mgr = new HeartbeatManager();
    // No setSendFn called
    const result = mgr.handlePing(makePing(1, 'test'));
    expect(result).toBe(false);
  });

  test('handles send function that throws', () => {
    manager.setSendFn(() => {
      throw new Error('Connection closed');
    });
    const result = manager.handlePing(makePing(1, 'test'));
    expect(result).toBe(false);
  });

  test('reset clears lastPingTime but keeps stats', () => {
    manager.handlePing(makePing(1, 'a'));
    expect(manager.getStats().lastPingTime).toBeGreaterThan(0);

    manager.reset();
    expect(manager.getStats().lastPingTime).toBe(0);
    expect(manager.getStats().totalPings).toBe(1); // Stats preserved
  });
});
