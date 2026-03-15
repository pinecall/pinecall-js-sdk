import { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { useApi } from './hooks/useApi';
import { Sidebar } from './components/Sidebar';
import { CallView } from './components/CallView';
import { CreateAgent } from './components/CreateAgent';
import { DialForm } from './components/DialForm';
import { EventLog } from './components/EventLog';

export default function App() {
  const socket = useSocket();
  const api = useApi();
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDial, setShowDial] = useState(false);
  const [showEvents, setShowEvents] = useState(true);
  const [, forceRefresh] = useState(0);

  // Auto-select first call when one appears
  const callIds = Array.from(socket.calls.keys());
  const activeCallId = selectedCallId && socket.calls.has(selectedCallId)
    ? selectedCallId
    : callIds[0] ?? null;
  const activeCall = activeCallId ? socket.calls.get(activeCallId) : null;

  return (
    <div className="flex h-screen bg-bg">
      {/* Sidebar */}
      <Sidebar
        connected={socket.connected}
        agentIds={socket.agents}
        calls={socket.calls}
        selectedCallId={activeCallId}
        onSelectCall={setSelectedCallId}
        onShowCreate={() => setShowCreate(true)}
        onShowDial={() => setShowDial(true)}
        fetchAgents={api.fetchAgents}
        fetchPhones={api.fetchPhones}
        deleteAgent={api.deleteAgent}
        onRefresh={() => forceRefresh(n => n + 1)}
      />

      {/* Main panel */}
      <div className="flex flex-1 flex-col min-w-0">
        {activeCall ? (
          <CallView
            call={activeCall}
            transcript={socket.transcripts.get(activeCallId!) ?? []}
            botTokenBuffer={socket.botTokens.get(activeCallId!) ?? ''}
            isHeld={socket.heldCalls.has(activeCallId!)}
            isMuted={socket.mutedCalls.has(activeCallId!)}
            isSpeaking={socket.speakingCalls.has(activeCallId!)}
            onHangup={() => socket.send({ action: 'hangup', call_id: activeCallId })}
            onHold={() => {
              // Hold/unhold toggles are sent as WS commands
              // The backend translates them to call methods
              socket.send({
                action: 'configure',
                call_id: activeCallId,
                hold: !socket.heldCalls.has(activeCallId!),
              });
            }}
            onMute={() => {
              socket.send({
                action: 'configure',
                call_id: activeCallId,
                mute: !socket.mutedCalls.has(activeCallId!),
              });
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-5xl mb-3 opacity-20">🟣</div>
              <h2 className="text-lg font-medium text-muted/60">No active calls</h2>
              <p className="text-sm text-muted/40 mt-1">
                {socket.connected
                  ? `${socket.agents.length} agent${socket.agents.length !== 1 ? 's' : ''} deployed`
                  : 'Connecting to server...'}
              </p>
              {socket.connected && socket.agents.length > 0 && (
                <button
                  onClick={() => setShowDial(true)}
                  className="mt-4 px-4 py-2 rounded-lg bg-accent/20 text-accent-light text-sm hover:bg-accent/30 transition-colors"
                >
                  📞 Make a Call
                </button>
              )}
            </div>
          </div>
        )}

        {/* Event log panel */}
        <div className="border-t border-border">
          <button
            onClick={() => setShowEvents(!showEvents)}
            className="w-full flex items-center justify-between px-4 py-2 bg-surface/50 text-xs text-muted hover:text-white transition-colors"
          >
            <span>Event Log ({socket.events.length})</span>
            <span>{showEvents ? '▼' : '▲'}</span>
          </button>
          {showEvents && (
            <div className="h-48 bg-bg/80">
              <EventLog events={socket.events} />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateAgent
          onClose={() => { setShowCreate(false); forceRefresh(n => n + 1); }}
          onCreate={api.createAgent}
        />
      )}
      {showDial && (
        <DialForm
          agentIds={socket.agents}
          onClose={() => setShowDial(false)}
          onDial={api.dial}
        />
      )}
    </div>
  );
}
