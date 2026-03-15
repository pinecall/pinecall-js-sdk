/**
 * useSocket — WebSocket hook with full event handling.
 * Ported from dev-ui PlayerPage.jsx handleEvent + WS logic.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Message, EventEntry, CallInfo, AudioMetrics, WsEvent } from '../types';
import { WS_URL } from '../config';

export interface SocketState {
  connected: boolean;
  agents: string[];
  calls: Map<string, CallInfo>;
  messages: Message[];
  eventLog: EventEntry[];
  callStatus: string;         // 'idle' | 'listening' | 'speaking' | 'pause' | 'ended'
  sessionId: string | null;
  sessionFrom: string | null;
  sessionType: string | null; // 'phone' | 'webrtc' | null
  duration: number;
  userMetrics: React.MutableRefObject<AudioMetrics | null>;
  botMetrics: React.MutableRefObject<AudioMetrics | null>;
  activePhones: string[];
  send: (msg: any) => void;
  clearMessages: () => void;
  clearEvents: () => void;
}

export function useSocket(): SocketState {
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<string[]>([]);
  const [calls, setCalls] = useState<Map<string, CallInfo>>(new Map());
  const [messages, setMessages] = useState<Message[]>([]);
  const [eventLog, setEventLog] = useState<EventEntry[]>([]);
  const [callStatus, setCallStatus] = useState('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionFrom, setSessionFrom] = useState<string | null>(null);
  const [sessionType, setSessionType] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [activePhones, setActivePhones] = useState<string[]>([]);

  const userMetrics = useRef<AudioMetrics | null>(null);
  const botMetrics = useRef<AudioMetrics | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback((msg: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);
  const clearEvents = useCallback(() => setEventLog([]), []);

  const addEvent = useCallback((eventName: string, direction: 'in' | 'out' | 'system', data: Record<string, any> = {}) => {
    setEventLog(prev => [{
      id: Date.now() + Math.random(),
      time: new Date(),
      event: eventName,
      direction,
      data,
    }, ...prev].slice(0, 100));
  }, []);

  const startDuration = useCallback(() => {
    if (durationRef.current) clearInterval(durationRef.current);
    setDuration(0);
    const startTime = Date.now();
    durationRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  }, []);

  const stopDuration = useCallback(() => {
    if (durationRef.current) { clearInterval(durationRef.current); durationRef.current = null; }
  }, []);

  const resetSession = useCallback(() => {
    setMessages([]);
    setCallStatus('idle');
    stopDuration();
    setDuration(0);
  }, [stopDuration]);

  // Event handler — mirrors dev-ui's handleEvent exactly
  const handleEvent = useCallback((data: WsEvent) => {
    const eventType = data.event;

    // audio.metrics → refs only, never in event log
    if (eventType === 'audio.metrics') {
      if (data.source === 'user') {
        userMetrics.current = { rms: data.rms, peak: data.peak, energy_db: data.energy_db, is_speech: data.is_speech, vad_prob: data.vad_prob };
      } else if (data.source === 'bot') {
        botMetrics.current = { rms: data.rms, peak: data.peak, energy_db: data.energy_db, is_speech: data.is_speech, vad_prob: data.vad_prob };
      }
      return;
    }

    addEvent(eventType, 'in', data);

    switch (eventType) {
      // ─── Server ─────────────────────────────────────────────────────
      case 'server.connected':
        setAgents(data.agents ?? []);
        break;

      // ─── Phone events ───────────────────────────────────────────────
      case 'phone.added':
        setActivePhones(prev => prev.includes(data.phone) ? prev : [...prev, data.phone]);
        break;
      case 'phone.removed':
        setActivePhones(prev => prev.filter(p => p !== data.phone));
        break;

      // ─── Call lifecycle ─────────────────────────────────────────────
      case 'call.started':
        resetSession();
        setSessionId(data.call_id);
        setSessionType('phone');
        setSessionFrom(data.from_number || data.from || 'Unknown');
        setCallStatus('listening');
        startDuration();
        setCalls(prev => {
          const next = new Map(prev);
          next.set(data.call_id, {
            id: data.call_id, agentId: data.agent_id ?? '',
            from: data.from_number || data.from || '?', to: data.to_number || data.to || '?',
            direction: data.direction ?? 'inbound', startedAt: Date.now(),
          });
          return next;
        });
        break;

      case 'call.ended':
        setCallStatus('ended');
        stopDuration();
        setSessionId(null);
        setSessionType(null);
        setSessionFrom(null);
        setDuration(0);
        if (data.call_id) {
          setCalls(prev => { const next = new Map(prev); next.delete(data.call_id); return next; });
        }
        break;

      // ─── User speech ────────────────────────────────────────────────
      case 'user.speaking':
        if (data.text) {
          setMessages(prev => {
            const msgs = [...prev];
            const lastUser = msgs.findLast(m => m.role === 'user' && !m.finalized);
            if (lastUser) {
              lastUser.text = data.text;
              lastUser.isInterim = true;
            } else {
              msgs.push({
                id: Date.now(), role: 'user', text: data.text,
                isInterim: true, turnId: data.turn_id,
              });
            }
            return msgs;
          });
        }
        setCallStatus('listening');
        break;

      case 'user.message':
        if (data.text) {
          setMessages(prev => {
            const msgs = [...prev];
            const lastUser = msgs.findLast(m => m.role === 'user' && !m.finalized);
            if (lastUser) {
              lastUser.text = data.text;
              lastUser.isInterim = false;
              lastUser.messageId = data.message_id;
            } else {
              msgs.push({
                id: Date.now(), role: 'user', text: data.text,
                isInterim: false, messageId: data.message_id,
              });
            }
            return msgs;
          });
        }
        break;

      // ─── Turn detection ─────────────────────────────────────────────
      case 'turn.pause':
        setMessages(prev => {
          const msgs = [...prev];
          const u = msgs.findLast(m => m.role === 'user' && !m.finalized);
          if (u) { u.status = 'pause'; u.probability = data.probability; u.isInterim = false; }
          return msgs;
        });
        setCallStatus('pause');
        break;

      case 'turn.end':
        setMessages(prev => {
          const msgs = [...prev];
          const u = msgs.findLast(m => m.role === 'user' && !m.finalized);
          if (u) { u.status = 'end'; u.probability = data.probability; u.finalized = true; u.isInterim = false; }
          return msgs;
        });
        setCallStatus('listening');
        break;

      case 'turn.resumed':
        setMessages(prev => {
          const msgs = [...prev];
          const u = msgs.findLast(m => m.role === 'user' && !m.finalized);
          if (u) { u.status = null; }
          return msgs;
        });
        setCallStatus('listening');
        break;

      // ─── Bot speech ─────────────────────────────────────────────────
      case 'bot.speaking':
        if (data.message_id) {
          setMessages(prev => [...prev, {
            id: Date.now(), role: 'bot', text: data.text || '',
            messageId: data.message_id, speaking: true, words: [],
          }]);
          setCallStatus('speaking');
        }
        break;

      case 'bot.word':
        if (data.message_id && data.word) {
          setMessages(prev => {
            const msgs = [...prev];
            const botMsg = msgs.find(m => m.messageId === data.message_id);
            if (botMsg) {
              if (!botMsg.words) botMsg.words = [];
              const idx = data.word_index ?? botMsg.words.length;
              if (idx >= botMsg.words.length) botMsg.words.push(data.word);
              botMsg.text = botMsg.words.join(' ');
            }
            return msgs;
          });
        }
        break;

      case 'bot.finished':
        if (data.message_id) {
          setMessages(prev => {
            const msgs = [...prev];
            const b = msgs.find(m => m.messageId === data.message_id);
            if (b) { b.speaking = false; if (data.text) b.text = data.text; }
            return msgs;
          });
          setCallStatus('listening');
        }
        break;

      case 'bot.interrupted':
        if (data.message_id) {
          setMessages(prev => {
            const msgs = [...prev];
            const b = msgs.find(m => m.messageId === data.message_id);
            if (b) { b.speaking = false; b.interrupted = true; }
            return msgs;
          });
          setCallStatus('listening');
        }
        break;

      // ─── Call control events → system messages ──────────────────────
      case 'call.dialing':
        setMessages(prev => [...prev, {
          id: Date.now(), role: 'system', type: 'call_control',
          text: `📞 Dialing ${data.to}${data.from_number ? ` from ${data.from_number}` : ''}...`,
        }]);
        break;
      case 'call.forwarded':
        setMessages(prev => [...prev, {
          id: Date.now(), role: 'system', type: 'call_control',
          text: `↪️ Call forwarded to ${data.to}`,
        }]);
        break;
      case 'call.dtmf_sent':
        setMessages(prev => [...prev, {
          id: Date.now(), role: 'system', type: 'call_control',
          text: `🔢 DTMF sent: ${data.digits}`,
        }]);
        break;
      case 'call.error':
        setMessages(prev => [...prev, {
          id: Date.now(), role: 'system', type: 'call_error',
          text: `❌ Error: ${data.error}${data.code ? ` (${data.code})` : ''}`,
        }]);
        break;

      default: break;
    }
  }, [addEvent, resetSession, startDuration, stopDuration]);

  // ─── WebSocket connection ─────────────────────────────────────────────
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const socket = new WebSocket(WS_URL);
      ws.current = socket;
      socket.onopen = () => { if (!cancelled) { setConnected(true); addEvent('ws.connected', 'system'); } };
      socket.onmessage = (e) => { if (!cancelled) { try { handleEvent(JSON.parse(e.data)); } catch {} } };
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        addEvent('ws.disconnected', 'system');
        reconnectTimer = setTimeout(connect, 2000);
      };
      socket.onerror = () => { if (!cancelled) addEvent('ws.error', 'system'); };
    }

    connect();
    return () => { cancelled = true; clearTimeout(reconnectTimer); ws.current?.close(); };
  }, [addEvent, handleEvent]);

  return {
    connected, agents, calls, messages, eventLog, callStatus,
    sessionId, sessionFrom, sessionType, duration,
    userMetrics, botMetrics, activePhones,
    send, clearMessages, clearEvents,
  };
}
