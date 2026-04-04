import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../stores/useAppStore';

export function useWebSocketConnection() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const { setWsConnected, addEvent } = useAppStore();

  const connect = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
    }

    // Determine WebSocket URL
    const isDev = import.meta.env.DEV;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // In dev: WS on port 3002; in production: use configured WS_URL or same host
    let wsHost: string;
    if (isDev) {
      // Use same hostname as the page (handles localhost, 127.0.0.1, etc.)
      wsHost = `${window.location.hostname}:3002`;
    } else {
      wsHost = import.meta.env.VITE_WS_URL || `${window.location.host}/ws`;
    }
    
    const wsUrl = `${protocol}//${wsHost}`;
    
    console.log('[WS] Connecting to:', wsUrl, '(dev:', isDev, ')');
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected successfully');
        setWsConnected(true);
        reconnectAttempts.current = 0;
      };
      
      ws.onerror = (err) => {
        console.error('[WS] Connection error:', err);
        setWsConnected(false);
      };
      
      ws.onclose = (event) => {
        console.log('[WS] Disconnected, code:', event.code, 'reason:', event.reason);
        setWsConnected(false);
        wsRef.current = null;
        
        // Exponential backoff for reconnection (max 30 seconds)
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`);
        
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WS] Event received:', data.type);
          addEvent(data);
        } catch {
          // ignore malformed JSON
        }
      };
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      setWsConnected(false);
      
      // Retry after delay
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current++;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    }
  }, [setWsConnected, addEvent]);

  useEffect(() => {
    connect();
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);
}
