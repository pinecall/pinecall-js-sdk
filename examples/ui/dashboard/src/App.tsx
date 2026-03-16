/**
 * App — Main layout. 3-column: Sidebar | Conversation | Right panel.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { useApi } from './hooks/useApi';
import { Sidebar } from './components/Sidebar';
import ConversationView from './components/ConversationView';
import EventLog from './components/EventLog';
import EventDetailModal from './components/EventDetailModal';
import DialpadPanel from './components/DialpadPanel';
import CallControlModal from './components/CallControlModal';
import AudioWaveform from './components/AudioWaveform';
import StatusDot from './components/shared/StatusDot';
import { PhoneCall, PhoneOff, Mic, MicOff } from 'lucide-react';
import { formatDuration } from './utils';
import type { EventEntry, PhoneInfo } from './types';

export default function App() {
  const socket = useSocket();
  const webrtc = useWebRTC();
  const api = useApi();
  const [selectedEvent, setSelectedEvent] = useState<EventEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phones, setPhones] = useState<PhoneInfo[]>([]);

  const onRefresh = useCallback(() => setRefreshKey(k => k + 1), []);
  const isPhoneCall = socket.callStatus !== 'idle';
  const isWebRTCCall = webrtc.status === 'connected';
  const isAnythingActive = isPhoneCall || isWebRTCCall;

  // Track WebRTC status to detect when it ends and save to history
  const prevWebRTCRef = useRef(webrtc.status);
  const prevWebRTCMsgsRef = useRef(webrtc.messages);
  const prevWebRTCDurRef = useRef(webrtc.duration);

  useEffect(() => {
    // WebRTC just disconnected — save to history
    if (prevWebRTCRef.current === 'connected' && webrtc.status === 'idle') {
      const msgs = prevWebRTCMsgsRef.current;
      const dur = prevWebRTCDurRef.current;
      if (msgs.length > 0) {
        socket.saveWebRTCToHistory(msgs, dur);
      }
    }
    prevWebRTCRef.current = webrtc.status;
    prevWebRTCMsgsRef.current = webrtc.messages;
    prevWebRTCDurRef.current = webrtc.duration;
  }, [webrtc.status, webrtc.messages, webrtc.duration, socket.saveWebRTCToHistory]);

  // Messages to display
  const displayMessages = useMemo(() => {
    // Viewing history? Show that call's messages
    if (socket.viewingHistoryId) {
      const entry = socket.callHistory.find(h => h.id === socket.viewingHistoryId);
      return entry?.messages ?? [];
    }
    // Active WebRTC call → show WebRTC messages
    if (isWebRTCCall) return webrtc.messages;
    // Active phone call → show phone messages
    if (isPhoneCall) return socket.messages;
    // No active call — show whichever has messages (last call's messages stay visible)
    if (webrtc.messages.length > 0 && socket.messages.length === 0) return webrtc.messages;
    return socket.messages;
  }, [socket.viewingHistoryId, socket.callHistory, isWebRTCCall, isPhoneCall, webrtc.messages, socket.messages]);

  const handleStartWebRTC = useCallback(async () => {
    const agents = socket.agents;
    const appId = agents[0];
    if (!appId) return;
    await webrtc.startCall(appId);
  }, [socket.agents, webrtc]);

  // Fetch phones from REST when connected
  useEffect(() => {
    if (socket.connected) {
      api.fetchPhones().then(setPhones).catch(() => {});
    }
  }, [socket.connected, refreshKey, api.fetchPhones]);

  // Combine phone sources
  const allPhones = [
    ...new Set([
      ...socket.activePhones,
      ...phones.map(p => p.number),
    ]),
  ];

  // Pick correct metrics refs
  const activeUserMetrics = isWebRTCCall ? webrtc.userMetrics : socket.userMetrics;
  const activeBotMetrics = isWebRTCCall ? webrtc.botMetrics : socket.botMetrics;
  const activeDuration = isWebRTCCall ? webrtc.duration : socket.duration;
  const isViewingHistory = !!socket.viewingHistoryId;

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: 'rgb(24, 12, 36)', color: 'rgb(238, 240, 250)' }}>
      {/* Left Sidebar */}
      <Sidebar
        key={refreshKey}
        connected={socket.connected}
        agents={socket.agents}
        calls={socket.calls}
        activePhones={allPhones}
        fetchAgents={api.fetchAgents}
        fetchPhones={api.fetchPhones}
        deleteAgent={api.deleteAgent}
        createAgent={api.createAgent}
        onRefresh={onRefresh}
        callHistory={socket.callHistory}
        viewingHistoryId={socket.viewingHistoryId}
        onViewHistory={socket.viewHistoryCall}
        isAnythingActive={isAnythingActive}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header className="h-12 flex items-center justify-between px-6" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
          <div className="flex items-center gap-3">
            {isViewingHistory ? (
              <>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(100,75,140,0.2)', color: 'rgb(160,140,190)' }}>history</span>
                <span className="text-sm" style={{ color: 'var(--pc-text-medium)' }}>
                  {socket.callHistory.find(h => h.id === socket.viewingHistoryId)?.from || 'Call'}
                </span>
                <button onClick={() => socket.viewHistoryCall(null)} className="text-[10px] px-2 py-0.5 rounded-md cursor-pointer transition-colors hover:brightness-125"
                  style={{ background: 'rgba(190,124,255,0.1)', color: 'var(--pc-primary-light)' }}>
                  ← Back to live
                </button>
              </>
            ) : isAnythingActive ? (
              <>
                <StatusDot status={isWebRTCCall ? 'listening' : socket.callStatus} size="md" />
                <span className="font-medium text-sm" style={{ color: 'var(--pc-text-light)' }}>
                  {isWebRTCCall ? 'WebRTC Call' : socket.sessionType === 'phone' ? `Call from ${socket.sessionFrom}` : 'Session'}
                </span>
                <span style={{ color: 'var(--pc-text-medium)', opacity: 0.2 }}>|</span>
                <span className="text-sm font-mono tabular-nums" style={{ color: 'var(--pc-text-medium)' }}>{formatDuration(activeDuration)}</span>
                <span style={{ color: 'var(--pc-text-medium)', opacity: 0.2 }}>|</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{
                  background: socket.callStatus === 'listening' || isWebRTCCall ? 'rgba(92, 245, 152, 0.1)' : socket.callStatus === 'speaking' ? 'rgba(190, 124, 255, 0.1)' : 'rgba(255, 196, 60, 0.1)',
                  color: socket.callStatus === 'listening' || isWebRTCCall ? 'rgb(92, 245, 152)' : socket.callStatus === 'speaking' ? 'rgb(190, 124, 255)' : 'rgb(255, 196, 60)',
                }}>{isWebRTCCall ? 'webrtc' : socket.callStatus}</span>
              </>
            ) : (
              <span className="text-sm" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>
                Waiting for incoming call...
              </span>
            )}
          </div>

          {/* Call controls */}
          <div className="flex items-center gap-2">
            {!isAnythingActive && webrtc.status === 'idle' && socket.agents.length > 0 && socket.hasWebRTC && (
              <button
                onClick={handleStartWebRTC}
                disabled={!socket.connected}
                className="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md transition-all cursor-pointer hover:brightness-125 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: 'rgba(92, 245, 152, 0.08)', color: 'rgb(92, 245, 152)' }}
              >
                <PhoneCall size={13} />
                WebRTC Call
              </button>
            )}
            {webrtc.status === 'connecting' && (
              <div className="flex items-center gap-1.5 text-xs py-1.5 px-3" style={{ color: 'rgb(255, 196, 60)' }}>
                <span className="w-3 h-3 border-2 border-[rgba(255,196,60,0.3)] border-t-[rgb(255,196,60)] rounded-full animate-spin" />
                Connecting…
              </div>
            )}
            {isWebRTCCall && (
              <>
                <button
                  onClick={webrtc.toggleMute}
                  className="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md transition-all cursor-pointer hover:brightness-125 active:scale-[0.97]"
                  style={{
                    background: webrtc.isMuted ? 'rgba(255, 107, 178, 0.12)' : 'rgba(92, 245, 152, 0.06)',
                    color: webrtc.isMuted ? 'rgb(255, 107, 178)' : 'rgb(160, 140, 190)',
                  }}
                >
                  {webrtc.isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                  {webrtc.isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={webrtc.endCall}
                  className="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md transition-all cursor-pointer hover:brightness-125 active:scale-[0.97]"
                  style={{ background: 'rgba(255, 107, 107, 0.08)', color: 'rgb(255, 107, 107)' }}
                >
                  <PhoneOff size={13} />
                  End Call
                </button>
              </>
            )}
            {webrtc.error && (
              <span className="text-xs" style={{ color: 'rgb(255, 107, 107)' }}>{webrtc.error}</span>
            )}
          </div>
        </header>

        {/* Conversation */}
        <ConversationView
          messages={displayMessages}
          onClear={socket.clearMessages}
          isInCall={isAnythingActive}
          send={socket.send}
          sessionId={socket.sessionId}
        />
      </main>

      {/* Right Sidebar */}
      <aside className="w-80 flex flex-col overflow-hidden" style={{ background: 'rgb(26, 13, 39)', borderLeft: '1px solid rgba(60,30,90,0.6)' }}>
        {/* Audio waveform — only during active calls */}
        {isAnythingActive && (
          <AudioWaveform
            userMetricsRef={activeUserMetrics}
            botMetricsRef={activeBotMetrics}
            isInCall={isAnythingActive}
          />
        )}

        {/* Phone call controls — only for active phone calls (not WebRTC) */}
        {isPhoneCall && !isWebRTCCall && (
          <CallControlModal
            sessionId={socket.sessionId}
            send={socket.send}
            onHangup={() => socket.sessionId && api.hangup(socket.sessionId)}
          />
        )}

        {/* WebRTC call info — only during WebRTC calls */}
        {isWebRTCCall && (
          <div className="px-5 py-3 space-y-2" style={{ borderBottom: '1px solid rgba(60,30,90,0.4)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>WebRTC Session</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(92,245,152)' }} />
                <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--pc-text-medium)' }}>{formatDuration(webrtc.duration)}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={webrtc.toggleMute}
                className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all text-[10px] cursor-pointer"
                style={{
                  background: webrtc.isMuted ? 'rgba(255,107,178,0.12)' : 'rgba(35,18,55,0.7)',
                  border: `1px solid ${webrtc.isMuted ? 'rgba(255,107,178,0.25)' : 'rgba(60,30,90,0.3)'}`,
                  color: webrtc.isMuted ? 'rgb(255,107,178)' : 'rgb(160,140,190)',
                }}>
                {webrtc.isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                {webrtc.isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={webrtc.endCall}
                className="flex flex-col items-center gap-1 py-2 rounded-lg transition-all text-[10px] cursor-pointer"
                style={{
                  background: 'rgba(255,107,107,0.08)',
                  border: '1px solid rgba(255,107,107,0.15)',
                  color: 'rgb(255,107,107)',
                }}>
                <PhoneOff size={14} />
                End Call
              </button>
            </div>
          </div>
        )}

        {/* Dialpad — only when NO active call */}
        {!isAnythingActive && (
          <DialpadPanel
            activePhones={allPhones}
            agents={socket.agents}
            sessionId={socket.sessionId}
            isInCall={false}
            sessionFrom={socket.sessionFrom}
            duration={socket.duration}
            hangup={api.hangup}
          />
        )}

        <EventLog
          events={socket.eventLog}
          onClear={socket.clearEvents}
          onSelectEvent={setSelectedEvent}
        />
      </aside>

      {/* Event Detail Modal */}
      <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
