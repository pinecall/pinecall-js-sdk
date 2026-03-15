/**
 * Server URL config.
 * When served embedded by EventServer (same origin), uses window.location.
 * In dev mode (Vite), uses VITE_SERVER_URL env var.
 */
const loc = typeof window !== 'undefined' ? window.location : null;
const devServer = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_SERVER_URL : null;

export const SERVER = devServer || loc?.host || 'localhost:4100';
export const API_BASE = devServer ? `http://${devServer}` : loc ? `${loc.protocol}//${loc.host}` : 'http://localhost:4100';
export const WS_URL = devServer ? `ws://${devServer}` : loc ? `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}` : 'ws://localhost:4100';
