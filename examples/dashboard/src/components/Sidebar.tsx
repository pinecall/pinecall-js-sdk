/** Sidebar — Left sidebar with status, agents, phones. Ported from dev-ui design. */
import { useState, useEffect } from 'react';
import { Phone, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import StatusDot from './shared/StatusDot';
import { SERVER } from '../config';
import { formatPhoneNumber } from '../utils';
import type { AgentInfo, PhoneInfo, CallInfo, AgentConfig } from '../types';

interface Props {
  connected: boolean;
  agents: string[];
  calls: Map<string, CallInfo>;
  activePhones: string[];
  fetchAgents: () => Promise<AgentInfo[]>;
  fetchPhones: () => Promise<PhoneInfo[]>;
  deleteAgent: (name: string) => Promise<any>;
  createAgent: (config: AgentConfig) => Promise<any>;
  onRefresh: () => void;
}

export function Sidebar({
  connected, agents, calls, activePhones,
  fetchAgents, fetchPhones, deleteAgent, createAgent, onRefresh,
}: Props) {
  const [agentList, setAgentList] = useState<AgentInfo[]>([]);
  const [phones, setPhones] = useState<PhoneInfo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [phonesExpanded, setPhonesExpanded] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Create agent form
  const [newName, setNewName] = useState('');
  const [newModel, setNewModel] = useState('gpt-4.1-nano');
  const [newInstructions, setNewInstructions] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (connected) {
      fetchAgents().then(setAgentList).catch(() => {});
      fetchPhones().then(setPhones).catch(() => {});
    }
  }, [connected, agents, fetchAgents, fetchPhones]);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    await deleteAgent(name);
    onRefresh();
    fetchAgents().then(setAgentList);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createAgent({ name: newName, model: newModel, instructions: newInstructions || undefined });
      setNewName(''); setNewModel('gpt-4.1-nano'); setNewInstructions('');
      setShowCreate(false);
      onRefresh();
      fetchAgents().then(setAgentList);
    } catch {}
    setCreating(false);
  };

  const activeCalls = Array.from(calls.values());
  const inputStyle = { background: 'rgba(20,10,32,0.6)', border: '1px solid rgba(60,30,90,0.4)', color: 'rgb(238,240,250)' };

  const ConfigRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="uppercase tracking-wide" style={{ color: 'rgb(100,75,140)' }}>{label}</span>
      <span className="font-mono truncate ml-2" style={{ color: 'var(--pc-text-medium)', maxWidth: '140px' }}>{value}</span>
    </div>
  );

  return (
    <aside className="w-72 flex flex-col overflow-hidden" style={{ background: 'rgb(32, 16, 48)', borderRight: '1px solid rgba(60,30,90,0.6)' }}>
      {/* Brand */}
      <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-medium" style={{ color: 'var(--pc-text-light)' }}>Pinecall</span>
          <span className="text-[10px] font-light px-2 py-0.5 rounded-full" style={{ background: 'rgba(60,30,90,0.5)', color: 'var(--pc-text-medium)' }}>Dashboard</span>
        </div>
      </div>

      {/* Connection */}
      <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>Status</span>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: connected ? 'rgb(92, 245, 152)' : 'rgb(255, 107, 178)' }}>
            <StatusDot status={connected ? 'connected' : 'offline'} />
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>
        <div className="mt-2 text-[10px] font-mono truncate" style={{ color: 'rgb(100,75,140)' }}>{SERVER}</div>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Agents */}
        <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>Agents</span>
            <button onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ background: 'rgba(190,124,255,0.15)', color: 'var(--pc-primary-light)' }}>
              <Plus size={10} /> New
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="mb-3 p-3 rounded-lg space-y-2 animate-fade-in" style={{ background: 'rgba(60,30,90,0.3)' }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Agent name" className="w-full px-2.5 py-1.5 rounded-md text-xs" style={inputStyle} />
              <select value={newModel} onChange={e => setNewModel(e.target.value)} className="w-full px-2.5 py-1.5 rounded-md text-xs" style={inputStyle}>
                <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>
              <textarea value={newInstructions} onChange={e => setNewInstructions(e.target.value)} placeholder="Instructions (optional)" rows={2} className="w-full px-2.5 py-1.5 rounded-md text-xs resize-none" style={inputStyle} />
              <div className="flex gap-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-1.5 rounded text-xs" style={{ color: 'var(--pc-text-medium)', border: '1px solid rgba(60,30,90,0.5)' }}>Cancel</button>
                <button onClick={handleCreate} disabled={!newName.trim() || creating} className="flex-1 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, rgb(85,40,125), rgb(120,60,160))', color: 'var(--pc-text-light)' }}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          )}

          {/* Agent list */}
          {agentList.length === 0 && !showCreate && (
            <div className="text-xs text-center py-3" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>No agents deployed</div>
          )}
          {agentList.map(agent => {
            const agentCalls = activeCalls.filter(c => c.agentId === agent.id);
            const isExpanded = expandedAgent === agent.id;
            const cfg = agent.config ?? {};
            const model = cfg.llm?.model ?? cfg.model ?? null;
            const voice = typeof cfg.voice === 'string' ? cfg.voice : cfg.voice?.voice_id ?? null;
            const lang = cfg.language ?? null;
            const instructions = cfg.llm?.instructions ?? cfg.instructions ?? null;
            const stt = typeof cfg.stt === 'string' ? cfg.stt : cfg.stt?.provider ?? null;
            const td = typeof cfg.turnDetection === 'string' ? cfg.turnDetection : cfg.turnDetection?.mode ?? null;
            return (
              <div key={agent.id} className="mb-2 rounded-lg animate-fade-in" style={{ background: 'rgba(60,30,90,0.3)', border: '1px solid rgba(60,30,90,0.4)' }}>
                <div className="p-3 cursor-pointer" onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {agentCalls.length > 0 ? (
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'rgb(92,245,152)' }} />
                      ) : (
                        <span className="w-2 h-2 rounded-full" style={{ background: 'rgba(130,100,170,0.4)' }} />
                      )}
                      <span className="text-sm font-medium" style={{ color: 'var(--pc-primary-light)' }}>{agent.id}</span>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleDelete(agent.id); }} className="p-1 rounded transition-colors" style={{ color: 'rgba(255,107,178,0.6)' }}>
                      <X size={12} />
                    </button>
                  </div>
                  {agent.channels.length > 0 && (
                    <div className="mt-1.5 text-xs" style={{ color: 'var(--pc-text-medium)' }}>📞 {agent.channels.join(', ')}</div>
                  )}
                  {agentCalls.length > 0 && (
                    <div className="mt-1.5 text-xs" style={{ color: 'rgb(92,245,152)' }}>
                      {agentCalls.length} active call{agentCalls.length > 1 ? 's' : ''}
                    </div>
                  )}
                  {model && (
                    <div className="mt-1.5 text-[10px] font-mono truncate" style={{ color: 'rgb(100,75,140)' }}>⚡ {model}</div>
                  )}
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-1.5 text-[10px] animate-fade-in" style={{ borderTop: '1px solid rgba(60,30,90,0.4)' }}>
                    {model && <ConfigRow label="Model" value={model} />}
                    {voice && <ConfigRow label="Voice" value={voice} />}
                    {lang && <ConfigRow label="Language" value={lang} />}
                    {stt && <ConfigRow label="STT" value={stt} />}
                    {td && <ConfigRow label="Turn" value={td} />}
                    {instructions && (
                      <div className="pt-1">
                        <span className="uppercase tracking-wide" style={{ color: 'rgb(100,75,140)' }}>Instructions</span>
                        <div className="mt-0.5 text-[10px] leading-relaxed line-clamp-3" style={{ color: 'var(--pc-text-medium)' }}>
                          {instructions}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Phone numbers — collapsible */}
        <div>
          <button onClick={() => setPhonesExpanded(!phonesExpanded)}
            className="w-full px-5 py-3 flex items-center justify-between text-left transition-colors"
            style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(60,30,90,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <div className="flex items-center gap-2">
              <Phone size={14} style={{ color: 'var(--pc-primary-light)' }} />
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--pc-text-medium)' }}>Phone Numbers</span>
              {(phones.length > 0 || activePhones.length > 0) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(190,124,255,0.15)', color: 'var(--pc-primary-light)' }}>
                  {Math.max(phones.length, activePhones.length)}
                </span>
              )}
            </div>
            {phonesExpanded ? <ChevronUp size={14} style={{ color: 'var(--pc-text-medium)' }} /> : <ChevronDown size={14} style={{ color: 'var(--pc-text-medium)' }} />}
          </button>
          {phonesExpanded && (
            <div className="px-5 py-3 space-y-1" style={{ borderBottom: '1px solid rgba(60,30,90,0.6)' }}>
              {phones.length > 0 ? phones.map(p => (
                <div key={p.sid} className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'rgba(60,30,90,0.3)' }}>
                  <span className="text-xs font-mono" style={{ color: 'var(--pc-text-light)' }}>{formatPhoneNumber(p.number)}</span>
                  {p.name && <span className="text-[10px]" style={{ color: 'var(--pc-text-medium)', opacity: 0.5 }}>{p.name}</span>}
                </div>
              )) : activePhones.length > 0 ? activePhones.map(p => (
                <div key={p} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(60,30,90,0.3)' }}>
                  <span className="text-xs font-mono" style={{ color: 'var(--pc-text-light)' }}>{formatPhoneNumber(p)}</span>
                </div>
              )) : (
                <div className="text-xs text-center py-2" style={{ color: 'var(--pc-text-medium)', opacity: 0.4 }}>No phones</div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
