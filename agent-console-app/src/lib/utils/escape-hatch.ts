/**
 * Escape Hatch — The single documented file where `any` types are allowed.
 *
 * WHY THIS EXISTS:
 * The WebSocket protocol receives raw JSON from an external server.
 * At the boundary between "unknown external data" and "typed internal data",
 * we need a controlled parsing layer. This file contains that boundary.
 *
 * Every function here takes `unknown` and returns a typed result or throws.
 * No `any` leaks beyond this module.
 */

/* eslint-disable */

import type { ServerMessage } from '../protocol/types';
import { isServerMessage } from '../protocol/types';

/**
 * Parse a raw WebSocket message into a ServerMessage.
 * Throws if the message is not valid.
 */
export function parseServerMessage(raw: unknown): ServerMessage {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('Failed to parse WebSocket message as JSON');
    }
  }

  if (!isServerMessage(raw)) {
    throw new Error(`Invalid server message: ${JSON.stringify(raw).substring(0, 200)}`);
  }

  return raw;
}

/**
 * Safely stringify an object for display, handling circular references
 * and very large objects.
 */
export function safeStringify(obj: unknown, maxLength = 10000): string {
  try {
    const seen = new WeakSet();
    const str = JSON.stringify(obj, (_key: string, value: any) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }, 2);
    if (str && str.length > maxLength) {
      return str.substring(0, maxLength) + '... (truncated)';
    }
    return str ?? 'undefined';
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Deep clone an object safely. Falls back to JSON parse/stringify
 * for objects without circular references.
 */
export function safeDeepClone<T>(obj: T): T {
  try {
    return structuredClone(obj);
  } catch {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }
}


