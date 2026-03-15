import { useState } from 'react';

interface Props {
  agentIds: string[];
  onClose: () => void;
  onDial: (agentId: string, to: string, from: string, greeting?: string) => Promise<any>;
}

export function DialForm({ agentIds, onClose, onDial }: Props) {
  const [agentId, setAgentId] = useState(agentIds[0] ?? '');
  const [to, setTo] = useState('');
  const [from, setFrom] = useState('');
  const [greeting, setGreeting] = useState('');
  const [error, setError] = useState('');
  const [dialing, setDialing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId || !to || !from) { setError('Agent, To and From are required'); return; }

    setDialing(true);
    setError('');

    try {
      const result = await onDial(agentId, to, from, greeting || undefined);
      if (result.error) {
        setError(result.error);
        setDialing(false);
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err.message);
      setDialing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-xl w-full max-w-md p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">📞 Dial</h2>
          <button onClick={onClose} className="text-muted hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted block mb-1">Agent</label>
            <select value={agentId} onChange={e => setAgentId(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent">
              {agentIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">To *</label>
              <input value={to} onChange={e => setTo(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="+1234567890" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">From *</label>
              <input value={from} onChange={e => setFrom(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="+13186330963" />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">Greeting</label>
            <input value={greeting} onChange={e => setGreeting(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
              placeholder="Hello, I'm calling about..." />
          </div>

          {error && (
            <div className="text-xs text-danger bg-danger/10 px-3 py-2 rounded-lg">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg bg-surface-hover text-muted text-sm hover:text-white transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={dialing}
              className="flex-1 py-2 rounded-lg bg-success/80 text-white text-sm font-medium hover:bg-success transition-colors disabled:opacity-50">
              {dialing ? 'Dialing...' : 'Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
