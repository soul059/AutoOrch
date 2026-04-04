import { useState, useEffect, useCallback, useRef } from 'react';

export function useWebSocket(runId?: string) {
  const [events, setEvents] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // Use the same host as the page, with /ws path (proxied by nginx)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?runId=${runId || 'global'}`;
    
    console.log('[WebSocket] Connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      setConnected(true);
    };
    
    ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err);
      setConnected(false);
    };
    
    ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected, code:', event.code);
      setConnected(false);
      // Auto-reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WebSocket] Event received:', data.type);
        // Prepend new events, keep last 200
        setEvents(prev => [data, ...prev].slice(0, 200));
      } catch {
        // ignore malformed JSON
      }
    };

    return ws;
  }, [runId]);

  useEffect(() => {
    const ws = connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      ws.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
