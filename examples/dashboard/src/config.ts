/**
 * Server URL detection.
 *
 * Priority:
 *   1. ?server=host:port query param
 *   2. Default: localhost:4100 (standard pinecall server port)
 *
 * Examples:
 *   http://localhost:5173                     → connects to localhost:4100
 *   http://localhost:5173?server=localhost:4200 → connects to localhost:4200
 */

function detectServer(): string {
  const params = new URLSearchParams(window.location.search);
  const server = params.get('server');
  if (server) return server;
  return `${window.location.hostname}:4100`;
}

export const SERVER = detectServer();
export const API_BASE = `http://${SERVER}`;
export const WS_URL = `ws://${SERVER}`;
