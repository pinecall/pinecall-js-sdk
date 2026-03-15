import { useState, useCallback } from 'react';
import type { AgentInfo, PhoneInfo, VoiceInfo, AgentConfig } from '../types';

const API_BASE = `http://${window.location.hostname}:4200`;

export function useApi() {
  const [loading, setLoading] = useState(false);

  const fetchAgents = useCallback(async (): Promise<AgentInfo[]> => {
    const res = await fetch(`${API_BASE}/agents`);
    const data = await res.json();
    return data.agents ?? [];
  }, []);

  const fetchPhones = useCallback(async (): Promise<PhoneInfo[]> => {
    const res = await fetch(`${API_BASE}/phones`);
    const data = await res.json();
    return data.phones ?? [];
  }, []);

  const fetchVoices = useCallback(async (provider?: string): Promise<VoiceInfo[]> => {
    const url = provider ? `${API_BASE}/voices?provider=${provider}` : `${API_BASE}/voices`;
    const res = await fetch(url);
    const data = await res.json();
    return data.voices ?? [];
  }, []);

  const createAgent = useCallback(async (config: AgentConfig): Promise<any> => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      return await res.json();
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteAgent = useCallback(async (name: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    return await res.json();
  }, []);

  const dial = useCallback(async (agentId: string, to: string, from: string, greeting?: string): Promise<any> => {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agentId)}/dial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from, greeting }),
    });
    return await res.json();
  }, []);

  return { fetchAgents, fetchPhones, fetchVoices, createAgent, deleteAgent, dial, loading };
}
