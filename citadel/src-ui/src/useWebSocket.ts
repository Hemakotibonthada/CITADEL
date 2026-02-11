/**
 * CITADEL — WebSocket Hook
 * 
 * Manages WebSocket connections to the Python backend
 * for real-time streaming of ticks, signals, portfolio, and CoT.
 * Handles React Strict Mode double-mount gracefully.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useStore, type AgentStatus } from './store';

// In dev, Vite proxies /ws → ws://localhost:8000 via the proxy config.
// Use the page origin so the Vite HMR proxy can intercept the upgrade request.
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_BASE = `${WS_PROTOCOL}//${window.location.host}/ws`;
const RECONNECT_DELAY = 5000;

export function useWebSocket() {
  const sockets = useRef<Record<string, WebSocket>>({});
  const reconnectTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isMounted = useRef(false);

  const setConnected = useStore((s) => s.setConnected);
  const updatePortfolio = useStore((s) => s.updatePortfolio);
  const updateAgents = useStore((s) => s.updateAgents);
  const addCotEntry = useStore((s) => s.addCotEntry);
  const setSystemState = useStore((s) => s.setSystemState);

  const handleMessage = useCallback((channel: string, msg: Record<string, unknown>) => {
    switch (channel) {
      case 'portfolio':
        if (msg.type === 'portfolio_update' && msg.data) {
          updatePortfolio(msg.data as Record<string, unknown>);
        }
        break;
      case 'agents':
        if (msg.type === 'agents_update' && msg.data) {
          updateAgents(msg.data as Record<string, AgentStatus>);
        }
        break;
      case 'cot':
        if (msg.type === 'cot_entry' && typeof msg.token === 'string') {
          addCotEntry(msg.token);
        } else if (msg.type === 'cot_token' && typeof msg.token === 'string') {
          addCotEntry(msg.token);
        }
        break;
      case 'system':
        if (msg.type === 'heartbeat' && typeof msg.state === 'string') {
          setSystemState(msg.state as 'IDLE' | 'LIVE');
        }
        break;
    }
  }, [updatePortfolio, updateAgents, addCotEntry, setSystemState]);

  const connect = useCallback((channel: string) => {
    // Don't connect if component is unmounted (React Strict Mode cleanup)
    if (!isMounted.current) return;

    // Clear any pending reconnect timer
    if (reconnectTimers.current[channel]) {
      clearTimeout(reconnectTimers.current[channel]);
      delete reconnectTimers.current[channel];
    }

    // Skip if already open or connecting
    const existing = sockets.current[channel];
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${WS_BASE}/${channel}`);
    } catch {
      // WebSocket creation can throw if URL is invalid
      reconnectTimers.current[channel] = setTimeout(() => connect(channel), RECONNECT_DELAY);
      return;
    }

    ws.onopen = () => {
      if (isMounted.current) {
        setConnected(true);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(channel, msg);
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      delete sockets.current[channel];
      // Only reconnect if still mounted
      if (isMounted.current) {
        reconnectTimers.current[channel] = setTimeout(() => connect(channel), RECONNECT_DELAY);
      }
    };

    ws.onerror = () => {
      // Suppress noisy console errors during dev — reconnect handles recovery
      if (isMounted.current) {
        setConnected(false);
      }
      // Force close so onclose fires and triggers reconnect
      try { ws.close(); } catch { /* ignore */ }
    };

    sockets.current[channel] = ws;
  }, [setConnected, handleMessage]);

  useEffect(() => {
    isMounted.current = true;
    const channels = ['portfolio', 'agents', 'system', 'cot'];
    channels.forEach(connect);

    return () => {
      isMounted.current = false;
      // Clear all reconnect timers
      Object.values(reconnectTimers.current).forEach(clearTimeout);
      reconnectTimers.current = {};
      // Close all sockets
      Object.values(sockets.current).forEach((ws) => {
        ws.onclose = null; // Prevent reconnect on cleanup close
        ws.close();
      });
      sockets.current = {};
    };
  }, [connect]);

  return {
    send: (channel: string, data: Record<string, unknown>) => {
      const ws = sockets.current[channel];
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    },
  };
}
