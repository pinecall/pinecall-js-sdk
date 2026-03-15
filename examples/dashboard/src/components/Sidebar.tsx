import { useState, useEffect } from 'react';
import type { AgentInfo, PhoneInfo, CallInfo } from '../types';
import { SERVER } from '../config';

interface Props {
  connected: boolean;
  agentIds: string[];
  calls: Map<string, CallInfo>;
  selectedCallId: string | null;
  onSelectCall: (id: string | null) => void;
  onShowCreate: () => void;
  onShowDial: () => void;
  fetchAgents: () => Promise<AgentInfo[]>;
  fetchPhones: () => Promise<PhoneInfo[]>;
  deleteAgent: (name: string) => Promise<any>;
  onRefresh: () => void;
}

export function Sidebar({
  connected, agentIds, calls, selectedCallId,
  onSelectCall, onShowCreate, onShowDial,
  fetchAgents, fetchPhones, deleteAgent, onRefresh,
}: Props) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [phones, setPhones] = useState<PhoneInfo[]>([]);

  useEffect(() => {
    if (connected) {
      fetchAgents().then(setAgents).catch(() => {});
      fetchPhones().then(setPhones).catch(() => {});
    }
  }, [connected, agentIds, fetchAgents, fetchPhones]);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    await deleteAgent(name);
    onRefresh();
    const updated = await fetchAgents();
    setAgents(updated);
  };

  const activeCalls = Array.from(calls.values());

  return (
    <div className="w-72 border-r border-border bg-surface/50 backdrop-blur flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-lg">🟣</span>
          <h1 className="text-sm font-semibold tracking-tight">Pinecall Dashboard</h1>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-success animate-pulse-dot' : 'bg-danger'}`} />
          <span className="text-xs text-muted">
            {connected ? SERVER : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Agents */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wider">Agents</h2>
            <button
              onClick={onShowCreate}
              className="text-xs px-2 py-1 rounded bg-accent/20 text-accent-light hover:bg-accent/30 transition-colors"
            >
              + New
            </button>
          </div>

          {agents.length === 0 && (
            <p className="text-xs text-muted/60 py-4 text-center">No agents deployed</p>
          )}

          {agents.map(agent => {
            const agentCalls = activeCalls.filter(c => c.agent_id === agent.id);
            return (
              <div key={agent.id} className="mb-2 p-3 rounded-lg bg-surface-hover/50 border border-border/50 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {agentCalls.length > 0 ? (
                      <span className="w-2 h-2 rounded-full bg-success animate-pulse-dot" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-muted/40" />
                    )}
                    <span className="text-sm font-medium text-accent-light">{agent.id}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    className="text-xs text-danger/60 hover:text-danger transition-colors"
                  >
                    ✕
                  </button>
                </div>
                {agent.channels.length > 0 && (
                  <div className="mt-1.5 text-xs text-muted">
                    📞 {agent.channels.join(', ')}
                  </div>
                )}
                {agentCalls.length > 0 && (
                  <div className="mt-1.5 text-xs text-success">
                    {agentCalls.length} active call{agentCalls.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Active Calls */}
        {activeCalls.length > 0 && (
          <div className="p-3 border-t border-border">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Active Calls</h2>
            {activeCalls.map(call => (
              <button
                key={call.id}
                onClick={() => onSelectCall(call.id)}
                className={`w-full text-left p-2 rounded-lg mb-1 text-xs transition-colors ${
                  selectedCallId === call.id
                    ? 'bg-accent/20 border border-accent/40'
                    : 'bg-surface-hover/50 border border-transparent hover:border-border/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-accent-light">{call.agent_id}</span>
                  <span className="text-muted text-[10px]">{call.direction}</span>
                </div>
                <div className="text-muted mt-0.5 truncate">
                  {call.from} → {call.to}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Dial */}
        <div className="p-3 border-t border-border">
          <button
            onClick={onShowDial}
            className="w-full py-2 rounded-lg bg-accent/20 text-accent-light text-xs font-medium hover:bg-accent/30 transition-colors"
          >
            📞 Make a Call
          </button>
        </div>

        {/* Phones */}
        {phones.length > 0 && (
          <div className="p-3 border-t border-border">
            <h2 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">Phone Numbers</h2>
            {phones.map(phone => (
              <div key={phone.sid} className="text-xs text-muted py-1">
                {phone.number} <span className="text-muted/60">{phone.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
