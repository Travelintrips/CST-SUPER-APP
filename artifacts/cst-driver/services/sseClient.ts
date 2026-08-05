import { API_BASE_URL } from './api';

export type SSEEventHandler = (data: unknown) => void;

interface SSEClient {
  close: () => void;
}

export function connectDriverSSE(
  token: string,
  handlers: Record<string, SSEEventHandler>,
): SSEClient {
  let active = true;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (!active) return;
    try {
      const url = `${API_BASE_URL}/api/driver/events`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
      });

      if (!response.ok || !response.body) {
        scheduleReconnect();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (active) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const rawData = line.slice(6).trim();
            if (currentEvent && handlers[currentEvent]) {
              try {
                const parsed = JSON.parse(rawData) as unknown;
                handlers[currentEvent](parsed);
              } catch {
                // ignore parse error
              }
            }
            currentEvent = '';
          } else if (line === '') {
            currentEvent = '';
          }
        }
      }

      if (active) scheduleReconnect();
    } catch {
      if (active) scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (!active) return;
    reconnectTimer = setTimeout(() => {
      if (active) connect();
    }, 6_000);
  }

  connect();

  return {
    close() {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
    },
  };
}
