'use client';

import { useConnectionStore } from '@/lib/stores/connection-store';
import styles from './ConnectionStatus.module.css';

const STATE_LABELS: Record<string, string> = {
  DISCONNECTED: 'Disconnected',
  CONNECTING: 'Connecting...',
  CONNECTED: 'Connected',
  RECONNECTING: 'Reconnecting...',
  RESUMING: 'Resuming...',
};

export function ConnectionStatus() {
  const state = useConnectionStore((s) => s.state);
  const lastProcessedSeq = useConnectionStore((s) => s.lastProcessedSeq);

  const stateClass = state.toLowerCase();

  return (
    <>
      <div
        className={`${styles.statusPill} ${styles[stateClass] ?? ''}`}
        id="connection-status"
      >
        <div className={styles.statusDot} />
        {STATE_LABELS[state] ?? state}
        {lastProcessedSeq > 0 && (
          <span className={styles.seqInfo}>seq:{lastProcessedSeq}</span>
        )}
      </div>

      {/* Non-blocking reconnection banner */}
      {(state === 'RECONNECTING' || state === 'RESUMING') && (
        <div className={styles.reconnectBanner} id="reconnect-banner">
          <div className={styles.reconnectSpinner} />
          {state === 'RECONNECTING'
            ? 'Connection lost. Reconnecting...'
            : 'Reconnected. Resuming session...'}
        </div>
      )}
    </>
  );
}
