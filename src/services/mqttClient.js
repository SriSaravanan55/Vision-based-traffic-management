/**
 * Resilient MQTT over WebSockets client (ws://localhost:9001)
 * Subscribes to:
 * - traffic/+/counts (retained)
 * - traffic/signal_state (retained)
 * - traffic/emergency (QoS 1)
 */

import mqtt from 'mqtt';

export function connectTrafficMqtt({
  brokerUrl = 'ws://localhost:9001',
  onSignalState,
  onLaneCounts,
  onEmergency,
  onStatusChange,
}) {
  let client = null;
  let closedByUser = false;

  const notifyStatus = (status, detail = '') => {
    if (typeof onStatusChange === 'function') {
      onStatusChange({ status, detail, brokerUrl });
    }
  };

  try {
    notifyStatus('connecting', `Connecting to ${brokerUrl}`);
    client = mqtt.connect(brokerUrl, {
      clientId: `traffic_ops_console_${Math.random().toString(16).slice(2, 8)}`,
      connectTimeout: 4000,
      reconnectPeriod: 3500,
      clean: true,
    });

    client.on('connect', () => {
      if (closedByUser) return;
      notifyStatus('connected', `Streaming via ${brokerUrl}`);
      client.subscribe(['traffic/+/counts', 'traffic/signal_state'], { qos: 0 });
      client.subscribe('traffic/emergency', { qos: 1 });
    });

    client.on('reconnect', () => {
      if (closedByUser) return;
      notifyStatus('reconnecting', `Reconnecting to ${brokerUrl}...`);
    });

    client.on('offline', () => {
      if (closedByUser) return;
      notifyStatus('offline', `Broker unreachable at ${brokerUrl} (waiting for Mosquitto)`);
    });

    client.on('error', (err) => {
      if (closedByUser) return;
      notifyStatus('offline', err?.message || 'WebSocket connection error');
    });

    client.on('message', (topic, messageBuffer) => {
      if (closedByUser) return;
      try {
        const payload = JSON.parse(messageBuffer.toString('utf-8'));
        if (topic === 'traffic/signal_state') {
          onSignalState?.(payload);
        } else if (topic === 'traffic/emergency') {
          onEmergency?.(payload);
        } else if (topic.startsWith('traffic/') && topic.endsWith('/counts')) {
          const parts = topic.split('/');
          const lane = parts[1];
          onLaneCounts?.(lane, payload);
        }
      } catch {
        // Ignore malformed JSON frames without crashing
      }
    });
  } catch (err) {
    notifyStatus('offline', err?.message || 'MQTT initialization failed');
  }

  return {
    disconnect() {
      closedByUser = true;
      if (client) {
        try {
          client.end(true);
        } catch {
          // Ignore close errors
        }
      }
    },
  };
}
