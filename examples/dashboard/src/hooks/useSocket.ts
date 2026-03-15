import { useState, useEffect, useRef, useCallback } from 'react';
import type { WsEvent, CallInfo, TranscriptEntry } from '../types';

const WS_URL = `ws://${window.location.hostname}:4200`;

export interface SocketState {
  connected: boolean;
  agents: string[];
  calls: Map<string, CallInfo>;
  transcripts: Map<string, TranscriptEntry[]>;
  botTokens: Map<string, string>;
  events: WsEvent[];
  send: (msg: any) => void;
  heldCalls: Set<string>;
  mutedCalls: Set<string>;
  speakingCalls: Set<string>;
}

export function useSocket(): SocketState {
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [calls, setCalls] = useState<Map<string, CallInfo>>(new Map());
  const [transcripts, setTranscripts] = useState<Map<string, TranscriptEntry[]>>(new Map());
  const [botTokens, setBotTokens] = useState<Map<string, string>>(new Map());
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [heldCalls, setHeldCalls] = useState<Set<string>>(new Set());
  const [mutedCalls, setMutedCalls] = useState<Set<string>>(new Set());
  const [speakingCalls, setSpeakingCalls] = useState<Set<string>>(new Set());

  const send = useCallback((msg: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const socket = new WebSocket(WS_URL);
      ws.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket.close();

      socket.onmessage = (e) => {
        const evt: WsEvent = JSON.parse(e.data);

        // Log all events
        setEvents(prev => [...prev.slice(-200), evt]);

        switch (evt.event) {
          case 'server.connected':
            setAgents(evt.agents ?? []);
            break;

          case 'call.started':
            setCalls(prev => {
              const next = new Map(prev);
              next.set(evt.call_id!, {
                id: evt.call_id!,
                agent_id: evt.agent_id!,
                from: evt.from ?? '?',
                to: evt.to ?? '?',
                direction: evt.direction ?? 'inbound',
                startedAt: Date.now(),
              });
              return next;
            });
            setTranscripts(prev => {
              const next = new Map(prev);
              next.set(evt.call_id!, []);
              return next;
            });
            break;

          case 'call.ended':
            setCalls(prev => {
              const next = new Map(prev);
              next.delete(evt.call_id!);
              return next;
            });
            setHeldCalls(prev => { const s = new Set(prev); s.delete(evt.call_id!); return s; });
            setMutedCalls(prev => { const s = new Set(prev); s.delete(evt.call_id!); return s; });
            setSpeakingCalls(prev => { const s = new Set(prev); s.delete(evt.call_id!); return s; });
            break;

          case 'user.message':
            setTranscripts(prev => {
              const next = new Map(prev);
              const arr = [...(next.get(evt.call_id!) ?? [])];
              arr.push({ role: 'user', text: evt.text ?? '', timestamp: Date.now() });
              next.set(evt.call_id!, arr);
              return next;
            });
            break;

          case 'llm.token':
            setBotTokens(prev => {
              const next = new Map(prev);
              next.set(evt.call_id!, (next.get(evt.call_id!) ?? '') + (evt.token ?? ''));
              return next;
            });
            break;

          case 'llm.done':
          case 'bot.finished': {
            const callId = evt.call_id!;
            setBotTokens(prev => {
              const text = prev.get(callId);
              if (text) {
                setTranscripts(tp => {
                  const next = new Map(tp);
                  const arr = [...(next.get(callId) ?? [])];
                  arr.push({ role: 'bot', text, timestamp: Date.now() });
                  next.set(callId, arr);
                  return next;
                });
                const next = new Map(prev);
                next.delete(callId);
                return next;
              }
              return prev;
            });
            break;
          }

          case 'bot.speaking':
            setSpeakingCalls(prev => new Set(prev).add(evt.call_id!));
            break;
          case 'bot.finished':
          case 'bot.interrupted':
            setSpeakingCalls(prev => { const s = new Set(prev); s.delete(evt.call_id!); return s; });
            break;

          case 'call.held':
            setHeldCalls(prev => new Set(prev).add(evt.call_id!));
            break;
          case 'call.unheld':
            setHeldCalls(prev => { const s = new Set(prev); s.delete(evt.call_id!); return s; });
            break;
          case 'call.muted':
            setMutedCalls(prev => new Set(prev).add(evt.call_id!));
            break;
          case 'call.unmuted':
            setMutedCalls(prev => { const s = new Set(prev); s.delete(evt.call_id!); return s; });
            break;
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws.current?.close();
    };
  }, []);

  return { connected, agents, calls, transcripts, botTokens, events, send, heldCalls, mutedCalls, speakingCalls };
}
