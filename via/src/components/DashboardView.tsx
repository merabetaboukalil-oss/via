import React, { useState, useEffect } from 'react';
import { getSocket, resetSocket } from '../socket';
import { LayoutDashboard, Shield, ShieldAlert, Globe, MapPin, Monitor, Send, Users, Activity, Home, ArrowLeft, Eye, EyeOff, Map as MapIcon, QrCode, Upload, Copy, Loader2, Printer } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import TransferProgress from './TransferProgress';
import MultiTransferProgress, { TransferTask } from './MultiTransferProgress';
import TransferTaskbarIcon from './TransferTaskbarIcon';
import PrinterModal from './PrinterModal';

// Fix for default marker icon in Leaflet
const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

export default function DashboardView({ onGoHome }: { onGoHome?: () => void }) {
  const [password, setPassword] = useState(sessionStorage.getItem('admin_pass') || '');
  const [isAuth, setIsAuth] = useState(false);
  const [isLoading, setIsLoading] = useState(!!sessionStorage.getItem('admin_pass'));
  const [error, setError] = useState('');
  const [pcs, setPcs] = useState<any[]>([]);
  const [broadcastUrl, setBroadcastUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mapStyle, setMapStyle] = useState<'light' | 'dark' | 'satellite'>('light');
  const [draggedPc, setDraggedPc] = useState<string | null>(null);
  const [selectedTargetPcId, setSelectedTargetPcId] = useState<string | null>(null);
  
  const [sendTransfers, setSendTransfers] = useState<TransferTask[]>([]);
  const [receiveTransfers, setReceiveTransfers] = useState<TransferTask[]>([]);
  const [isSendMinimized, setIsSendMinimized] = useState(false);
  const [isReceiveMinimized, setIsReceiveMinimized] = useState(false);
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' } | null>(null);

  const receivedChunksRef = React.useRef<Map<string, Map<number, ArrayBuffer>>>(new Map());
  const transferMetadataRef = React.useRef<Map<string, { fileName?: string, mimeType?: string, totalChunks: number, totalSize: number }>>(new Map());
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const lastAckedChunksRef = React.useRef<Map<string, number>>(new Map());

  const isAuthRef = React.useRef(isAuth);
  const isLoadingRef = React.useRef(isLoading);

  useEffect(() => {
    isAuthRef.current = isAuth;
    isLoadingRef.current = isLoading;
  }, [isAuth, isLoading]);

  // Speed calculation effect
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      
      setSendTransfers(prev => prev.map(t => {
        if (t.isPaused) return { ...t, speed: 0, speedHistory: [...t.speedHistory, { time: now, speed: 0 }].slice(-20) };
        
        // We use a simplified speed calculation here since we don't have lastTime/lastSize per task in state
        // In a real app, we'd store those in a ref or the task object itself
        // For this demo, we'll just use the currentSize diff if we had it, 
        // but since state updates are async, it's better to just track it here.
        // Let's assume the speed is updated by the sender loop.
        return t;
      }));

      setReceiveTransfers(prev => prev.map(t => {
        if (t.isPaused) return { ...t, speed: 0, speedHistory: [...t.speedHistory, { time: now, speed: 0 }].slice(-20) };
        return t;
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const pass = password || sessionStorage.getItem('admin_pass');
    if (pass && isLoading) {
      const socket = getSocket('dashboard', { pass: pass.trim() });
      
      const handleUpdate = (list: any[]) => {
        setIsAuth(true);
        setIsLoading(false);
        setPcs(list);
        setError('');
        sessionStorage.setItem('admin_pass', pass.trim());
        
        // Request geolocation after login
        if ("geolocation" in navigator) {
          navigator.geolocation.getCurrentPosition((position) => {
            const pcSocket = getSocket('pc');
            if (pcSocket) {
              pcSocket.emit('update_pc_location', {
                lat: position.coords.latitude,
                lon: position.coords.longitude
              });
            }
          }, null, { enableHighAccuracy: true });
        }
      };

      const handleFail = () => {
        sessionStorage.removeItem('admin_pass');
        setIsLoading(false);
        setIsAuth(false);
        setError('Session expirée ou mot de passe invalide');
        resetSocket('dashboard');
      };

      socket.on('pc_list_update', handleUpdate);
      socket.on('auth_failed', handleFail);
      
      socket.on('connect_error', (err) => {
        const errMsg = err?.message || String(err);
        const isTransportError = 
          errMsg.toLowerCase().includes('websocket') || 
          errMsg.toLowerCase().includes('xhr') ||
          errMsg.toLowerCase().includes('transport') ||
          errMsg.toLowerCase().includes('poll') ||
          errMsg.toLowerCase().includes('server');

        if (!socket.connected) {
          if (isTransportError) {
            console.warn("[DASHBOARD] Socket connection attempt failed (retrying...):", errMsg);
          } else {
            console.error("[DASHBOARD] Socket connection error:", err);
            setError('Erreur de connexion au serveur');
          }
          setIsLoading(false);
        } else {
          console.warn("[DASHBOARD] Socket non-fatal upgrade error:", errMsg);
        }
      });
      
      socket.on('transfer_chunk_acked', ({ chunkIndex, transferId }) => {
        lastAckedChunksRef.current.set(transferId, chunkIndex);
      });

      socket.on('transfer_ready', ({ transferId }) => {
        console.log(`[DASHBOARD] Receiver ready for transfer: ${transferId}`);
        (window as any)[`ready_${transferId}`] = true;
      });

      socket.on('transfer_paused', ({ transferId }) => {
        setSendTransfers(prev => prev.map(t => t.id === transferId ? { ...t, isPaused: true } : t));
      });

      socket.on('transfer_resumed', ({ transferId }) => {
        setSendTransfers(prev => prev.map(t => t.id === transferId ? { ...t, isPaused: false } : t));
      });

      socket.on('transfer_started', ({ fileName, mimeType, totalChunks, totalSize, fromId, transferId, senderName }) => {
        console.log(`[DASHBOARD RECEIVER] Transfer started: ${fileName} from ${fromId}, ID: ${transferId}`);
        
        const newTask: TransferTask = {
          id: transferId,
          targetName: senderName || 'Appareil distant',
          fileName: fileName || 'Fichier entrant',
          totalSize: totalSize || 0,
          currentSize: 0,
          isPaused: false,
          speed: 0,
          speedHistory: []
        };

        setReceiveTransfers(prev => {
          if (prev.some(t => t.id === transferId)) return prev;
          return [...prev, newTask];
        });
        setIsReceiveMinimized(false);
        
        receivedChunksRef.current.set(transferId, new Map());
        transferMetadataRef.current.set(transferId, { fileName, mimeType, totalChunks, totalSize });

        // Signal that we are ready to receive
        socket.emit('transfer_ready', { toId: fromId, transferId });
      });

      socket.on('transfer_chunk_received', ({ chunkIndex, chunkData, fromId, transferId }) => {
        const metadata = transferMetadataRef.current.get(transferId);
        if (!metadata) return;
        
        const chunks = receivedChunksRef.current.get(transferId);
        if (chunks) {
          chunks.set(chunkIndex, chunkData);
          
          let actualSize = 0;
          chunks.forEach(c => actualSize += c.byteLength);
          
          setReceiveTransfers(prev => prev.map(t => t.id === transferId ? { ...t, currentSize: actualSize } : t));
        }

        socket.emit('transfer_chunk_ack', { toId: fromId, chunkIndex, transferId });
      });

      socket.on('transfer_finished', ({ fromId, transferId }) => {
        const metadata = transferMetadataRef.current.get(transferId);
        if (!metadata) return;
        
        const chunks = receivedChunksRef.current.get(transferId);
        if (!chunks) return;

        const { fileName, mimeType, totalChunks } = metadata;
        
        const sortedChunks = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunk = chunks.get(i);
          if (chunk) sortedChunks.push(chunk);
        }
        
        const blob = new Blob(sortedChunks, { type: mimeType || 'application/octet-stream' });
        const finalData = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = finalData;
        link.download = fileName || `dashboard_transfer_${Date.now()}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setReceiveTransfers(prev => prev.filter(t => t.id !== transferId));
        transferMetadataRef.current.delete(transferId);
        receivedChunksRef.current.delete(transferId);
        setNotification({ message: `Fichier reçu : ${fileName}`, type: 'success' });
        setTimeout(() => setNotification(null), 3000);
      });

      socket.on('data_received', ({ data, type }: { data: string, type: string }) => {
        console.log(`Dashboard received data (${type})`);
        if (type === 'link') {
          window.open(data, '_blank');
        } else if (type === 'photo') {
          setNotification({ message: 'Une photo a été reçue ! Elle est disponible sur l\'écran principal du PC.', type: 'success' });
          setTimeout(() => setNotification(null), 5000);
        } else {
          setNotification({ message: `Texte reçu : ${data}`, type: 'info' });
          setTimeout(() => setNotification(null), 5000);
        }
      });
      
      // Fallback: if no update after 3 seconds, try to request it manually
      const timeout = setTimeout(() => {
        if (!isAuthRef.current && isLoadingRef.current) {
          socket.emit('request_pc_list');
        }
      }, 3000);

      // Second fallback: if still no update after 7 seconds, show error
      const finalTimeout = setTimeout(() => {
        if (!isAuthRef.current && isLoadingRef.current) {
          setIsLoading(false);
          setError('Délai d\'attente dépassé. Veuillez vous reconnecter.');
        }
      }, 7000);

      return () => {
        socket.off('pc_list_update', handleUpdate);
        socket.off('auth_failed', handleFail);
        socket.off('transfer_chunk_acked');
        socket.off('transfer_ready');
        socket.off('transfer_paused');
        socket.off('transfer_resumed');
        socket.off('transfer_started');
        socket.off('transfer_chunk_received');
        socket.off('transfer_finished');
        socket.off('data_received');
        clearTimeout(timeout);
        clearTimeout(finalTimeout);
      };
    }
  }, [isLoading]); // Re-run when isLoading changes (triggered by handleLogin or mount)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0 || !selectedTargetPcId) return;

    const targetPc = pcs.find(p => p.id === selectedTargetPcId);
    const targetName = targetPc ? targetPc.name : 'Appareil distant';
    const socket = getAdminSocket();

    for (const file of files) {
      if (file.size > 2048 * 1024 * 1024) {
        setNotification({ message: `Fichier ${file.name} trop volumineux (max 2GB)`, type: 'info' });
        setTimeout(() => setNotification(null), 3000);
        continue;
      }

      const transferId = Math.random().toString(36).substring(2, 15);

      const newTask: TransferTask = {
        id: transferId,
        targetName,
        fileName: file.name,
        totalSize: file.size,
        currentSize: 0,
        isPaused: false,
        speed: 0,
        speedHistory: []
      };

      setSendTransfers(prev => {
        if (prev.some(t => t.id === transferId)) return prev;
        return [...prev, newTask];
      });
      setIsSendMinimized(false);

      const CHUNK_SIZE = 1024 * 64; // 64KB chunks for maximum stability
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      socket.emit('transfer_start', {
        toId: selectedTargetPcId,
        fileName: file.name,
        mimeType: file.type,
        totalChunks,
        totalSize: file.size,
        transferId,
        senderName: 'Admin Dashboard'
      });

      // We need to keep track of the current chunk for THIS specific file
      (async () => {
        let currentChunk = 0;
        let lastSize = 0;
        let lastTime = Date.now();

        // Wait for receiver to be ready
        const waitForReady = async () => {
          let attempts = 0;
          while (!(window as any)[`ready_${transferId}`] && attempts < 100) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
          }
          delete (window as any)[`ready_${transferId}`];
        };

        await waitForReady();

        const sendNextChunk = async () => {
          // Check if this transfer still exists (not cancelled)
          const currentTasks = await new Promise<TransferTask[]>(resolve => {
            setSendTransfers(current => {
              resolve(current);
              return current;
            });
          });

          const task = currentTasks.find(t => t.id === transferId);
          if (!task) {
            lastAckedChunksRef.current.delete(transferId);
            return;
          }

          if (task.isPaused) {
            setTimeout(sendNextChunk, 100);
            return;
          }

          // Flow control: wait for ACKs if we are too far ahead (max 15 chunks window)
          const lastAcked = lastAckedChunksRef.current.get(transferId) ?? -1;
          if (currentChunk - lastAcked > 15) {
            setTimeout(sendNextChunk, 50);
            return;
          }

          const start = currentChunk * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const buffer = await chunk.arrayBuffer();

          socket.emit('transfer_chunk', {
            toId: selectedTargetPcId,
            chunkIndex: currentChunk,
            chunkData: buffer,
            transferId
          });

          currentChunk++;
          
          // Update speed and progress (throttled to every 500ms)
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;
          let currentSpeed = task.speed;
          let newHistory = [...task.speedHistory];

          if (timeDiff >= 0.5) {
            const sizeDiff = end - lastSize;
            currentSpeed = sizeDiff / timeDiff;
            newHistory = [...newHistory, { time: now, speed: currentSpeed }].slice(-20);
            lastSize = end;
            lastTime = now;

            setSendTransfers(latest => latest.map(t => 
              t.id === transferId 
                ? { ...t, currentSize: end, speed: currentSpeed, speedHistory: newHistory } 
                : t
            ));
          }

          if (currentChunk < totalChunks) {
            setTimeout(sendNextChunk, 5);
          } else {
            socket.emit('transfer_complete', { toId: selectedTargetPcId, transferId });
            setTimeout(() => {
              setSendTransfers(latest => latest.filter(t => t.id !== transferId));
              lastAckedChunksRef.current.delete(transferId);
            }, 2000);
          }
        };

        sendNextChunk();
      })();
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerFileSelect = (pcId: string) => {
    setSelectedTargetPcId(pcId);
    fileInputRef.current?.click();
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    sessionStorage.setItem('admin_pass', password.trim());
    resetSocket('dashboard');
  };

  const getAdminSocket = () => {
    const pass = password || sessionStorage.getItem('admin_pass') || '';
    return getSocket('dashboard', { pass: (pass || '').trim() });
  };

  const handleBroadcast = () => {
    if (!broadcastUrl) return;
    const socket = getAdminSocket();
    
    if (selectedTargetPcId) {
      const duration = 2000;
      const interval = 50;
      const totalSteps = duration / interval;
      const data = new TextEncoder().encode(broadcastUrl);
      const chunkSize = Math.ceil(data.length / totalSteps);
      const transferId = Math.random().toString(36).substring(2, 15);
      
      socket.emit('transfer_start', {
        toId: selectedTargetPcId,
        fileName: 'Lien partagé',
        mimeType: 'text/uri-list',
        totalChunks: totalSteps,
        totalSize: data.length,
        transferId,
        senderName: 'Admin Dashboard'
      });

      const targetPc = pcs.find(p => p.id === selectedTargetPcId);
      const targetName = targetPc ? targetPc.name : 'Appareil distant';

      const newTask: TransferTask = {
        id: transferId,
        targetName,
        fileName: 'Lien partagé',
        totalSize: data.length,
        currentSize: 0,
        isPaused: false,
        speed: 0,
        speedHistory: []
      };

      setSendTransfers(prev => {
        if (prev.some(t => t.id === transferId)) return prev;
        return [...prev, newTask];
      });
      setIsSendMinimized(false);

      let currentStep = 0;
      let lastSize = 0;
      let lastTime = Date.now();

      (async () => {
        // Wait for receiver to be ready
        let attempts = 0;
        while (!(window as any)[`ready_${transferId}`] && attempts < 100) {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }
        delete (window as any)[`ready_${transferId}`];

        const timer = setInterval(() => {
          setSendTransfers(current => {
            const task = current.find(t => t.id === transferId);
            if (!task) {
              clearInterval(timer);
              return current;
            }

            if (task.isPaused) return current;

            const start = currentStep * chunkSize;
            const end = Math.min(start + chunkSize, data.length);
            const chunk = data.slice(start, end);

            socket.emit('transfer_chunk', {
              toId: selectedTargetPcId,
              chunkIndex: currentStep,
              chunkData: chunk,
              transferId
            });

            currentStep++;
            
            // Update speed and progress
            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            let currentSpeed = task.speed;
            let newHistory = [...task.speedHistory];

            if (timeDiff >= 0.5) {
              const sizeDiff = end - lastSize;
              currentSpeed = sizeDiff / timeDiff;
              newHistory = [...newHistory, { time: now, speed: currentSpeed }].slice(-20);
              lastSize = end;
              lastTime = now;
            }

            if (currentStep >= totalSteps) {
              clearInterval(timer);
              socket.emit('transfer_complete', { toId: selectedTargetPcId, transferId });
              setTimeout(() => {
                setSendTransfers(latest => latest.filter(t => t.id !== transferId));
              }, 2000);
              setBroadcastUrl('');
            }

            return current.map(t => 
              t.id === transferId 
                ? { ...t, currentSize: end, speed: currentSpeed, speedHistory: newHistory } 
                : t
            );
          });
        }, interval);
      })();
    } else {
      // Broadcast to all
      socket.emit('broadcast_all', broadcastUrl);
      setBroadcastUrl('');
      setNotification({ message: 'Lien diffusé à tous les PC connectés !', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const triggerScan = (pcId: string) => {
    const socket = getAdminSocket();
    socket.emit('trigger_mobile_scan', { pcId });
    setNotification({ message: 'Demande de scan envoyée au mobile jumelé !', type: 'info' });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleDropOnPc = (targetPcId: string) => {
    if (draggedPc && draggedPc !== targetPcId) {
      const socket = getAdminSocket();
      const duration = 1500;
      const interval = 50;
      const totalSteps = duration / interval;
      const data = "https://bridgepro.dwg/transfer-session";
      const dataBytes = new TextEncoder().encode(data);
      const chunkSize = Math.ceil(dataBytes.length / totalSteps);
      const transferId = Math.random().toString(36).substring(2, 15);
      
      // Notify receiver to start their progress bar at the same time
      socket.emit('transfer_start', {
        toId: targetPcId,
        fileName: 'Session Transfer',
        mimeType: 'text/uri-list',
        totalChunks: totalSteps,
        totalSize: dataBytes.length,
        transferId,
        senderName: 'Admin Dashboard'
      });

    const targetPc = pcs.find(p => p.id === targetPcId);
    const targetName = targetPc ? targetPc.name : 'Appareil distant';

    const newTask: TransferTask = {
      id: transferId,
      targetName,
      fileName: 'Session Transfer',
      totalSize: dataBytes.length,
      currentSize: 0,
      isPaused: false,
      speed: 0,
      speedHistory: []
    };

    setSendTransfers(prev => {
      if (prev.some(t => t.id === transferId)) return prev;
      return [...prev, newTask];
    });
    setIsSendMinimized(false);

    let currentStep = 0;
    let lastSize = 0;
    let lastTime = Date.now();

    const timer = setInterval(() => {
      setSendTransfers(current => {
        const task = current.find(t => t.id === transferId);
        if (!task) {
          clearInterval(timer);
          return current;
        }

        if (task.isPaused) return current;

        const start = currentStep * chunkSize;
        const end = Math.min(start + chunkSize, dataBytes.length);
        const chunk = dataBytes.slice(start, end);

        socket.emit('transfer_chunk', {
          toId: targetPcId,
          chunkIndex: currentStep,
          chunkData: chunk,
          transferId
        });

        currentStep++;
        
        // Update speed and progress
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        let currentSpeed = task.speed;
        let newHistory = [...task.speedHistory];

        if (timeDiff >= 0.5) {
          const sizeDiff = end - lastSize;
          currentSpeed = sizeDiff / timeDiff;
          newHistory = [...newHistory, { time: now, speed: currentSpeed }].slice(-20);
          lastSize = end;
          lastTime = now;
        }

        if (currentStep >= totalSteps) {
          clearInterval(timer);
          socket.emit('transfer_complete', { toId: targetPcId, transferId });
          setTimeout(() => {
            setSendTransfers(latest => latest.filter(t => t.id !== transferId));
          }, 2000);
        }

        return current.map(t => 
          t.id === transferId 
            ? { ...t, currentSize: end, speed: currentSpeed, speedHistory: newHistory } 
            : t
        );
      });
    }, interval);
    }
    setDraggedPc(null);
  };

  const goHome = () => {
    if (onGoHome) {
      onGoHome();
    } else {
      window.location.href = '/';
    }
  };

  if (isLoading && !isAuth) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-6 font-sans relative">
        {/* Background Image Layer - Dashboard only */}
        <div 
          className="fixed inset-0 -z-10"
          style={{
            backgroundImage: 'url("/120.jpg")',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center"
        >
          <Loader2 className="animate-spin text-white/20 mb-4" size={48} />
          <p className="text-white/40 text-[10px] uppercase tracking-[0.2em] animate-pulse">Connexion au Serveur VIA...</p>
        </motion.div>
      </div>
    );
  }

  if (!isAuth) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-6 font-sans relative">
        {/* Background Image Layer - Dashboard only */}
        <div 
          className="fixed inset-0 -z-10"
          style={{
            backgroundImage: 'url("/120.jpg")',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="max-w-sm w-full bg-white/5 border border-white/10 p-10 rounded-[3rem] backdrop-blur-xl text-center"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-white text-black p-4 rounded-3xl shadow-[0_0_40px_rgba(255,255,255,0.1)]">
              <Shield size={32} />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">VIA Admin</h1>
          <p className="text-white/40 text-sm mb-8 uppercase tracking-widest">Identification Requise</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe Admin"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-4 pr-12 text-white focus:outline-none focus:border-white/30 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {error && (
              <div className="space-y-2">
                <p className="text-zinc-400 text-[10px] uppercase font-bold tracking-tighter text-center">{error}</p>
                <button 
                  type="button"
                  onClick={() => {
                    sessionStorage.removeItem('admin_pass');
                    setPassword('');
                    setError('');
                    setIsLoading(false);
                  }}
                  className="w-full text-[10px] text-white/20 hover:text-white uppercase tracking-widest transition-colors cursor-pointer"
                >
                  Réinitialiser la session
                </button>
              </div>
            )}
            <button 
              type="submit"
              disabled={isLoading}
              className="w-full bg-white text-black py-4 rounded-2xl font-bold hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
            >
              {isLoading ? 'Vérification...' : 'Déverrouiller le Système'}
            </button>
          </form>

          <button 
            onClick={goHome}
            className="w-full mt-8 flex items-center justify-center gap-2 text-white/30 hover:text-white text-[10px] uppercase tracking-[0.2em] transition-colors font-mono cursor-pointer"
          >
            <ArrowLeft size={14} />
            Retour à l'accueil
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-white p-8 font-sans relative">
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        onChange={handleFileSelect}
        multiple
      />
      {/* Multi-Transfer Progress Overlays */}
      <AnimatePresence>
        {receiveTransfers.length > 0 && !isReceiveMinimized && (
          <MultiTransferProgress 
            transfers={receiveTransfers}
            isReceiving={true}
            onClose={() => {
              setReceiveTransfers([]);
              setIsReceiveMinimized(false);
            }}
            onMinimize={() => setIsReceiveMinimized(true)}
            onPauseAll={() => {
              receiveTransfers.forEach(t => {
                getAdminSocket().emit('transfer_pause', { toId: t.id });
              });
              setReceiveTransfers(prev => prev.map(t => ({ ...t, isPaused: true })));
            }}
            onResumeAll={() => {
              receiveTransfers.forEach(t => {
                getAdminSocket().emit('transfer_resume', { toId: t.id });
              });
              setReceiveTransfers(prev => prev.map(t => ({ ...t, isPaused: false })));
            }}
            onCancelAll={() => {
              setReceiveTransfers([]);
            }}
            onPauseTask={(id) => {
              getAdminSocket().emit('transfer_pause', { toId: id });
              setReceiveTransfers(prev => prev.map(t => t.id === id ? { ...t, isPaused: true } : t));
            }}
            onResumeTask={(id) => {
              getAdminSocket().emit('transfer_resume', { toId: id });
              setReceiveTransfers(prev => prev.map(t => t.id === id ? { ...t, isPaused: false } : t));
            }}
            onCancelTask={(id) => {
              setReceiveTransfers(prev => prev.filter(t => t.id !== id));
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sendTransfers.length > 0 && !isSendMinimized && (
          <MultiTransferProgress 
            transfers={sendTransfers}
            isReceiving={false}
            onClose={() => {
              setSendTransfers([]);
              setIsSendMinimized(false);
            }}
            onMinimize={() => setIsSendMinimized(true)}
            onPauseAll={() => {
              sendTransfers.forEach(t => {
                getAdminSocket().emit('transfer_pause', { toId: t.id });
              });
              setSendTransfers(prev => prev.map(t => ({ ...t, isPaused: true })));
            }}
            onResumeAll={() => {
              sendTransfers.forEach(t => {
                getAdminSocket().emit('transfer_resume', { toId: t.id });
              });
              setSendTransfers(prev => prev.map(t => ({ ...t, isPaused: false })));
            }}
            onCancelAll={() => {
              setSendTransfers([]);
            }}
            onPauseTask={(id) => {
              getAdminSocket().emit('transfer_pause', { toId: id });
              setSendTransfers(prev => prev.map(t => t.id === id ? { ...t, isPaused: true } : t));
            }}
            onResumeTask={(id) => {
              getAdminSocket().emit('transfer_resume', { toId: id });
              setSendTransfers(prev => prev.map(t => t.id === id ? { ...t, isPaused: false } : t));
            }}
            onCancelTask={(id) => {
              setSendTransfers(prev => prev.filter(t => t.id !== id));
            }}
          />
        )}
      </AnimatePresence>

      {/* Taskbar (Bottom Right) */}
      <div className="fixed bottom-8 right-8 flex flex-col items-end gap-4 z-[100]">
        <AnimatePresence>
          {isReceiveMinimized && receiveTransfers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5, y: 50 }}
            >
              <TransferTaskbarIcon 
                percentage={Math.round(receiveTransfers.reduce((acc, t) => acc + (t.currentSize / t.totalSize), 0) / receiveTransfers.length * 100)}
                fileName={`${receiveTransfers.length} transferts entrants`}
                isReceiving={true}
                onClick={() => setIsReceiveMinimized(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isSendMinimized && sendTransfers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.5, y: 50 }}
            >
              <TransferTaskbarIcon 
                percentage={Math.round(sendTransfers.reduce((acc, t) => acc + (t.currentSize / t.totalSize), 0) / sendTransfers.length * 100)}
                fileName={`${sendTransfers.length} transferts sortants`}
                isReceiving={false}
                onClick={() => setIsSendMinimized(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Background Image Layer - Dashboard only */}
      <div 
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: 'url("/120.jpg")',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div className="flex items-center gap-4">
            <button 
              onClick={goHome}
              className="bg-white/5 hover:bg-white/10 p-3 rounded-2xl border border-white/10 transition-colors cursor-pointer"
              title="Retour à l'accueil"
            >
              <Home size={24} />
            </button>
            <div>
              <h1 className="text-3xl font-bold">Tableau de Bord VIA</h1>
              <div className="flex items-center gap-3">
                <p className="text-white/40 text-xs uppercase tracking-widest">Gestion de Parc</p>
                <span className="text-[10px] text-emerald-500/40 font-serif italic">Didier par Merbench</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-white/5 p-2 rounded-2xl border border-white/10">
            <input 
              type="text" 
              value={broadcastUrl}
              onChange={(e) => setBroadcastUrl(e.target.value)}
              placeholder="Diffuser une URL à tous..."
              className="bg-transparent border-none focus:ring-0 text-sm px-4 w-64"
            />
            <button 
              onClick={handleBroadcast}
              className="bg-white text-black px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-gray-200 cursor-pointer"
            >
              <Send size={14} />
              Diffuser
            </button>
            <button 
              onClick={() => setIsPrinterModalOpen(true)}
              className="bg-emerald-500 text-white px-6 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] active:scale-95 cursor-pointer"
            >
              <Printer size={14} />
              Ajout_Imprimante
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/5 border border-white/10 p-6 rounded-3xl">
            <div className="flex items-center gap-3 text-white/40 mb-4">
              <Monitor size={18} />
              <span className="text-xs uppercase tracking-widest font-bold">PC Connectés</span>
            </div>
            <div className="text-4xl font-bold">{pcs.length}</div>
          </div>
          <div className="bg-white/5 border border-white/10 p-6 rounded-3xl">
            <div className="flex items-center gap-3 text-white/40 mb-4">
              <QrCode size={18} />
              <span className="text-xs uppercase tracking-widest font-bold">Scan QR-vers-PC</span>
            </div>
            <button 
              onClick={() => {
                setNotification({ message: 'Sélectionnez un PC sur la carte pour déclencher le scan.', type: 'info' });
                setTimeout(() => setNotification(null), 3000);
              }}
              className="w-full bg-white/10 hover:bg-white/20 text-white py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
            >
              Prêt à Scanner
            </button>
          </div>
          <div className="bg-white/5 border border-white/10 p-6 rounded-3xl">
            <div className="flex items-center gap-3 text-white/40 mb-4">
              <Upload size={18} />
              <span className="text-xs uppercase tracking-widest font-bold">Transfert de Fichiers</span>
            </div>
            <div 
              onClick={() => {
                setNotification({ message: 'Sélectionnez un PC dans la liste ci-dessous pour envoyer un fichier.', type: 'info' });
                setTimeout(() => setNotification(null), 3000);
              }}
              className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-white/30 transition-colors cursor-pointer"
            >
              <p className="text-[10px] text-white/40 uppercase tracking-widest">Cliquer sur l'icône d'envoi d'un PC</p>
            </div>
          </div>
        </div>

        {/* Interactive Map Section */}
        <div className={`mb-8 border border-white/10 rounded-3xl overflow-hidden h-[400px] relative z-0 transition-colors duration-500 ${mapStyle === 'light' ? 'bg-white' : 'bg-black'}`}>
          <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 flex items-center gap-2">
            <MapIcon size={16} className="text-white/60" />
            <span className="text-xs font-bold uppercase tracking-widest text-white">Localisation & Transfert PC-à-PC</span>
          </div>

          <MapContainer 
            center={[20, 0]} 
            zoom={2} 
            style={{ height: '100%', width: '100%', background: mapStyle === 'light' ? '#fff' : '#000' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution={
                mapStyle === 'satellite' 
                  ? 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
                  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              }
              url={
                mapStyle === 'light' 
                  ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  : mapStyle === 'dark'
                  ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              }
            />
            {pcs.map((pc) => (
              <Marker 
                key={pc.socketId} 
                position={[pc.location.lat, pc.location.lon]}
                eventHandlers={{
                  click: () => {},
                }}
              >
                <Popup className="custom-popup">
                  <div 
                    className="p-2 text-black"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDropOnPc(pc.id)}
                  >
                    <h3 className="font-bold text-lg mb-1">{pc.name}</h3>
                    <p className="text-xs text-gray-600 mb-3">{pc.location.city}, {pc.location.country}</p>
                    <div className="space-y-2">
                      <button 
                        onClick={() => triggerFileSelect(pc.id)}
                        className="w-full bg-emerald-500 text-white text-[10px] uppercase font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors cursor-pointer"
                      >
                        <Upload size={10} />
                        Envoyer un Fichier
                      </button>
                      <button 
                        onClick={() => triggerScan(pc.id)}
                        className="w-full bg-black text-white text-[10px] uppercase font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors cursor-pointer"
                      >
                        <QrCode size={10} />
                        Scan QR-vers-PC
                      </button>
                      <div 
                        draggable
                        onDragStart={() => setDraggedPc(pc.id)}
                        className="w-full bg-white border border-black text-black text-[10px] uppercase font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors cursor-move"
                      >
                        <Copy size={10} />
                        Glisser pour Transférer
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 text-white/40 text-[10px] uppercase tracking-widest font-bold">
                <th className="px-6 py-4">Cible</th>
                <th className="px-6 py-4">Nom de la Machine</th>
                <th className="px-6 py-4">Adresse IP</th>
                <th className="px-6 py-4">Localisation</th>
                <th className="px-6 py-4">Actions</th>
                <th className="px-6 py-4">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pcs.map((pc) => (
                <tr 
                  key={pc.socketId} 
                  className="hover:bg-white/5 transition-colors cursor-pointer"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropOnPc(pc.id)}
                >
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox"
                      checked={selectedTargetPcId === pc.id}
                      onChange={() => setSelectedTargetPcId(selectedTargetPcId === pc.id ? null : pc.id)}
                      className="w-5 h-5 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-4 font-medium flex items-center gap-3">
                    <div 
                      draggable
                      onDragStart={() => setDraggedPc(pc.id)}
                      className={`w-2 h-2 rounded-full cursor-move ${pc.isPaired ? 'bg-emerald-400' : 'bg-white/20'}`}
                    ></div>
                    {pc.name}
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-white/60">{pc.ip}</td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex items-center gap-2">
                      <MapPin size={12} className="text-white/40" />
                      {pc.location.city}, {pc.location.country}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => triggerFileSelect(pc.id)}
                        className="p-2 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 rounded-lg transition-colors cursor-pointer"
                        title="Envoyer un fichier"
                      >
                        <Upload size={14} />
                      </button>
                      <button 
                        onClick={() => triggerScan(pc.id)}
                        className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                        title="Scan QR-vers-PC"
                      >
                        <QrCode size={14} />
                      </button>
                      <button 
                        onClick={() => {
                          setNotification({ message: 'Glissez ce PC vers un autre pour transférer', type: 'info' });
                          setTimeout(() => setNotification(null), 3000);
                        }}
                        className="p-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                        title="Glisser-déposer"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-[10px] text-white/20">{pc.id}</td>
                </tr>
              ))}
              {pcs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-white/20 italic">
                    Aucune machine connectée actuellement...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <PrinterModal 
        isOpen={isPrinterModalOpen} 
        onClose={() => setIsPrinterModalOpen(false)} 
        pcs={pcs}
        activeSocket={getAdminSocket()}
      />

      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[300] bg-white text-black px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 border border-white/20"
          >
            <div className={`w-2 h-2 rounded-full ${notification.type === 'success' ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500 animate-pulse'}`}></div>
            <span className="font-bold text-sm uppercase tracking-widest">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
