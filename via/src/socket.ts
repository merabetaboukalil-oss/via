import { io, Socket } from "socket.io-client";

const sockets: Record<string, Socket> = {};

export const getSocket = (role: string = 'pc', extra: any = {}) => {
  // For dashboard, include the password in the key to ensure a fresh socket if the password changes
  const roleId = (extra.id && extra.id !== 'null' && extra.id !== 'undefined') ? extra.id : '';
  const name = extra.name || '';
  
  const key = role === 'dashboard' 
    ? `${role}_${extra.pass || ''}`
    : `${role}_${roleId}_${name}`;
    
  if (!sockets[key]) {
    // Use default host (relative URL) which is most reliable behind proxies
    console.log(`[SOCKET] Creating new socket for ${role} with key ${key}`);
    sockets[key] = io({
      query: { role, ...extra },
      reconnectionAttempts: 100,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 30000,
      transports: ['websocket'],
      upgrade: false,
      rememberUpgrade: true,
      autoConnect: true,
      forceNew: true,
      withCredentials: true
    });
  }
  return sockets[key];
};

export const resetSocket = (role?: string) => {
  if (role) {
    const keys = Object.keys(sockets).filter(k => k.startsWith(role));
    keys.forEach(k => {
      sockets[k].disconnect();
      delete sockets[k];
    });
  } else {
    Object.keys(sockets).forEach(k => {
      sockets[k].disconnect();
      delete sockets[k];
    });
  }
};
