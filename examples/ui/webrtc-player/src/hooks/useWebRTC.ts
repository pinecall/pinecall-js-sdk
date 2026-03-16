/**
 * useWebRTC — WebRTC voice call hook.
 *
 * Handles full lifecycle: mic → peer connection → data channel → events.
 * Extracted from the Pinecall dashboard for standalone use.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Message, AudioMetrics, DCEvent } from '../types';

export type WebRTCStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface WebRTCState {
  status: WebRTCStatus;
  error: string | null;
  startCall: (serverUrl: string, appId: string, token?: string) => Promise<void>;
  endCall: () => void;
  messages: Message[];
  events: DCEvent[];
  clearEvents: () => void;
  userMetrics: React.MutableRefObject<AudioMetrics | null>;
  botMetrics: React.MutableRefObject<AudioMetrics | null>;
  isMuted: boolean;
  toggleMute: () => void;
  duration: number;
}

export function useWebRTC(): WebRTCState {
  const [status, setStatus] = useState<WebRTCStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<DCEvent[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const botWordsRef = useRef<Record<string, { words: string[] }>>({});
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef = useRef<number>(0);

  const userMetrics = useRef<AudioMetrics | null>(null);
  const botMetrics = useRef<AudioMetrics | null>(null);

  const addMessage = useCallback((msg: Message) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const addEvent = useCallback((evt: DCEvent) => {
    setEvents(prev => [...prev.slice(-200), evt]);
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newMuted = !isMuted;
    stream.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify({ action: newMuted ? 'mute' : 'unmute' }));
    }
    setIsMuted(newMuted);
  }, [isMuted]);

  const endCall = useCallback(() => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (dcRef.current) { dcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; remoteAudioRef.current = null; }
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    userMetrics.current = null;
    botMetrics.current = null;
    setStatus('idle');
    setIsMuted(false);
  }, []);

  const handleDCEvent = useCallback((data: any) => {
    // Log event (skip noisy audio.metrics)
    if (data.event !== 'audio.metrics') {
      addEvent({ event: data.event, ...data });
    }

    switch (data.event) {
      case 'session.started':
        addMessage({ id: Date.now(), role: 'system', text: 'Session started' });
        break;

      case 'audio.metrics': {
        const metrics: AudioMetrics = {
          rms: data.rms ?? 0,
          peak: data.peak ?? 0,
          energy_db: data.energy_db ?? -100,
          is_speech: data.is_speech ?? false,
          vad_prob: data.vad_prob ?? 0,
        };
        if (data.source === 'user') userMetrics.current = metrics;
        else botMetrics.current = metrics;
        break;
      }

      case 'user.speaking':
        if (data.text) {
          setMessages(prev => {
            const idx = prev.findLastIndex((m: Message) => m.role === 'user' && m.isInterim);
            if (idx >= 0) return prev.map((m, i) => i === idx ? { ...m, text: data.text } : m);
            return [...prev, { id: Date.now(), role: 'user', text: data.text, isInterim: true }];
          });
        }
        break;

      case 'user.message':
        if (data.text) {
          setMessages(prev => {
            const idx = prev.findLastIndex((m: Message) => m.role === 'user' && m.isInterim);
            if (idx >= 0) return prev.map((m, i) => i === idx ? { ...m, text: data.text, isInterim: false } : m);
            return [...prev, { id: Date.now(), role: 'user', text: data.text, isInterim: false }];
          });
        }
        break;

      case 'bot.speaking':
        if (data.message_id) {
          addMessage({ id: Date.now(), role: 'bot', text: data.text || '…', messageId: data.message_id, speaking: true });
        }
        break;

      case 'bot.word':
        if (data.message_id && data.word) {
          const ref = botWordsRef.current;
          if (!ref[data.message_id]) ref[data.message_id] = { words: [] };
          ref[data.message_id].words[data.word_index ?? ref[data.message_id].words.length] = data.word;
          const newText = ref[data.message_id].words.filter(Boolean).join(' ');
          setMessages(prev => {
            const idx = prev.findIndex(m => m.messageId === data.message_id);
            if (idx >= 0) return prev.map((m, i) => i === idx ? { ...m, text: newText } : m);
            return [...prev, { id: Date.now(), role: 'bot', text: newText, messageId: data.message_id, speaking: true }];
          });
        }
        break;

      case 'bot.finished':
        if (data.message_id) {
          setMessages(prev => prev.map(m =>
            m.messageId === data.message_id
              ? { ...m, speaking: false, ...(data.text ? { text: data.text } : {}) }
              : m
          ));
        }
        break;

      case 'bot.interrupted':
        if (data.message_id) {
          setMessages(prev => prev.map(m =>
            m.messageId === data.message_id ? { ...m, speaking: false, interrupted: true } : m
          ));
        }
        break;
    }
  }, [addMessage, addEvent]);

  const startCall = useCallback(async (serverUrl: string, appId: string, token?: string) => {
    if (pcRef.current) return;

    try {
      setStatus('connecting');
      setError(null);
      setMessages([]);
      setEvents([]);
      setDuration(0);
      setIsMuted(false);
      botWordsRef.current = {};
      userMetrics.current = null;
      botMetrics.current = null;

      // ICE servers
      let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
      try {
        const r = await fetch(`${serverUrl}/webrtc/ice-servers`);
        if (r.ok) {
          const d = await r.json();
          iceServers = d.iceServers || d.ice_servers || iceServers;
        }
      } catch { /* STUN fallback */ }

      // Microphone
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));

      // Remote audio
      pc.ontrack = (e) => {
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = e.streams[0];
      };

      // Data channel
      const dc = pc.createDataChannel('events', { ordered: true });
      dcRef.current = dc;
      dc.onopen = () => {
        const ping = setInterval(() => {
          if (dc.readyState === 'open') dc.send('ping');
        }, 1000);
        dc.onclose = () => clearInterval(ping);
      };
      dc.onmessage = (msg) => {
        try { handleDCEvent(JSON.parse(msg.data)); } catch { /* ignore */ }
      };

      // Connection state
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStatus('connected');
          callStartRef.current = Date.now();
          durationTimerRef.current = setInterval(() => {
            setDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
          }, 1000);
          addMessage({ id: Date.now(), role: 'system', text: 'Connected — start talking!' });
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          endCall();
        }
      };

      // SDP offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);

      // Wait for ICE
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const timer = setTimeout(resolve, 2000);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
        };
      });

      // Send offer — token auth or plain app_id
      const body: Record<string, unknown> = {
        sdp: pc.localDescription!.sdp,
        type: pc.localDescription!.type,
      };

      let url = `${serverUrl}/webrtc/offer`;
      if (token) {
        body.token = token;
      } else {
        url += `?app_id=${encodeURIComponent(appId)}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `WebRTC offer failed: ${res.status}`);
      }

      const answer = await res.json();
      await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      endCall();
    }
  }, [handleDCEvent, addMessage, endCall]);

  useEffect(() => () => { endCall(); }, [endCall]);

  return { status, error, startCall, endCall, messages, events, clearEvents, userMetrics, botMetrics, isMuted, toggleMute, duration };
}
