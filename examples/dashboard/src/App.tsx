/**
 * App — Main layout. 3-column: Sidebar | Conversation | Right panel.
 * Ported from dev-ui PlayerPage layout.
 */
import { useState, useCallback, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { useApi } from './hooks/useApi';
import { Sidebar } from './components/Sidebar';
import ConversationView from './components/ConversationView';
import EventLog from './components/EventLog';
import EventDetailModal from './components/EventDetailModal';
import DialpadPanel from './components/DialpadPanel';
import AudioWaveform from './components/AudioWaveform';
import StatusDot from './components/shared/StatusDot';
import { formatDuration } from './utils';
import type { EventEntry, PhoneInfo } from './types';

export default function App() {
  const socket = useSocket();
  const api = useApi();
  const [selectedEvent, setSelectedEvent] = useState<EventEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [phones, setPhones] = useState<PhoneInfo[]>([]);

  const onRefresh = useCallback(() => setRefreshKey(k => k + 1), []);
  const isInCall = socket.callStatus !== 'idle' && socket.callStatus !== 'ended';

  // Fetch phones from REST when connected
  useEffect(() => {
    if (socket.connected) {
      api.fetchPhones().then(setPhones).catch(() => {});
    }
  }, [socket.connected, refreshKey, api.fetchPhones]);

  // Combine phone sources: WS activePhones + REST phones
  const allPhones = [
    ...new Set([
      ...socket.activePhones,
      ...phones.map(p => p.number),
    ]),
  ];

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
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <header className="h-12 flex items-center justify-between px-6" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
          <div className="flex items-center gap-3">
            {isInCall ? (
              <>
                <StatusDot status={socket.callStatus} size="md" />
                <span className="font-medium text-sm" style={{ color: 'var(--pc-text-light)' }}>
                  {socket.sessionType === 'phone' ? `Call from ${socket.sessionFrom}` : 'Session'}
                </span>
                <span style={{ color: 'var(--pc-text-medium)', opacity: 0.2 }}>|</span>
                <span className="text-sm font-mono tabular-nums" style={{ color: 'var(--pc-text-medium)' }}>{formatDuration(socket.duration)}</span>
                <span style={{ color: 'var(--pc-text-medium)', opacity: 0.2 }}>|</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{
                  background: socket.callStatus === 'listening' ? 'rgba(92, 245, 152, 0.1)' : socket.callStatus === 'speaking' ? 'rgba(190, 124, 255, 0.1)' : 'rgba(255, 196, 60, 0.1)',
                  color: socket.callStatus === 'listening' ? 'rgb(92, 245, 152)' : socket.callStatus === 'speaking' ? 'rgb(190, 124, 255)' : 'rgb(255, 196, 60)',
                }}>{socket.callStatus}</span>
              </>
            ) : (
              <span className="text-sm" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>
                Waiting for incoming call...
              </span>
            )}
          </div>
        </header>

        {/* Conversation */}
        <ConversationView
          messages={socket.messages}
          onClear={socket.clearMessages}
          isInCall={isInCall}
          send={socket.send}
          sessionId={socket.sessionId}
        />
      </main>

      {/* Right Sidebar */}
      <aside className="w-80 flex flex-col overflow-hidden" style={{ background: 'rgb(26, 13, 39)', borderLeft: '1px solid rgba(60,30,90,0.6)' }}>
        {isInCall && (
          <AudioWaveform
            userMetricsRef={socket.userMetrics}
            botMetricsRef={socket.botMetrics}
            isInCall={isInCall}
          />
        )}
        <DialpadPanel
          activePhones={allPhones}
          agents={socket.agents}
          sessionId={socket.sessionId}
          isInCall={isInCall}
          sessionFrom={socket.sessionFrom}
          duration={socket.duration}
          hangup={api.hangup}
        />
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
