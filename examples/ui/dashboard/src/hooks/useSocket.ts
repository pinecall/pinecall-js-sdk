/**
 * useSocket — WebSocket hook with full event handling.
 * Ported from dev-ui PlayerPage.jsx handleEvent + WS logic.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Message, EventEntry, CallInfo, AudioMetrics, WsEvent } from '../types';
import { WS_URL } from '../config';

/** A completed call with its conversation snapshot */
export interface CallHistoryEntry {
  id: string;
  type: 'phone' | 'webrtc';
  from: string;
  to: string;
  direction: 'inbound' | 'outbound' | 'webrtc';
  startedAt: number;
  endedAt: number;
  duration: number;
  messages: Message[];
}

export interface SocketState {
  connected: boolean;
  agents: string[];
  calls: Map<string, CallInfo>;
  messages: Message[];
  eventLog: EventEntry[];
  callStatus: string;         // 'idle' | 'listening' | 'speaking' | 'pause'
  sessionId: string | null;
  sessionFrom: string | null;
  sessionType: string | null; // 'phone' | 'webrtc' | null
  duration: number;
  userMetrics: React.MutableRefObject<AudioMetrics | null>;
  botMetrics: React.MutableRefObject<AudioMetrics | null>;
  activePhones: string[];
  /** Whether any agent has a WebRTC channel registered */
  hasWebRTC: boolean;
  /** Language presets inferred from Phone channels */
  languages: Record<string, Record<string, unknown>>;
  /** Call history — completed calls with conversation snapshots */
  callHistory: CallHistoryEntry[];
  send: (msg: any) => void;
  clearMessages: () => void;
  clearEvents: () => void;
  /** View a historical call's messages */
  viewHistoryCall: (callId: string | null) => void;
  /** Currently viewed history call ID (null = live) */
  viewingHistoryId: string | null;
  /** Save WebRTC call to history (called from App when WebRTC ends) */
  saveWebRTCToHistory: (msgs: Message[], duration: number) => void;
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
  const [hasWebRTC, setHasWebRTC] = useState(false);
  const [languages, setLanguages] = useState<Record<string, Record<string, unknown>>>({});
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([]);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);

  const userMetrics = useRef<AudioMetrics | null>(null);
  const botMetrics = useRef<AudioMetrics | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Refs for values that handleEvent needs (avoids stale closures) ────
  const sessionIdRef = useRef<string | null>(null);
  const sessionFromRef = useRef<string | null>(null);
  const sessionTypeRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const callStartTimeRef = useRef(0);
  const durationValRef = useRef(0);

  // Keep refs in sync with state
  messagesRef.current = messages;
  durationValRef.current = duration;

  // Setters that update both state + ref
  const setSessionIdBoth = useCallback((v: string | null) => { sessionIdRef.current = v; setSessionId(v); }, []);
  const setSessionFromBoth = useCallback((v: string | null) => { sessionFromRef.current = v; setSessionFrom(v); }, []);
  const setSessionTypeBoth = useCallback((v: string | null) => { sessionTypeRef.current = v; setSessionType(v); }, []);

  const send = useCallback((msg: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);
  const clearEvents = useCallback(() => setEventLog([]), []);

  const viewHistoryCall = useCallback((callId: string | null) => {
    setViewingHistoryId(callId);
  }, []);

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
    callStartTimeRef.current = Date.now();
    const startTime = Date.now();
    durationRef.current = setInterval(() => {
      const d = Math.floor((Date.now() - startTime) / 1000);
      durationValRef.current = d;
      setDuration(d);
    }, 1000);
  }, []);

  const stopDuration = useCallback(() => {
    if (durationRef.current) { clearInterval(durationRef.current); durationRef.current = null; }
  }, []);

  // Save conversation to history — uses refs, no stale closure issue
  const pushHistory = useCallback((entry: CallHistoryEntry) => {
    setCallHistory(prev => [entry, ...prev].slice(0, 20));
  }, []);

  // Public method for App to save WebRTC calls
  const saveWebRTCToHistory = useCallback((msgs: Message[], dur: number) => {
    if (msgs.length === 0) return;
    pushHistory({
      id: `webrtc-${Date.now()}`,
      type: 'webrtc',
      from: 'WebRTC',
      to: '',
      direction: 'webrtc',
      startedAt: Date.now() - dur * 1000,
      endedAt: Date.now(),
      duration: dur,
      messages: [...msgs],
    });
  }, [pushHistory]);

  // ── Event handler — uses refs for session state to avoid stale closures ──
  // Dependencies are ONLY stable callbacks, never state variables.
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
        setConnected(true);
        setAgents(data.agents ?? []);
        // Set WebRTC availability from server snapshot
        if (data.hasWebRTC != null) setHasWebRTC(!!data.hasWebRTC);
        // Store language presets if available
        if (data.languages && data.languages.length > 0) {
          setLanguages(data.languages[0]);
        }
        break;
      case 'server.disconnected':
        setConnected(false);
        break;
      case 'server.reconnecting':
        break;

      // ─── Channel events ──────────────────────────────────────────────
      case 'channel.added':
        if (data.type === 'webrtc') setHasWebRTC(true);
        break;

      // ─── Phone events ───────────────────────────────────────────────
      case 'phone.added':
        setActivePhones(prev => prev.includes(data.phone) ? prev : [...prev, data.phone]);
        break;
      case 'phone.removed':
        setActivePhones(prev => prev.filter(p => p !== data.phone));
        break;

      // ─── Call lifecycle ─────────────────────────────────────────────
      case 'call.started': {
        // Save previous call to history if there was one
        const prevId = sessionIdRef.current;
        const prevFrom = sessionFromRef.current;
        const prevType = sessionTypeRef.current;
        const prevMsgs = messagesRef.current;
        if (prevId && prevMsgs.length > 0) {
          pushHistory({
            id: prevId,
            type: (prevType as 'phone' | 'webrtc') || 'phone',
            from: prevFrom || 'Unknown',
            to: '',
            direction: 'inbound',
            startedAt: callStartTimeRef.current || Date.now(),
            endedAt: Date.now(),
            duration: durationValRef.current,
            messages: [...prevMsgs],
          });
        }

        // Reset for new call
        setMessages([]);
        setCallStatus('listening');
        stopDuration();
        setSessionIdBoth(data.call_id);
        setSessionTypeBoth('phone');
        setSessionFromBoth(data.from_number || data.from || 'Unknown');
        startDuration();
        setViewingHistoryId(null); // Switch to live
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
      }

      case 'call.ended': {
        // Save current conversation to history
        const cid = data.call_id || sessionIdRef.current;
        const msgs = messagesRef.current;
        if (cid && msgs.length > 0) {
          pushHistory({
            id: cid,
            type: (sessionTypeRef.current as 'phone' | 'webrtc') || 'phone',
            from: sessionFromRef.current || 'Unknown',
            to: '',
            direction: 'inbound',
            startedAt: callStartTimeRef.current || Date.now(),
            endedAt: Date.now(),
            duration: durationValRef.current,
            messages: [...msgs],
          });
        }

        // Clear session
        setCallStatus('idle');
        stopDuration();
        setDuration(0);
        setSessionIdBoth(null);
        setSessionTypeBoth(null);
        setSessionFromBoth(null);
        // Keep messages visible until next call
        if (data.call_id) {
          setCalls(prev => { const next = new Map(prev); next.delete(data.call_id); return next; });
        }
        break;
      }

      // ─── User speech ────────────────────────────────────────────────
      case 'user.speaking':
        if (data.text) {
          setMessages(prev => {
            const lastIdx = prev.findLastIndex(m => m.role === 'user');
            const hasResponseAfter = lastIdx >= 0 && prev.slice(lastIdx + 1).some(m => m.role !== 'user');
            if (lastIdx >= 0 && !hasResponseAfter) {
              return prev.map((m, i) => i === lastIdx
                ? { ...m, text: data.text, isInterim: true, status: null, finalized: false, turnId: data.turn_id }
                : m
              );
            }
            return [...prev, {
              id: Date.now(), role: 'user' as const, text: data.text,
              isInterim: true, turnId: data.turn_id,
            }];
          });
        }
        setCallStatus('listening');
        break;

      case 'user.message':
        if (data.text) {
          setMessages(prev => {
            const idx = prev.findLastIndex(m => m.role === 'user' && !m.finalized);
            if (idx >= 0) {
              return prev.map((m, i) => i === idx
                ? { ...m, text: data.text, isInterim: false, messageId: data.message_id }
                : m
              );
            }
            return [...prev, {
              id: Date.now(), role: 'user' as const, text: data.text,
              isInterim: false, messageId: data.message_id,
            }];
          });
        }
        break;

      // ─── Turn detection ─────────────────────────────────────────────
      case 'turn.pause':
        setMessages(prev => {
          const idx = prev.findLastIndex(m => m.role === 'user' && !m.finalized);
          if (idx < 0) return prev;
          return prev.map((m, i) => i === idx
            ? { ...m, status: 'pause' as const, probability: data.probability, isInterim: false }
            : m
          );
        });
        setCallStatus('pause');
        break;

      case 'turn.end':
        setMessages(prev => {
          const idx = prev.findLastIndex(m => m.role === 'user' && !m.finalized);
          if (idx < 0) return prev;
          return prev.map((m, i) => i === idx
            ? { ...m, status: 'end' as const, probability: data.probability, finalized: true, isInterim: false }
            : m
          );
        });
        setCallStatus('listening');
        break;

      case 'turn.resumed':
        setMessages(prev => {
          const idx = prev.findLastIndex(m => m.role === 'user' && !m.finalized);
          if (idx < 0) return prev;
          return prev.map((m, i) => i === idx ? { ...m, status: null, finalized: false } : m);
        });
        setCallStatus('listening');
        break;

      // ─── Bot speech ─────────────────────────────────────────────────
      case 'bot.speaking':
        if (data.message_id) {
          setMessages(prev => [...prev, {
            id: Date.now(), role: 'bot' as const, text: data.text || '',
            messageId: data.message_id, speaking: true, words: [],
          }]);
          setCallStatus('speaking');
        }
        break;

      case 'bot.word':
        if (data.message_id && data.word) {
          setMessages(prev => prev.map(m => {
            if (m.messageId !== data.message_id) return m;
            const words = [...(m.words || [])];
            const idx = data.word_index ?? words.length;
            if (idx >= words.length) words.push(data.word);
            return { ...m, words, text: words.join(' ') };
          }));
        }
        break;

      case 'bot.finished':
        if (data.message_id) {
          setMessages(prev => prev.map(m =>
            m.messageId === data.message_id
              ? { ...m, speaking: false, ...(data.text ? { text: data.text } : {}) }
              : m
          ));
          setCallStatus('listening');
        }
        break;

      case 'bot.interrupted':
        if (data.message_id) {
          setMessages(prev => prev.map(m =>
            m.messageId === data.message_id
              ? { ...m, speaking: false, interrupted: true }
              : m
          ));
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
  // IMPORTANT: Only stable refs/callbacks in deps — NO state variables!
  }, [addEvent, pushHistory, startDuration, stopDuration, setSessionIdBoth, setSessionFromBoth, setSessionTypeBoth]);

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
    userMetrics, botMetrics, activePhones, hasWebRTC, languages, callHistory,
    send, clearMessages, clearEvents, viewHistoryCall, viewingHistoryId,
    saveWebRTCToHistory,
  };
}
