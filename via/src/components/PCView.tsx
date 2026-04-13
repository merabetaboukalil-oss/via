import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getSocket, resetSocket } from '../socket';
import { 
  Monitor, Smartphone, Loader2, ExternalLink, CheckCircle2, 
  Globe, MapPin, LayoutDashboard, Shield, ShieldAlert, 
  Users, Activity, Home, ArrowLeft, Eye, EyeOff, 
  Map as MapIcon, QrCode, Upload, Download, Copy, Send,
  Layers, Sun, Moon, Cloud, Share2, Navigation, X, Zap, Printer
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { generateBackgroundImage } from '../services/imageService';
import MultiTransferProgress, { TransferTask } from './MultiTransferProgress';
import TransferTaskbarIcon from './TransferTaskbarIcon';
import PrinterModal from './PrinterModal';

// Custom PC Icon for Leaflet
const pcIcon = L.divIcon({
    className: 'custom-pc-icon',
    html: `
      <div class="relative group">
        <div class="absolute -inset-2 bg-emerald-500/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <div class="bg-white text-black p-2 rounded-xl shadow-2xl border border-black/10 flex items-center justify-center transform transition-transform hover:scale-110 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

// Active/Target PC Icon for Leaflet
const pcIconActive = L.divIcon({
    className: 'custom-pc-icon-active',
    html: `
      <div class="relative">
        <div class="absolute -inset-4 bg-emerald-500/40 rounded-full animate-ping"></div>
        <div class="bg-emerald-500 text-white p-2 rounded-xl shadow-2xl border border-white/20 flex items-center justify-center scale-110">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

const pcIconPrecise = L.divIcon({
    className: 'custom-pc-icon-precise',
    html: `
      <div class="relative group">
        <div class="absolute -inset-2 bg-emerald-500/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <div class="bg-white text-black p-2 rounded-xl shadow-2xl border border-black/10 flex items-center justify-center transform transition-transform hover:scale-110 active:scale-95">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
          <div class="absolute -top-1 -right-1 bg-emerald-500 w-3 h-3 rounded-full border-2 border-white flex items-center justify-center">
            <div class="w-1 h-1 bg-white rounded-full animate-pulse"></div>
          </div>
        </div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});

export default function PCView({ onNavigateToDashboard }: { onNavigateToDashboard?: () => void }) {
  // PC Receiver State
  const [pcInfo, setPcInfo] = useState<any>(null);
  const [status, setStatus] = useState<'waiting' | 'connected' | 'received'>('waiting');
  const [receivedData, setReceivedData] = useState<{ data: string, type: string, fileName?: string, mimeType?: string } | null>(null);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const [receiveTransfers, setReceiveTransfers] = useState<TransferTask[]>([]);
  const [sendTransfers, setSendTransfers] = useState<TransferTask[]>([]);
  
  const [isReceiveMinimized, setIsReceiveMinimized] = useState(false);
  const [isSendMinimized, setIsSendMinimized] = useState(false);

  const receivedChunksRef = useRef<Map<string, Map<number, Blob>>>(new Map());
  const transferMetadataRef = useRef<Map<string, { fileName?: string, mimeType?: string, totalChunks: number, totalSize: number }>>(new Map());

  // Dashboard State
  const [password, setPassword] = useState(sessionStorage.getItem('admin_pass') || '');
  const [isAuth, setIsAuth] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(!!sessionStorage.getItem('admin_pass'));
  const [dashboardError, setDashboardError] = useState('');
  const [pcs, setPcs] = useState<any[]>([]);
  const [broadcastUrl, setBroadcastUrl] = useState('');
  const [broadcastTargets, setBroadcastTargets] = useState<string[]>([]); // Empty means 'all'
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mapStyle, setMapStyle] = useState<'light' | 'dark' | 'satellite'>('dark');
  const [draggedPc, setDraggedPc] = useState<string | null>(null);
  const [hoveredPcId, setHoveredPcId] = useState<string | null>(null);
  const [targetPcId, setTargetPcId] = useState<string | null>(null);
  const [selectedPcIds, setSelectedPcIds] = useState<string[]>([]);
  const lastAckedChunksRef = useRef<Map<string, number>>(new Map());
  const pcSocketRef = useRef<any>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [autoSave, setAutoSave] = useState(localStorage.getItem('via_autosave') === 'true');
  const [saveDirectory, setSaveDirectory] = useState<any>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' } | null>(null);
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use refs for high-frequency data to avoid React render spam
  const receiveTransfersRef = useRef<TransferTask[]>([]);
  const sendTransfersRef = useRef<TransferTask[]>([]);

  // Sync refs with state for the UI
  useEffect(() => {
    const interval = setInterval(() => {
      // Always sync to ensure UI is up to date with the latest Ref data
      setReceiveTransfers([...receiveTransfersRef.current]);
      setSendTransfers([...sendTransfersRef.current]);
    }, 100);
    return () => clearInterval(interval);
  }, []); // Run once and stay alive

  const isAuthRef = useRef(isAuth);
  useEffect(() => { isAuthRef.current = isAuth; }, [isAuth]);

  const handleRename = () => {
    const currentName = pcInfo?.name || localStorage.getItem('custom_pc_name') || 'PC';
    const newName = prompt("Entrez le nom de cette machine (ex: rakaim) :", currentName);
    if (newName && newName.trim()) {
      localStorage.setItem('custom_pc_name', newName.trim());
      const socket = getSocket('pc');
      socket.emit('rename_pc', newName.trim());
    }
  };

  const requestSaveDirectory = async () => {
    try {
      // @ts-ignore
      if (window.showDirectoryPicker) {
        // @ts-ignore
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        setSaveDirectory(handle);
        setAutoSave(true);
        localStorage.setItem('via_autosave', 'true');
      } else {
        setAutoSave(true);
        localStorage.setItem('via_autosave', 'true');
        setNotification({ message: 'Mode Automatique activé (Téléchargements standards).', type: 'success' });
        setTimeout(() => setNotification(null), 3000);
      }
    } catch (err) {
      console.error('Directory picker error:', err);
    }
  };

  useEffect(() => {
    const autoSaveFile = async () => {
      if (autoSave && receivedData && (receivedData.type === 'photo' || receivedData.type === 'scan' || receivedData.type === 'file')) {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const folderName = `Via_${dateStr}`;
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const extension = receivedData.fileName ? receivedData.fileName.split('.').pop() : (receivedData.type === 'photo' ? 'png' : (receivedData.mimeType ? receivedData.mimeType.split('/')[1] : 'file'));
        const filename = receivedData.fileName || `Capture_${timeStr}.${extension}`;
        
        try {
          if (saveDirectory) {
            const subDir = await saveDirectory.getDirectoryHandle(folderName, { create: true });
            const fileHandle = await subDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            const response = await fetch(receivedData.data);
            const blob = await response.blob();
            await writable.write(blob);
            await writable.close();
          } else {
            const link = document.createElement('a');
            link.href = receivedData.data;
            link.download = `${folderName}_${filename}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
          
          // In expert mode, we might want to reset the status to 'connected' automatically
          // to keep it "invisible" and ready for the next one.
          setTimeout(() => {
            setStatus('connected');
            setReceivedData(null);
          }, 2000);
        } catch (err) {
          console.error('Auto-save error:', err);
        }
      }
    };
    
    autoSaveFile();
  }, [receivedData, autoSave, saveDirectory]);

  // PC Socket Logic
  useEffect(() => {
    const getRealName = () => {
      const savedName = localStorage.getItem('custom_pc_name');
      if (savedName) return savedName;

      const ua = navigator.userAgent;
      let os = "PC";
      if (ua.indexOf("Win") !== -1) os = "Windows";
      else if (ua.indexOf("Mac") !== -1) os = "macOS";
      else if (ua.indexOf("Linux") !== -1) os = "Linux";
      else if (ua.indexOf("Android") !== -1) os = "Android";
      else if (ua.indexOf("like Mac") !== -1) os = "iOS";

      let browser = "";
      if (ua.indexOf("Edg") !== -1) browser = "Edge";
      else if (ua.indexOf("Chrome") !== -1) browser = "Chrome";
      else if (ua.indexOf("Firefox") !== -1) browser = "Firefox";
      else if (ua.indexOf("Safari") !== -1) browser = "Safari";
      
      const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
      return `${os}${browser ? ' (' + browser + ')' : ''}-${suffix}`;
    };

    const storedId = sessionStorage.getItem('pc_id');
    const realName = getRealName();
    
    const pcSocket = getSocket('pc', { 
      name: realName,
      id: storedId
    });
    pcSocketRef.current = pcSocket;

    const onConnect = () => {
      console.log("PC Socket connected:", pcSocket.id);
      setIsConnected(true);
      pcSocket.emit('request_pc_info');
    };

    const onConnectError = (err: any) => {
      // WebSocket upgrade errors or temporary polling errors shouldn't always be shown as fatal
      const errMsg = err?.message || String(err);
      const isTransportError = 
        errMsg.toLowerCase().includes('websocket') || 
        errMsg.toLowerCase().includes('xhr') ||
        errMsg.toLowerCase().includes('transport') ||
        errMsg.toLowerCase().includes('poll') ||
        errMsg.toLowerCase().includes('server');
      
      if (!pcSocket.connected) {
        if (isTransportError) {
          console.warn("[SOCKET] Connection attempt failed (retrying...):", errMsg);
        } else {
          console.error("[SOCKET] Connection error:", err);
        }
        setIsConnected(false);
      } else {
        console.warn("[SOCKET] Non-fatal upgrade error:", errMsg);
      }
    };

    const onDisconnect = () => {
      console.log("PC Socket disconnected");
      setIsConnected(false);
    };

    const onPcInitialized = (info: any) => {
      console.log(`[CLIENT] PC INITIALIZED - ID: ${info.id} - NAME: ${info.name}`);
      setPcInfo(info);
      sessionStorage.setItem('pc_id', info.id);
      // Status remains 'waiting' to show the QR code screen

      // Try to get precise geolocation to bypass ISP data center location
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
          pcSocket.emit('update_pc_location', {
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
        }, (error) => {
          console.warn("Geolocation error:", error);
        }, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        });
      }
    };

    const onMobilePaired = () => {
      console.log("Mobile paired with this PC");
      setStatus('connected');
    };

    pcSocket.on('connect', onConnect);
    pcSocket.on('connect_error', onConnectError);
    pcSocket.on('disconnect', onDisconnect);
    pcSocket.on('pc_initialized', onPcInitialized);
    pcSocket.on('mobile_paired', onMobilePaired);

    const onTransferStarted = ({ fileName, mimeType, totalChunks, totalSize, fromId, transferId, senderName }: any) => {
      console.log(`[RECEIVER] Transfer started: ${fileName} (${totalChunks} chunks) from ${fromId}, ID: ${transferId}`);
      
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

      receiveTransfersRef.current = [...receiveTransfersRef.current, newTask];
      setIsReceiveMinimized(false);
      
      receivedChunksRef.current.set(transferId, new Map());
      transferMetadataRef.current.set(transferId, { fileName, mimeType, totalChunks, totalSize });

      // Signal that we are ready to receive (UI is updated)
      // Add a small delay to ensure React has rendered the progress window
      setTimeout(() => {
        pcSocket.emit('transfer_ready', { toId: fromId, transferId });
      }, 500);
    };

    const onTransferPaused = ({ transferId }: any) => {
      receiveTransfersRef.current = receiveTransfersRef.current.map(t => t.id === transferId ? { ...t, isPaused: true } : t);
    };

    const onTransferResumed = ({ transferId }: any) => {
      receiveTransfersRef.current = receiveTransfersRef.current.map(t => t.id === transferId ? { ...t, isPaused: false } : t);
    };

    const onTransferChunkReceived = ({ chunkIndex, chunkData, fromId, transferId }: any) => {
      const metadata = transferMetadataRef.current.get(transferId);
      if (!metadata) return;
      
      const chunks = receivedChunksRef.current.get(transferId);
      if (!chunks) return;

      // Store ArrayBuffer directly to save CPU
      chunks.set(chunkIndex, chunkData);
      
      const now = Date.now();
      const lastUpdate = (window as any)[`lastUpdate_${transferId}`] || 0;
      const lastSize = (window as any)[`lastSize_${transferId}`] || 0;
      const currentTotalSize = (window as any)[`currentTotalSize_${transferId}`] || 0;
      
      const newTotalSize = currentTotalSize + chunkData.byteLength;
      (window as any)[`currentTotalSize_${transferId}`] = newTotalSize;
      
      // Update the Ref (no re-render)
      const timeDiff = (now - lastUpdate) / 1000;
      let currentSpeed = 0;
      if (timeDiff > 0.1) {
        currentSpeed = (newTotalSize - lastSize) / timeDiff;
        (window as any)[`lastUpdate_${transferId}`] = now;
        (window as any)[`lastSize_${transferId}`] = newTotalSize;
      }

      receiveTransfersRef.current = receiveTransfersRef.current.map(t => {
        if (t.id === transferId) {
          const instantSpeed = timeDiff > 0.1 ? (newTotalSize - lastSize) / timeDiff : 0;
          const prevSpeed = t.speed || 0;
          const currentSpeed = timeDiff > 0.1 ? (prevSpeed * 0.7 + instantSpeed * 0.3) : prevSpeed;
          
          const newHistory = timeDiff > 0.1 
            ? [...(t.speedHistory || []), { time: now, speed: currentSpeed }].slice(-60) 
            : t.speedHistory;
            
          return { ...t, currentSize: newTotalSize, speed: currentSpeed, speedHistory: newHistory };
        }
        return t;
      });

      // Batch ACKs: Send ACK every 2 chunks or if it's the last chunk
      // With 64KB chunks, 2 chunks = 128KB
      if (chunkIndex % 2 === 0 || chunkIndex === metadata.totalChunks - 1) {
        pcSocket.emit('transfer_chunk_ack', { toId: fromId, chunkIndex, transferId });
      }
    };

    const onTransferFinished = ({ transferId }: any) => {
      const metadata = transferMetadataRef.current.get(transferId);
      if (!metadata) return;
      
      console.log(`[RECEIVER] Transfer finished: ${metadata.fileName}, ID: ${transferId}`);
      
      const { fileName, mimeType, totalChunks } = metadata;
      const chunks = receivedChunksRef.current.get(transferId);
      if (!chunks) return;
      
      // Reassemble chunks
      const sortedChunks = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = chunks.get(i);
        if (chunk) sortedChunks.push(chunk);
      }
      
      const blob = new Blob(sortedChunks, { type: mimeType || 'application/octet-stream' });
      
      // Special handling for links (text/uri-list)
      if (mimeType === 'text/uri-list') {
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result as string;
          setReceivedData({ data: url, type: 'link', fileName, mimeType });
          setStatus('received');
          
          setReceiveTransfers(prev => prev.filter(t => t.id !== transferId));
          
          setNotification({ message: `Lien reçu: ${url}`, type: 'success' });
          setTimeout(() => setNotification(null), 5000);
          
          if (url.startsWith('http')) {
            window.open(url, '_blank');
          }
        };
        reader.readAsText(blob);
        return;
      }

      const finalData = URL.createObjectURL(blob);
      const type = mimeType?.startsWith('image/') ? 'photo' : 'file';

      setReceivedData({ data: finalData, type, fileName, mimeType });
      setStatus('received');
      
      receiveTransfersRef.current = receiveTransfersRef.current.filter(t => t.id !== transferId);
      
      setNotification({ message: `Fichier reçu: ${fileName}`, type: 'success' });
      setTimeout(() => setNotification(null), 5000);

      // Visual feedback: Screen flash
      const flash = document.createElement('div');
      flash.className = 'fixed inset-0 bg-emerald-500/20 z-[9999] pointer-events-none animate-pulse';
      document.body.appendChild(flash);
      setTimeout(() => document.body.removeChild(flash), 1000);

      if (type === 'file' || type === 'photo') {
        const link = document.createElement('a');
        link.href = finalData;
        link.download = fileName || `via_transfer_${Date.now()}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      
      // Reset metadata for this transfer
      transferMetadataRef.current.delete(transferId);
      receivedChunksRef.current.delete(transferId);
      delete (window as any)[`lastUpdate_${transferId}`];
      delete (window as any)[`lastSize_${transferId}`];
      delete (window as any)[`currentTotalSize_${transferId}`];
    };

    const onDataReceived = ({ data, type, fileName, mimeType }: any) => {
      console.log(`[RECEIVER] Data received: ${type}`);
      setReceivedData({ data, type, fileName, mimeType });
      setStatus('received');
    };

    pcSocket.on('transfer_started', onTransferStarted);
    pcSocket.on('transfer_paused', onTransferPaused);
    pcSocket.on('transfer_resumed', onTransferResumed);
    pcSocket.on('transfer_chunk_received', onTransferChunkReceived);
    pcSocket.on('transfer_finished', onTransferFinished);
    pcSocket.on('data_received', onDataReceived);

    if (pcSocket.connected) {
      onConnect();
      pcSocket.emit('request_pc_info');
    }

    generateBackgroundImage().then(url => { if (url) setBgImage(url); });

    return () => {
      pcSocket.off('connect', onConnect);
      pcSocket.off('connect_error', onConnectError);
      pcSocket.off('disconnect', onDisconnect);
      pcSocket.off('pc_initialized', onPcInitialized);
      pcSocket.off('mobile_paired', onMobilePaired);
      pcSocket.off('transfer_started', onTransferStarted);
      pcSocket.off('transfer_paused', onTransferPaused);
      pcSocket.off('transfer_resumed', onTransferResumed);
      pcSocket.off('transfer_chunk_received', onTransferChunkReceived);
      pcSocket.off('transfer_finished', onTransferFinished);
      pcSocket.off('data_received', onDataReceived);
    };
  }, []);

  // Dashboard Socket Logic
  useEffect(() => {
    const pass = password || sessionStorage.getItem('admin_pass');
    if (pass && (isDashboardLoading || isAuth)) {
      const dashSocket = getSocket('dashboard', { pass: pass.trim() });
      
      const handleUpdate = (list: any[]) => {
        setPcs(list);
        setIsDashboardLoading(false);
        setDashboardError('');
        setIsAuth(true); // Mark as authenticated for the dashboard
        sessionStorage.setItem('admin_pass', pass.trim());
        
        // If we just logged in, transition to the dashboard view
        if (status === 'waiting') {
          setStatus('connected');
          setIsLoginModalOpen(false);
        }
      };

      const handleFail = () => {
        sessionStorage.removeItem('admin_pass');
        setIsDashboardLoading(false);
        setIsAuth(false);
        setDashboardError('Session expirée ou mot de passe invalide');
        resetSocket('dashboard');
      };

      const handleConfirm = ({ toId, success, error }: any) => {
        console.log(`[DASHBOARD] TRANSFER CONFIRMATION: ${toId} -> ${success ? 'SUCCESS' : 'ERROR: ' + error}`);
        if (success) {
          setNotification({ message: `Signal reçu par le serveur pour ${toId}`, type: 'success' });
        } else {
          setNotification({ message: `Erreur: ${error}`, type: 'info' });
        }
        setTimeout(() => setNotification(null), 3000);
      };

      const handleAck = ({ chunkIndex, transferId }: { chunkIndex: number, transferId: string }) => {
        lastAckedChunksRef.current.set(transferId, chunkIndex);
        
        // Update sender progress based on ACKs for real-time synchronization
        const metadata = (window as any)[`metadata_${transferId}`];
        if (metadata) {
          const CHUNK_SIZE = metadata.chunkSize || 256 * 1024;
          const currentSize = (chunkIndex + 1) * CHUNK_SIZE;
          const totalSize = metadata.totalSize;
          const finalSize = Math.min(currentSize, totalSize);
          
          // Update Ref (no re-render)
          sendTransfersRef.current = sendTransfersRef.current.map(t => 
            t.id === transferId ? { ...t, currentSize: finalSize } : t
          );
        }
      };

      const handleReady = ({ transferId }: { transferId: string }) => {
        console.log(`[DASHBOARD] Receiver ready for transfer: ${transferId}`);
        (window as any)[`ready_${transferId}`] = true;
      };

      const onPaused = ({ transferId }: any) => {
        sendTransfersRef.current = sendTransfersRef.current.map(t => t.id === transferId ? { ...t, isPaused: true } : t);
      };

      const onResumed = ({ transferId }: any) => {
        sendTransfersRef.current = sendTransfersRef.current.map(t => t.id === transferId ? { ...t, isPaused: false } : t);
      };

      const onDashConnect = () => {
        console.log("[DASHBOARD] Socket connected, requesting PC list");
        dashSocket.emit('request_pc_list');
      };

      dashSocket.on('connect', onDashConnect);
      dashSocket.on('pc_list_update', handleUpdate);
      dashSocket.on('auth_failed', handleFail);
      dashSocket.on('transfer_sent_to_server', handleConfirm);
      dashSocket.on('transfer_chunk_acked', handleAck);
      dashSocket.on('transfer_ready', handleReady);
      dashSocket.on('transfer_paused', onPaused);
      dashSocket.on('transfer_resumed', onResumed);

      if (dashSocket.connected) {
        onDashConnect();
      }

      // Timeout for login
      const timeout = setTimeout(() => {
        if (isDashboardLoading && !isAuth) {
          setIsDashboardLoading(false);
          setDashboardError('Délai d\'attente dépassé (Vérifiez votre connexion)');
        }
      }, 15000);

      return () => {
        dashSocket.off('connect', onDashConnect);
        dashSocket.off('pc_list_update', handleUpdate);
        dashSocket.off('auth_failed', handleFail);
        dashSocket.off('transfer_sent_to_server', handleConfirm);
        dashSocket.off('transfer_chunk_acked', handleAck);
        dashSocket.off('transfer_ready', handleReady);
        dashSocket.off('transfer_paused', onPaused);
        dashSocket.off('transfer_resumed', onResumed);
        clearTimeout(timeout);
      };
    }
  }, [isDashboardLoading, isAuth, password]); // Re-run when loading state, auth state or password changes

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    
    // Reset dashboard socket to ensure fresh auth attempt
    resetSocket('dashboard');
    
    setIsDashboardLoading(true);
    setDashboardError('');
    sessionStorage.setItem('admin_pass', password.trim());
    // The useEffect will pick up the change in isDashboardLoading and password
  };

  const getAdminSocket = () => {
    const pass = password || sessionStorage.getItem('admin_pass') || '';
    return getSocket('dashboard', { pass: (pass || '').trim() });
  };

  const handleBroadcast = () => {
    if (!broadcastUrl) return;
    
    if (selectedPcIds.length > 0) {
      const duration = 2000;
      const interval = 50;
      const steps = duration / interval;
      
      selectedPcIds.forEach(targetId => {
        const transferId = Math.random().toString(36).substring(2, 15);
        const targetPc = pcs.find(p => p.id === targetId);
        const targetName = targetPc ? targetPc.name : 'Appareil distant';

        // Notify receivers to start their progress bar at the same time
        getAdminSocket().emit('transfer_start', {
          toId: targetId,
          fileName: 'Lien partagé',
          mimeType: 'text/uri-list',
          totalChunks: 1,
          totalSize: 100,
          transferId,
          senderName: pcInfo?.name || 'PC Local'
        });

        const newTask: TransferTask = {
          id: transferId,
          targetName,
          fileName: 'Lien partagé',
          totalSize: 100,
          currentSize: 0,
          isPaused: false,
          speed: 0,
          speedHistory: []
        };

        sendTransfersRef.current = [...sendTransfersRef.current, newTask];
        setIsSendMinimized(false);

        (async () => {
          let currentStep = 0;
          let lastTime = Date.now();
          
          // Wait for receiver to be ready
          let attempts = 0;
          while (!(window as any)[`ready_${transferId}`] && attempts < 100) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
          }
          delete (window as any)[`ready_${transferId}`];

          const timer = setInterval(() => {
            currentStep++;
            const now = Date.now();
            const simulatedSpeed = (100 / steps) / ((now - lastTime) / 1000); // units per second
            lastTime = now;

            sendTransfersRef.current = sendTransfersRef.current.map(t => {
              if (t.id === transferId) {
                const newHistory = [...(t.speedHistory || []), { time: now, speed: simulatedSpeed }].slice(-20);
                return { ...t, currentSize: (currentStep / steps) * 100, speed: simulatedSpeed, speedHistory: newHistory };
              }
              return t;
            });

            if (currentStep >= steps) {
              clearInterval(timer);
              
              // Send data as chunk to complete the synchronized flow
              getAdminSocket().emit('transfer_chunk', {
                toId: targetId,
                chunkIndex: 0,
                chunkData: new TextEncoder().encode(broadcastUrl),
                transferId
              });
              
              getAdminSocket().emit('transfer_complete', { toId: targetId, transferId });
              
              setTimeout(() => {
                sendTransfersRef.current = sendTransfersRef.current.filter(t => t.id !== transferId);
              }, 2000);
            }
          }, interval);
        })();
      });
      
      setNotification({ message: `${selectedPcIds.length} lien(s) envoyé(s)`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } else if (broadcastTargets.length === 0) {
      getAdminSocket().emit('broadcast_all', broadcastUrl);
      setNotification({ message: 'Lien diffusé à tous les PC !', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } else {
      // Notify receivers to start their progress bar at the same time
      const duration = 2000;
      const interval = 50;
      const totalSteps = duration / interval;
      const dataBytes = new TextEncoder().encode(broadcastUrl);
      const chunkSize = Math.ceil(dataBytes.length / totalSteps);

      broadcastTargets.forEach(targetId => {
        const transferId = Math.random().toString(36).substring(2, 15);
        const targetPc = pcs.find(p => p.id === targetId);
        const targetName = targetPc ? targetPc.name : 'Appareil distant';

        getAdminSocket().emit('transfer_start', {
          toId: targetId,
          fileName: 'Lien partagé',
          mimeType: 'text/uri-list',
          totalChunks: totalSteps,
          totalSize: dataBytes.length,
          transferId,
          senderName: pcInfo?.name || 'PC Local'
        });

        const newTask: TransferTask = {
          id: transferId,
          targetName,
          fileName: 'Lien partagé',
          totalSize: dataBytes.length,
          currentSize: 0,
          isPaused: false,
          speed: 0,
          speedHistory: []
        };

        sendTransfersRef.current = [...sendTransfersRef.current, newTask];
        setIsSendMinimized(false);

        (async () => {
          let currentStep = 0;
          let lastTime = Date.now();
          
          // Wait for receiver to be ready
          let attempts = 0;
          while (!(window as any)[`ready_${transferId}`] && attempts < 100) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
          }
          delete (window as any)[`ready_${transferId}`];

          const timer = setInterval(() => {
            const start = currentStep * chunkSize;
            const end = Math.min(start + chunkSize, dataBytes.length);
            const chunk = dataBytes.slice(start, end);

            getAdminSocket().emit('transfer_chunk', {
              toId: targetId,
              chunkIndex: currentStep,
              chunkData: chunk,
              transferId
            });

            currentStep++;
            const now = Date.now();
            const simulatedSpeed = chunkSize / ((now - lastTime) / 1000);
            lastTime = now;

            sendTransfersRef.current = sendTransfersRef.current.map(t => {
              if (t.id === transferId) {
                const newHistory = [...(t.speedHistory || []), { time: now, speed: simulatedSpeed }].slice(-20);
                return { ...t, currentSize: end, speed: simulatedSpeed, speedHistory: newHistory };
              }
              return t;
            });

            if (currentStep >= totalSteps) {
              clearInterval(timer);
              getAdminSocket().emit('transfer_complete', { toId: targetId, transferId });
              setTimeout(() => {
                sendTransfersRef.current = sendTransfersRef.current.filter(t => t.id !== transferId);
              }, 2000);
            }
          }, interval);
        })();
      });
      
      setNotification({ message: `Lien diffusé à ${broadcastTargets.length} machine(s) !`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    }
    
    setBroadcastUrl('');
    setBroadcastTargets([]);
  };

  const toggleTarget = (id: string) => {
    setBroadcastTargets(prev => 
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const triggerScan = (pcId: string) => {
    getAdminSocket().emit('trigger_mobile_scan', { pcId });
    setNotification({ message: 'Demande de scan envoyée !', type: 'info' });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleDropOnPc = (targetPcId: string) => {
    if (draggedPc && draggedPc !== targetPcId) {
      const duration = 1500;
      const interval = 50;
      const totalSteps = duration / interval;
      const data = "https://bridgepro.dwg/transfer-session";
      const dataBytes = new TextEncoder().encode(data);
      const chunkSize = Math.ceil(dataBytes.length / totalSteps);
      const transferId = Math.random().toString(36).substring(2, 15);
      
      // Notify receiver to start their progress bar at the same time
      getAdminSocket().emit('transfer_start', {
        toId: targetPcId,
        fileName: 'Session Transfer',
        mimeType: 'text/uri-list',
        totalChunks: totalSteps,
        totalSize: dataBytes.length,
        transferId,
        senderName: pcInfo?.name || 'PC Local'
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

      sendTransfersRef.current = [...sendTransfersRef.current, newTask];
      setIsSendMinimized(false);

      (async () => {
        let currentStep = 0;
        let lastTime = Date.now();
        
        // Wait for receiver to be ready
        let attempts = 0;
        while (!(window as any)[`ready_${transferId}`] && attempts < 100) {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }
        delete (window as any)[`ready_${transferId}`];

        const timer = setInterval(() => {
          const start = currentStep * chunkSize;
          const end = Math.min(start + chunkSize, dataBytes.length);
          const chunk = dataBytes.slice(start, end);

          getAdminSocket().emit('transfer_chunk', {
            toId: targetPcId,
            chunkIndex: currentStep,
            chunkData: chunk,
            transferId
          });

          currentStep++;
          const now = Date.now();
          const simulatedSpeed = chunkSize / ((now - lastTime) / 1000);
          lastTime = now;

          sendTransfersRef.current = sendTransfersRef.current.map(t => {
            if (t.id === transferId) {
              const newHistory = [...(t.speedHistory || []), { time: now, speed: simulatedSpeed }].slice(-20);
              return { ...t, currentSize: end, speed: simulatedSpeed, speedHistory: newHistory };
            }
            return t;
          });

          if (currentStep >= totalSteps) {
            clearInterval(timer);
            getAdminSocket().emit('transfer_complete', { toId: targetPcId, transferId });
            setTimeout(() => {
              sendTransfersRef.current = sendTransfersRef.current.filter(t => t.id !== transferId);
            }, 2000);
          }
        }, interval);
      })();
    }
    setDraggedPc(null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0 || !targetPcId) return;

    const socket = getAdminSocket();

    for (const file of files) {
      if (file.size > 2048 * 1024 * 1024) {
        setNotification({ message: `Fichier ${file.name} trop volumineux (max 2GB)`, type: 'info' });
        setTimeout(() => setNotification(null), 3000);
        continue;
      }

      const transferId = Math.random().toString(36).substring(2, 15);
      const targetPc = pcs.find(p => p.id === targetPcId);
      const targetName = targetPc ? targetPc.name : 'Appareil distant';

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

      sendTransfersRef.current = [...sendTransfersRef.current, newTask];
      setIsSendMinimized(false);
      
      const CHUNK_SIZE = 1024 * 64; // 64KB chunks as requested by user
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Store metadata for ACK-based progress tracking
      (window as any)[`metadata_${transferId}`] = { totalSize: file.size, chunkSize: CHUNK_SIZE };

      // Notify start
      socket.emit('transfer_start', {
        toId: targetPcId,
        fileName: file.name,
        mimeType: file.type,
        totalChunks,
        totalSize: file.size,
        transferId,
        senderName: pcInfo?.name || 'PC Local'
      });

      (async () => {
        let currentChunk = 0;
        let lastSize = 0;
        let lastTime = Date.now();
        
        // Wait for receiver to be ready
        const waitForReady = async () => {
          let attempts = 0;
          while (!(window as any)[`ready_${transferId}`] && attempts < 150) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
          }
          delete (window as any)[`ready_${transferId}`];
        };

        await waitForReady();

        const sendNextChunk = async () => {
          // Use Ref directly for the most up-to-date task data
          const task = sendTransfersRef.current.find(t => t.id === transferId);
          
          if (!task) {
            lastAckedChunksRef.current.delete(transferId);
            delete (window as any)[`metadata_${transferId}`];
            delete (window as any)[`lastUIUpdate_send_${transferId}`];
            return;
          }

          if (task.isPaused) {
            setTimeout(sendNextChunk, 100);
            return;
          }

          const lastAcked = lastAckedChunksRef.current.get(transferId) ?? -1;

          // Update speed (throttled to every 100ms for better reactivity)
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;
          
          if (timeDiff >= 0.1) {
            // Calculate speed based on ACKs for true real-time speed
            const currentAckedSize = (lastAcked + 1) * CHUNK_SIZE;
            const sizeDiff = Math.min(currentAckedSize, file.size) - lastSize;
            const instantSpeed = sizeDiff / timeDiff;
            
            // Simple moving average for smoother graph
            const latestTask = sendTransfersRef.current.find(t => t.id === transferId);
            const prevSpeed = latestTask?.speed || 0;
            const currentSpeed = prevSpeed * 0.7 + instantSpeed * 0.3;

            const newHistory = [...(latestTask?.speedHistory || []), { time: now, speed: currentSpeed }].slice(-60);
            
            lastSize = Math.min(currentAckedSize, file.size);
            lastTime = now;

            sendTransfersRef.current = sendTransfersRef.current.map(t => 
              t.id === transferId 
                ? { ...t, speed: currentSpeed, speedHistory: newHistory } 
                : t
            );
          }

          // Flow control: wait for ACKs if we are too far ahead (max 32 chunks window = 8MB)
          // Smaller window prevents socket buffer bloat and UI freezing
          if (currentChunk - lastAcked > 32) {
            setTimeout(sendNextChunk, 10);
            return;
          }

          const start = currentChunk * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const buffer = await chunk.arrayBuffer();
          
          socket.emit('transfer_chunk', {
            toId: targetPcId,
            chunkIndex: currentChunk,
            chunkData: buffer,
            transferId
          });

          currentChunk++;

          if (currentChunk < totalChunks) {
            // Yield to event loop to keep UI responsive
            if (currentChunk % 4 === 0) {
              setTimeout(sendNextChunk, 0);
            } else {
              sendNextChunk();
            }
          } else {
            // Wait for final ACK before completing
            const waitForFinalAck = async () => {
              let ackAttempts = 0;
              while ((lastAckedChunksRef.current.get(transferId) ?? -1) < totalChunks - 1 && ackAttempts < 200) {
                await new Promise(r => setTimeout(r, 50));
                ackAttempts++;
              }
              
              socket.emit('transfer_complete', { toId: targetPcId, transferId });
              setTimeout(() => {
                sendTransfersRef.current = sendTransfersRef.current.filter(t => t.id !== transferId);
                setSendTransfers([...sendTransfersRef.current]);
                lastAckedChunksRef.current.delete(transferId);
                delete (window as any)[`metadata_${transferId}`];
                delete (window as any)[`lastUIUpdate_send_${transferId}`];
              }, 2000);
            };
            waitForFinalAck();
          }
        };

        sendNextChunk();
      })();
    }

    setNotification({ message: `${files.length} fichier(s) en cours d'envoi`, type: 'success' });
    setTimeout(() => setNotification(null), 3000);
    setTargetPcId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerFileSelect = (pcId: string) => {
    setTargetPcId(pcId);
    fileInputRef.current?.click();
  };

  const mobileUrl = pcInfo ? `${window.location.origin}?pair=${pcInfo.id}` : '';

  return (
    <div className="min-h-screen bg-transparent text-white font-sans flex flex-col overflow-hidden relative">
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        onChange={handleFileSelect}
        multiple
      />
      {/* Background Glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 20, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className="fixed top-0 left-1/2 z-[10000] bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/20"
          >
            <CheckCircle2 size={18} />
            <span className="font-bold text-sm uppercase tracking-widest">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transfer Progress Overlay */}
      <AnimatePresence>
        {receiveTransfers.length > 0 && !isReceiveMinimized && (
          <MultiTransferProgress 
            transfers={receiveTransfers}
            isReceiving={true}
            onClose={() => {
              receiveTransfersRef.current = [];
              setReceiveTransfers([]);
              setIsReceiveMinimized(false);
            }}
            onMinimize={() => setIsReceiveMinimized(true)}
            onPauseAll={() => {
              receiveTransfersRef.current.forEach(t => {
                getSocket('pc').emit('transfer_pause', { toId: pcInfo?.id, transferId: t.id });
              });
              receiveTransfersRef.current = receiveTransfersRef.current.map(t => ({ ...t, isPaused: true }));
            }}
            onResumeAll={() => {
              receiveTransfersRef.current.forEach(t => {
                getSocket('pc').emit('transfer_resume', { toId: pcInfo?.id, transferId: t.id });
              });
              receiveTransfersRef.current = receiveTransfersRef.current.map(t => ({ ...t, isPaused: false }));
            }}
            onCancelAll={() => {
              receiveTransfersRef.current = [];
              setReceiveTransfers([]);
              setIsReceiveMinimized(false);
            }}
            onPauseTask={(id) => {
              getSocket('pc').emit('transfer_pause', { toId: pcInfo?.id, transferId: id });
              receiveTransfersRef.current = receiveTransfersRef.current.map(t => t.id === id ? { ...t, isPaused: true } : t);
            }}
            onResumeTask={(id) => {
              getSocket('pc').emit('transfer_resume', { toId: pcInfo?.id, transferId: id });
              receiveTransfersRef.current = receiveTransfersRef.current.map(t => t.id === id ? { ...t, isPaused: false } : t);
            }}
            onCancelTask={(id) => {
              receiveTransfersRef.current = receiveTransfersRef.current.filter(t => t.id !== id);
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
              sendTransfersRef.current = [];
              setSendTransfers([]);
              setIsSendMinimized(false);
            }}
            onMinimize={() => setIsSendMinimized(true)}
            onPauseAll={() => {
              sendTransfersRef.current = sendTransfersRef.current.map(t => ({ ...t, isPaused: true }));
            }}
            onResumeAll={() => {
              sendTransfersRef.current = sendTransfersRef.current.map(t => ({ ...t, isPaused: false }));
            }}
            onCancelAll={() => {
              sendTransfersRef.current = [];
              setSendTransfers([]);
              setIsSendMinimized(false);
            }}
            onPauseTask={(id) => {
              sendTransfersRef.current = sendTransfersRef.current.map(t => t.id === id ? { ...t, isPaused: true } : t);
            }}
            onResumeTask={(id) => {
              sendTransfersRef.current = sendTransfersRef.current.map(t => t.id === id ? { ...t, isPaused: false } : t);
            }}
            onCancelTask={(id) => {
              sendTransfersRef.current = sendTransfersRef.current.filter(t => t.id !== id);
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
                percentage={(() => {
                  const total = receiveTransfers.reduce((acc, t) => acc + t.totalSize, 0);
                  const current = receiveTransfers.reduce((acc, t) => acc + t.currentSize, 0);
                  return total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
                })()}
                fileName={`${receiveTransfers.length} transferts`}
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
                percentage={(() => {
                  const total = sendTransfers.reduce((acc, t) => acc + t.totalSize, 0);
                  const current = sendTransfers.reduce((acc, t) => acc + t.currentSize, 0);
                  return total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
                })()}
                fileName={`${sendTransfers.length} transferts`}
                isReceiving={false}
                onClick={() => setIsSendMinimized(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {status === 'waiting' ? (
          <motion.div 
            key="qr-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] bg-transparent flex flex-col items-center justify-center p-6"
          >
            {/* Background Image Layer - Covers everything for PC Main Menu only */}
            <div 
              className="fixed inset-0 -z-10"
              style={{
                backgroundImage: 'url("/101.png")',
                backgroundSize: '100% 100%',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                filter: 'blur(10px)',
                opacity: 0.6
              }}
            />
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="max-w-md w-full text-center"
            >
              <div className="flex justify-center mb-8">
                <div className="bg-white/10 text-white p-4 rounded-3xl backdrop-blur-xl border border-white/20 shadow-[0_0_50px_rgba(0,0,0,0.2)]">
                  <Monitor size={48} className="text-emerald-400" />
                </div>
              </div>
              <h1 className="text-4xl font-bold tracking-tighter mb-2">VIA</h1>
              <div className="mb-8">
                <p className="text-white/40 uppercase tracking-[0.3em] text-[10px] mb-1">Initialisation du Poste de Pilotage</p>
                <p className="text-emerald-500/60 font-serif italic text-[10px]">Didier par Merbench</p>
              </div>

              <button 
                onClick={() => setIsLoginModalOpen(true)}
                className="mb-12 flex items-center gap-3 px-8 py-4 bg-white/10 text-white hover:bg-emerald-500/20 backdrop-blur-xl border border-white/20 rounded-2xl text-sm font-bold uppercase tracking-widest transition-all mx-auto shadow-[0_0_40px_rgba(0,0,0,0.2)] relative z-[110] active:scale-95 cursor-pointer"
              >
                <Shield size={20} className="text-emerald-400" />
                Tableau de Bord Administrateur
              </button>

              <AnimatePresence>
                {isLoginModalOpen && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6"
                  >
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="max-w-sm w-full bg-white/5 border border-white/10 p-10 rounded-[3rem] text-center relative"
                    >
                      <button 
                        onClick={() => setIsLoginModalOpen(false)}
                        className="absolute top-6 right-6 text-white/20 hover:text-white transition-colors cursor-pointer"
                      >
                        <X size={24} />
                      </button>

                      <div className="bg-white/10 text-white p-4 rounded-3xl backdrop-blur-xl border border-white/20 inline-block mb-6">
                        <Shield size={32} className="text-emerald-400" />
                      </div>
                      <h2 className="text-2xl font-bold mb-2">Accès Administrateur</h2>
                      <p className="text-sm text-white/40 mb-8 uppercase tracking-widest">Identification Requise</p>
                      
                      <form onSubmit={handleLogin} className="space-y-4">
                        <div className="relative">
                          <input 
                            type={showPassword ? "text" : "password"} 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mot de passe Admin"
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-4 pr-12 text-white focus:outline-none focus:border-white/30 transition-colors"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors cursor-pointer"
                          >
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                          </button>
                        </div>
                        {dashboardError && (
                          <div className="space-y-2">
                            <p className="text-zinc-400 text-[10px] uppercase font-bold tracking-tighter">{dashboardError}</p>
                            <button 
                              type="button"
                              onClick={() => {
                                sessionStorage.removeItem('admin_pass');
                                setPassword('');
                                setDashboardError('');
                                setIsDashboardLoading(false);
                              }}
                              className="w-full text-[10px] text-white/20 hover:text-white uppercase tracking-widest transition-colors cursor-pointer"
                            >
                              Réinitialiser la session
                            </button>
                          </div>
                        )}
                        <button 
                          type="submit"
                          disabled={isDashboardLoading}
                          className="w-full bg-white/10 text-white border border-white/20 backdrop-blur-xl py-4 rounded-2xl font-bold hover:bg-emerald-500/20 transition-all disabled:opacity-50 active:scale-95 cursor-pointer"
                        >
                          {isDashboardLoading ? 'Vérification...' : 'Déverrouiller le Système'}
                        </button>
                      </form>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
              
      <div className="bg-white p-4 rounded-3xl shadow-2xl inline-block mb-6 relative group">
                {pcInfo ? (
                  <QRCodeSVG 
                    value={mobileUrl} 
                    size={280} 
                    level="H" 
                    className="relative z-10" 
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                ) : (
                  <div className="w-[280px] h-[280px] flex items-center justify-center relative z-10">
                    <div className="text-center">
                      <Loader2 className="animate-spin text-emerald-500 mb-4 mx-auto" size={64} />
                      <p className="text-black/40 text-[10px] uppercase tracking-widest font-bold">Connexion au Serveur...</p>
                      {!isConnected && (
                        <div className="mt-4">
                          <p className="text-red-500 text-[8px] mb-2">Socket déconnecté (Vérifiez votre connexion internet)</p>
                          <p className="text-white/20 text-[6px] mb-2 uppercase tracking-widest">Tentative de reconnexion automatique...</p>
                          <button 
                            onClick={() => {
                              resetSocket('pc');
                              window.location.reload();
                            }}
                            className="px-4 py-2 bg-emerald-500 text-white text-[10px] font-bold rounded-full hover:bg-emerald-600 transition-colors cursor-pointer"
                          >
                            Forcer la reconnexion
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-6 mb-8">
                <button 
                  onClick={handleRename}
                  className="text-[9px] text-emerald-500/40 hover:text-emerald-400 uppercase tracking-widest font-bold transition-colors cursor-pointer"
                >
                  [ Renommer ]
                </button>
                <button 
                  onClick={requestSaveDirectory}
                  className={`text-[9px] uppercase tracking-widest font-bold transition-colors cursor-pointer flex items-center gap-1 ${autoSave ? 'text-emerald-400' : 'text-white/20 hover:text-white'}`}
                >
                  <Activity size={10} />
                  [ {autoSave ? 'Mode Expert Actif' : 'Activer Automatisation'} ]
                </button>
              </div>

              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 px-6 py-3 bg-white/5 border border-white/10 rounded-full backdrop-blur-md">
                  <Smartphone className="text-emerald-400 animate-pulse" size={20} />
                  <span className="text-sm font-medium text-white/80 tracking-wide">Scannez pour déverrouiller le Dashboard</span>
                </div>

                <div className="flex flex-col items-center gap-1">
                  <p className="text-[10px] text-white/20 font-mono uppercase tracking-widest">ID Session: {pcInfo?.id || '...'}</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div 
            key="dashboard-screen"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col h-screen w-full relative"
          >
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
            {/* Top Header */}
            <header className="relative z-20 border-b border-white/5 bg-black/40 backdrop-blur-xl px-8 py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setStatus('waiting')}
                  className="bg-white/5 hover:bg-white/10 p-2.5 rounded-xl border border-white/10 transition-colors text-white/60 hover:text-white cursor-pointer"
                  title="Retour à l'accueil"
                >
                  <Home size={20} />
                </button>
                <div className="h-8 w-px bg-white/10 mx-1" />
                <div className="bg-white text-black p-2 rounded-xl">
                  <Monitor size={20} />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight">VIA <span className="text-emerald-400">Mission Control</span></h1>
                  <div className="flex items-center gap-3">
                    <p className="text-[10px] text-white/40 uppercase tracking-widest">Poste de Pilotage Unifié</p>
                    <span className="text-[9px] text-emerald-500/40 font-serif italic">Didier par Merbench</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-4 text-xs font-mono text-white/40">
                  <div className="flex items-center gap-2 group/name">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-zinc-400 animate-pulse'}`}></div>
                    <span>{pcInfo?.name || '...'}</span>
                    <button 
                      onClick={handleRename}
                      className="opacity-0 group-hover/name:opacity-100 transition-opacity p-0.5 hover:text-white cursor-pointer"
                      title="Renommer cette machine"
                    >
                      <Copy size={10} className="rotate-90" />
                    </button>
                  </div>
                  <div className="h-4 w-px bg-white/10" />
                  <div className="flex items-center gap-2">
                    <Globe size={12} />
                    <span>{pcInfo?.ip || '...'}</span>
                  </div>
                </div>
                                {isAuth && (
                  <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/10 relative">
                    <input 
                      type="text" 
                      value={broadcastUrl}
                      onChange={(e) => setBroadcastUrl(e.target.value)}
                      placeholder="Diffuser une URL..."
                      className="bg-transparent border-none focus:ring-0 text-xs px-3 w-40"
                    />
                    
                    <div className="h-4 w-[1px] bg-white/10 mx-1"></div>
                    
                    <div className="relative">
                      <button 
                        onClick={() => setShowTargetPicker(!showTargetPicker)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-[10px] uppercase font-bold tracking-widest text-white/40 hover:text-white cursor-pointer"
                      >
                        <Users size={12} />
                        <span>{broadcastTargets.length === 0 ? 'Tous les PC' : `${broadcastTargets.length} Cible(s)`}</span>
                      </button>

                      <AnimatePresence>
                        {showTargetPicker && (
                          <>
                            <div 
                              className="fixed inset-0 z-40" 
                              onClick={() => setShowTargetPicker(false)}
                            />
                            <motion.div 
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 10, scale: 0.95 }}
                              className="absolute top-full right-0 mt-2 w-64 bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl z-50 p-4 overflow-hidden"
                            >
                              <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                                <span className="text-[10px] uppercase font-bold tracking-widest text-white/20">Cibles de Diffusion</span>
                                <button 
                                  onClick={() => setBroadcastTargets([])}
                                  className="text-[9px] uppercase font-bold text-emerald-500 hover:text-emerald-400 cursor-pointer"
                                >
                                  Tout sélectionner
                                </button>
                              </div>
                              <div className="space-y-1 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                                {pcs.map(pc => (
                                  <button
                                    key={pc.id}
                                    onClick={() => toggleTarget(pc.id)}
                                    className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer ${
                                      broadcastTargets.includes(pc.id) 
                                        ? 'bg-emerald-500/10 text-emerald-400' 
                                        : 'hover:bg-white/5 text-white/40'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <Monitor size={14} className={broadcastTargets.includes(pc.id) ? 'text-emerald-400' : 'text-white/20'} />
                                      <span className="text-xs font-medium">{pc.name}</span>
                                    </div>
                                    {broadcastTargets.includes(pc.id) && <CheckCircle2 size={12} />}
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>

                    <button 
                      onClick={handleBroadcast}
                      className="bg-white text-black px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-gray-200 cursor-pointer"
                    >
                      <Send size={12} />
                      Diffuser
                    </button>
                    <button 
                      onClick={() => setIsPrinterModalOpen(true)}
                      className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)] active:scale-95 cursor-pointer"
                    >
                      <Printer size={12} />
                      Ajout_Imprimante
                    </button>
                  </div>
                )}
              </div>
            </header>

            <main className="flex-1 flex relative z-10 overflow-hidden">
              {/* Left Panel: Local PC Receiver */}
              <div className="w-[380px] border-r border-white/5 bg-black/20 backdrop-blur-md flex flex-col p-6 overflow-y-auto">
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-white/40">Récepteur Local</h2>
                    <span className="text-[10px] font-mono text-white/20">#{pcInfo?.id}</span>
                  </div>
                  
                  <AnimatePresence mode="wait">
                    {status === 'connected' && (
                      <motion.div 
                        key="connected"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-emerald-500/5 border border-emerald-500/20 rounded-3xl p-8 text-center"
                      >
                        <div className="relative mb-6 inline-block">
                          <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-25"></div>
                          <div className="relative bg-emerald-500 text-white p-4 rounded-full">
                            <Smartphone size={40} />
                          </div>
                        </div>
                        <h3 className="text-lg font-bold mb-2">Mobile Jumelé</h3>
                        <p className="text-xs text-white/40 uppercase tracking-widest">En attente de données...</p>
                      </motion.div>
                    )}

                    {status === 'received' && receivedData && (
                      <motion.div 
                        key="received"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-6 text-center">
                          <div className="bg-emerald-500 text-white p-3 rounded-full inline-flex mb-4 animate-bounce">
                            <CheckCircle2 size={24} />
                          </div>
                          <h3 className="text-lg font-bold mb-1">Données Reçues</h3>
                          <p className="text-[10px] uppercase tracking-widest text-emerald-400/60 mb-4">
                            {receivedData.type === 'link' ? 'Lien DWG' : receivedData.type === 'photo' ? 'Photo / Document' : 'Note / Tableau'}
                          </p>

                          {autoSave && (
                            <div className="flex items-center justify-center gap-2 mb-4 py-2 bg-emerald-500/20 rounded-xl border border-emerald-500/30">
                              <Activity size={12} className="text-emerald-400 animate-pulse" />
                              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Archivage Automatique...</span>
                            </div>
                          )}

                          {receivedData.type === 'photo' && (
                            <div className="rounded-xl overflow-hidden mb-4 border border-white/10">
                              <img src={receivedData.data} alt="Received" className="w-full h-auto" />
                            </div>
                          )}

                          {receivedData.type === 'text' && (
                            <div className="bg-black/40 p-4 rounded-xl text-left mb-4 max-h-[150px] overflow-y-auto">
                              <pre className="text-[10px] font-mono text-white/60 whitespace-pre-wrap">{receivedData.data}</pre>
                            </div>
                          )}

                          <div className="space-y-2">
                            {receivedData.type === 'link' && (
                              <button 
                                onClick={() => window.open(receivedData.data, '_blank')}
                                className="w-full bg-white text-black py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <ExternalLink size={14} />
                                Ouvrir le Plan
                              </button>
                            )}
                            {(receivedData.type === 'photo' || receivedData.type === 'file') && (
                              <button 
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = receivedData.data;
                                  const extension = receivedData.type === 'photo' ? 'png' : (receivedData.data.split(';')[0].split('/')[1] || 'file');
                                  link.download = `bridge_${Date.now()}.${extension}`;
                                  link.click();
                                }}
                                className="w-full bg-white text-black py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <Upload size={14} />
                                Télécharger le Fichier
                              </button>
                            )}
                            {receivedData.type === 'text' && (
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(receivedData.data);
                                  setNotification({ message: 'Copié !', type: 'success' });
                                  setTimeout(() => setNotification(null), 2000);
                                }}
                                className="w-full bg-white text-black py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                              >
                                <Copy size={14} />
                                Copier
                              </button>
                            )}
                            <button 
                              onClick={() => {
                                setReceivedData(null);
                                setStatus('connected');
                              }}
                              className="w-full bg-white/5 text-white/40 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors cursor-pointer"
                            >
                              Effacer & Réinitialiser
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="mt-auto pt-6 border-t border-white/5">
                  <button 
                    onClick={() => {
                      const socket = getSocket('pc');
                      socket.emit('send_to_pc', { pcId: pcInfo.id, data: "Test de connexion Mission Control", type: "text" });
                    }}
                    className="w-full bg-white/5 hover:bg-white/10 text-white/20 hover:text-white/40 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
                  >
                    Tester la Room
                  </button>
                </div>
              </div>

              {/* Right Panel: Fleet Dashboard */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {!isAuth ? (
                  <div className="flex-1 flex items-center justify-center p-12">
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-sm w-full bg-white/5 border border-white/10 p-8 rounded-3xl text-center"
                    >
                      <Shield size={40} className="mx-auto mb-4 text-white/20" />
                      <h2 className="text-xl font-bold mb-2">Accès Fleet Management</h2>
                      <p className="text-sm text-white/40 mb-6">Déverrouillez pour voir toutes les machines connectées</p>
                      <form onSubmit={handleLogin} className="space-y-4">
                        <div className="relative">
                          <input 
                            type={showPassword ? "text" : "password"} 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mot de passe Admin"
                            className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-white/30"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20 hover:text-white cursor-pointer"
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        {dashboardError && <p className="text-zinc-400 text-[10px] uppercase font-bold">{dashboardError}</p>}
                        <button className="w-full bg-white text-black py-3 rounded-xl font-bold text-sm cursor-pointer">
                          Déverrouiller
                        </button>
                      </form>
                    </motion.div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Map Section */}
                    <div className="h-[50%] relative border-b border-white/5">
                      {/* Map Controls */}
                      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2">
                        <div className="bg-black/60 backdrop-blur-md p-1 rounded-xl border border-white/10 flex flex-col gap-1">
                          <button 
                            onClick={() => setMapStyle('dark')}
                            className={`p-2 rounded-lg transition-all cursor-pointer ${mapStyle === 'dark' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                            title="Mode Sombre"
                          >
                            <Moon size={16} />
                          </button>
                          <button 
                            onClick={() => setMapStyle('light')}
                            className={`p-2 rounded-lg transition-all cursor-pointer ${mapStyle === 'light' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                            title="Mode Clair"
                          >
                            <Sun size={16} />
                          </button>
                          <button 
                            onClick={() => setMapStyle('satellite')}
                            className={`p-2 rounded-lg transition-all cursor-pointer ${mapStyle === 'satellite' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                            title="Vue Satellite"
                          >
                            <Cloud size={16} />
                          </button>
                          <div className="h-px bg-white/10 my-1" />
                          <button 
                            onClick={() => {
                              getAdminSocket().emit('request_pc_list');
                              const btn = document.getElementById('refresh-btn-map');
                              if (btn) btn.classList.add('animate-spin');
                              setTimeout(() => {
                                if (btn) btn.classList.remove('animate-spin');
                              }, 1000);
                            }}
                            id="refresh-btn-map"
                            className="p-2 rounded-lg text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all cursor-pointer"
                            title="Rafraîchir la flotte"
                          >
                            <Activity size={16} />
                          </button>
                        </div>
                      </div>

                      <MapContainer 
                        center={[20, 0]} 
                        zoom={2} 
                        style={{ height: '100%', width: '100%', background: '#000' }}
                        scrollWheelZoom={true}
                      >
                        <TileLayer
                          attribution={mapStyle === 'satellite' ? 'Esri' : 'CartoDB'}
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
                            icon={hoveredPcId === pc.id ? pcIconActive : (pc.location.isPrecise ? pcIconPrecise : pcIcon)}
                            draggable={true}
                            eventHandlers={{
                              dragstart: () => setDraggedPc(pc.id),
                              dragend: () => {
                                if (hoveredPcId && draggedPc && hoveredPcId !== draggedPc) {
                                  handleDropOnPc(hoveredPcId);
                                }
                                setDraggedPc(null);
                                setHoveredPcId(null);
                              },
                              mouseover: () => {
                                if (draggedPc && draggedPc !== pc.id) {
                                  setHoveredPcId(pc.id);
                                }
                              },
                              mouseout: () => {
                                if (hoveredPcId === pc.id) {
                                  setHoveredPcId(null);
                                }
                              }
                            }}
                          >
                            <Popup>
                              <div className="p-2 text-black min-w-[150px]">
                                <h3 className="font-bold text-sm mb-1">{pc.name}</h3>
                                <p className="text-[10px] text-gray-500 mb-3">
                                  {pc.location.city || 'Ville inconnue'}, {pc.location.country || 'Pays'}
                                </p>
                                <div className="flex flex-col gap-1 mb-3">
                                  <div className="flex justify-between text-[9px] uppercase tracking-tighter text-gray-400">
                                    <span>Lat</span>
                                    <span>{pc.location.lat.toFixed(4)}</span>
                                  </div>
                                  <div className="flex justify-between text-[9px] uppercase tracking-tighter text-gray-400">
                                    <span>Lon</span>
                                    <span>{pc.location.lon.toFixed(4)}</span>
                                  </div>
                                </div>
                                <button 
                                  onClick={() => triggerScan(pc.id)}
                                  className="w-full bg-black text-white text-[10px] uppercase font-bold py-2 rounded-lg flex items-center justify-center gap-2"
                                >
                                  <QrCode size={10} />
                                  Déclencher Scan
                                </button>
                              </div>
                            </Popup>
                          </Marker>
                        ))}
                      </MapContainer>
                    </div>

                    {/* PC List Section */}
                    <div className="flex-1 flex flex-col overflow-hidden bg-black/40">
                      {/* Fleet Toolbar */}
                      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5 backdrop-blur-md">
                        <div className="flex items-center gap-4">
                          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">Fleet Management</h3>
                          <div className="h-4 w-px bg-white/10" />
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => {
                                getAdminSocket().emit('request_pc_list');
                                setNotification({ message: "Flotte rafraîchie", type: 'info' });
                                setTimeout(() => setNotification(null), 2000);
                              }}
                              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
                            >
                              <Activity size={12} />
                              Rafraîchir
                            </button>
                            {selectedPcIds.length > 0 && (
                              <button 
                                onClick={() => {
                                  if (confirm(`Voulez-vous supprimer les ${selectedPcIds.length} machines sélectionnées ?`)) {
                                    getAdminSocket().emit('delete_selected_pcs', selectedPcIds);
                                    setSelectedPcIds([]);
                                  }
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-500/10 hover:bg-zinc-500 text-zinc-400 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
                              >
                                <X size={12} />
                                Supprimer ({selectedPcIds.length})
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-white/20 uppercase">{pcs.length} Machines en ligne</span>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 bg-[#0a0a0a]/80 backdrop-blur-md z-10">
                            <tr className="text-white/20 text-[10px] uppercase tracking-widest font-bold border-b border-white/5">
                              <th className="px-6 py-4">
                                <input 
                                  type="checkbox"
                                  checked={selectedPcIds.length === pcs.length && pcs.length > 0}
                                  onChange={() => {
                                    if (selectedPcIds.length === pcs.length) setSelectedPcIds([]);
                                    else setSelectedPcIds(pcs.map(p => p.id));
                                  }}
                                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                                />
                              </th>
                              <th className="px-6 py-4">Machine</th>
                              <th className="px-6 py-4">Status</th>
                              <th className="px-6 py-4">Localisation</th>
                              <th className="px-6 py-4">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {pcs.map((pc) => (
                              <tr 
                                key={pc.socketId} 
                                draggable
                                onDragStart={() => setDraggedPc(pc.id)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => handleDropOnPc(pc.id)}
                                className={`hover:bg-white/10 transition-all group cursor-pointer relative overflow-hidden ${draggedPc === pc.id ? 'opacity-40' : ''}`}
                                style={{
                                  backgroundImage: 'linear-gradient(to right, rgba(0,0,0,0.8), rgba(0,0,0,0.4)), url("https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?auto=format&fit=crop&w=1200&q=80")',
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center'
                                }}
                              >
                                <td className="px-6 py-8 relative z-10">
                                  <input 
                                    type="checkbox"
                                    checked={selectedPcIds.includes(pc.id)}
                                    onChange={() => {
                                      setSelectedPcIds(prev => 
                                        prev.includes(pc.id) ? prev.filter(id => id !== pc.id) : [...prev, pc.id]
                                      );
                                    }}
                                    className="w-5 h-5 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer transition-transform hover:scale-110"
                                  />
                                </td>
                                <td className="px-6 py-8 relative z-10">
                                  <div className="flex flex-col">
                                    <span className="font-bold text-base text-white group-hover:text-emerald-400 transition-colors">{pc.name}</span>
                                    <span className="text-[11px] font-mono text-white/40">{pc.ip}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-8 relative z-10">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.5)] ${pc.isPaired ? 'bg-emerald-400' : 'bg-white/10'}`}></div>
                                    <span className="text-[11px] uppercase tracking-[0.2em] font-bold text-white/60">
                                      {pc.isPaired ? 'Jumelé' : 'Libre'}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-8 relative z-10">
                                  <div className="flex items-center gap-3 text-sm text-white/80">
                                    <Monitor size={16} className="text-white/30" />
                                    <span className="font-medium">{pc.location.city || 'Ville inconnue'}, {pc.location.country || 'Pays'}</span>
                                    {pc.location.isPrecise && (
                                      <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500 text-white rounded-md text-[9px] font-black uppercase tracking-tighter shadow-lg shadow-emerald-500/20">
                                        <Navigation size={10} fill="currentColor" />
                                        GPS
                                      </div>
                                    )}
                                    {pc.id === pcInfo?.id && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if ("geolocation" in navigator) {
                                            navigator.geolocation.getCurrentPosition((pos) => {
                                              getSocket('pc').emit('update_pc_location', {
                                                lat: pos.coords.latitude,
                                                lon: pos.coords.longitude
                                              });
                                            }, null, { enableHighAccuracy: true });
                                          }
                                        }}
                                        className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-white/20 hover:text-white transition-all cursor-pointer"
                                        title="Rafraîchir ma position GPS"
                                      >
                                        <Activity size={12} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-8 relative z-10">
                                  <div className="flex items-center gap-3">
                                    <button 
                                      onClick={() => triggerScan(pc.id)}
                                      className="p-2.5 bg-white/10 hover:bg-emerald-500 hover:text-white rounded-xl transition-all text-white/40 border border-white/5 hover:border-emerald-400/50"
                                      title="Déclencher Scan Mobile"
                                    >
                                      <QrCode size={18} />
                                    </button>
                                    <button 
                                      onClick={() => triggerFileSelect(pc.id)}
                                      className="p-2.5 bg-white/10 hover:bg-blue-500 hover:text-white rounded-xl transition-all text-white/40 border border-white/5 hover:border-blue-400/50"
                                      title="Envoyer un fichier"
                                    >
                                      <Share2 size={18} />
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        console.log(`[UI] Test connection clicked for PC: ${pc.name} (${pc.id})`);
                                        const socket = getAdminSocket();
                                        socket.emit('pc_to_pc_transfer', {
                                          fromId: pcInfo?.id,
                                          toId: pc.id,
                                          data: `SIGNAL DE TEST - ${new Date().toLocaleTimeString()}`,
                                          type: 'text'
                                        });
                                        
                                        // Visual feedback on the button
                                        const target = e.currentTarget;
                                        target.classList.add('animate-pulse', 'bg-emerald-500', 'text-white');
                                        setTimeout(() => {
                                          target.classList.remove('animate-pulse', 'bg-emerald-500', 'text-white');
                                        }, 1000);

                                        setNotification({ message: `Signal envoyé à ${pc.name}`, type: 'info' });
                                        setTimeout(() => setNotification(null), 3000);
                                      }}
                                      className="p-2.5 bg-white/10 hover:bg-emerald-500 hover:text-white rounded-xl transition-all text-white/40 border border-white/5 hover:border-emerald-400/50"
                                      title="Tester la connexion"
                                    >
                                      <Zap size={18} />
                                    </button>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm(`Voulez-vous vraiment déconnecter ${pc.name} ?`)) {
                                          getAdminSocket().emit('delete_pc', pc.id);
                                        }
                                      }}
                                    className="p-2.5 bg-white/10 hover:bg-zinc-600 hover:text-white rounded-xl transition-all text-white/40 border border-white/5 hover:border-zinc-400/50"
                                      title="Supprimer / Déconnecter"
                                    >
                                      <X size={18} />
                                    </button>
                                    <div className="p-2.5 text-white/5 group-hover:text-white/20 transition-colors" title="Glisser pour transférer">
                                      <Users size={18} />
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>
          </motion.div>
        )}
      </AnimatePresence>
      
      <PrinterModal 
        isOpen={isPrinterModalOpen} 
        onClose={() => setIsPrinterModalOpen(false)} 
        pcs={pcs}
        activeSocket={pcSocketRef.current}
      />
    </div>
  );
}
