import React, { useState, useEffect, useRef } from 'react';
import { getSocket, resetSocket } from '../socket';
import { Smartphone, Send, QrCode, Link as LinkIcon, Loader2, CheckCircle2, X, Camera, FileText, Table, Maximize, Image as ImageIcon, Pause, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode, Html5QrcodeScanner } from 'html5-qrcode';
import { generateBackgroundImage } from '../services/imageService';
import ScannerModule from './ScannerModule';

type TransferMode = 'link' | 'photo' | 'text' | 'scanner';

interface MobileViewProps {
  pairId: string;
}

export default function MobileView({ pairId }: MobileViewProps) {
  const [status, setStatus] = useState<'connecting' | 'idle' | 'sending' | 'success'>('connecting');
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const [mode, setMode] = useState<TransferMode>('link');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' | 'error' } | null>(null);
  const lastAckedChunkRef = useRef<number>(-1);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const qrInstanceId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const qrGalleryInputRef = useRef<HTMLInputElement>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [locationError, setLocationError] = useState<string | null>(null);

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus('denied');
      setLocationError("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocationStatus('granted');
        const socket = getSocket('mobile');
        socket.emit('mobile_update_location', {
          pcId: pairId,
          lat: latitude,
          lon: longitude
        });
      },
      (error) => {
        console.error("Location error:", error);
        setLocationStatus('denied');
        if (error.code === 1) {
          setLocationError("L'accès au GPS est obligatoire pour l'identification et l'accès au système.");
        } else {
          setLocationError("Erreur GPS. Veuillez activer votre localisation.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    requestLocation();
  }, [pairId]);

  useEffect(() => {
    resetSocket();
    const socket = getSocket('mobile');
    
    const joinRoom = () => {
      console.log(`Mobile attempting to join room: ${pairId}`);
      socket.emit('join_pc_room', pairId);
    };

    socket.on('connect', () => {
      console.log("Mobile Socket connected:", socket.id);
      setIsConnected(true);
      joinRoom(); // Join on connect
    });

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
          console.warn("[MOBILE] Socket connection attempt failed (retrying...):", errMsg);
        } else {
          console.error("[MOBILE] Socket connection error:", err);
          setNotification({ message: "Erreur de connexion au serveur", type: 'error' });
        }
        setIsConnected(false);
      } else {
        console.warn("[MOBILE] Socket non-fatal upgrade error:", errMsg);
      }
    });

    socket.on('reconnect', () => {
      console.log("Mobile Socket reconnected");
      joinRoom(); // Re-join on reconnect
    });

    socket.on('disconnect', () => {
      console.log("Mobile Socket disconnected");
      setIsConnected(false);
    });

    socket.on('joined_room', (room) => {
      console.log(`Mobile successfully joined room: ${room}`);
      setStatus('idle');
    });

    socket.on('transfer_paused', () => {
      setIsPaused(true);
      isPausedRef.current = true;
    });

    socket.on('transfer_resumed', () => {
      setIsPaused(false);
      isPausedRef.current = false;
    });

    socket.on('transfer_ready', ({ transferId }) => {
      console.log(`[MOBILE] Receiver ready for transfer: ${transferId}`);
      (window as any)[`ready_${transferId}`] = true;
    });

    socket.on('transfer_chunk_acked', ({ chunkIndex, transferId }) => {
      lastAckedChunkRef.current = chunkIndex;
    });

    socket.on('transfer_success', () => {
      console.log("Server confirmed transfer success");
      setStatus('success');
      setUrl('');
      setText('');
      
      setTimeout(() => {
        setStatus('idle');
      }, 1500);
    });

    // Initial join attempt if already connected
    if (socket.connected) {
      setIsConnected(true);
      joinRoom();
    }

    // Generate background image
    generateBackgroundImage()
      .then(url => {
        if (url) setBgImage(url);
      });

    return () => {
      socket.off('connect');
      socket.off('reconnect');
      socket.off('disconnect');
      socket.off('joined_room');
      socket.off('transfer_success');
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.clear();
      }
    };
  }, [pairId]);

  const handleSend = async (targetData?: any, type: string = 'link', metadata: any = {}) => {
    const payload = targetData || (type === 'link' ? url : text);
    if (!payload) return;

    // Refresh location on every send to ensure accuracy as requested
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        const socket = getSocket('mobile');
        socket.emit('mobile_update_location', {
          pcId: pairId,
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
      }, null, { enableHighAccuracy: true });
    }

    console.log(`Mobile: Sending ${type} to PC room ${pairId}`);
    setStatus('sending');
    setIsPaused(false);
    isPausedRef.current = false;
    const socket = getSocket('mobile');
    
    // If data is ArrayBuffer (photo/scan/file), use chunked transfer for real-time progress
    if (payload instanceof ArrayBuffer) {
      const CHUNK_SIZE = 1024 * 128; // 128KB chunks for better responsiveness and smaller packet size
      const totalChunks = Math.ceil(payload.byteLength / CHUNK_SIZE);
      const transferId = Math.random().toString(36).substring(2, 15);
      lastAckedChunkRef.current = -1;
      
      socket.emit('transfer_start', {
        toId: pairId,
        fileName: metadata.fileName || `mobile_upload_${Date.now()}`,
        mimeType: metadata.mimeType || 'application/octet-stream',
        totalChunks,
        totalSize: payload.byteLength,
        transferId
      });

      // Wait for receiver to be ready
      let attempts = 0;
      while (!(window as any)[`ready_${transferId}`] && attempts < 100) {
        await new Promise(r => setTimeout(r, 50)); // Faster check
        attempts++;
      }
      delete (window as any)[`ready_${transferId}`];

      for (let i = 0; i < totalChunks; i++) {
        // Pause logic
        if (isPausedRef.current) {
          while (isPausedRef.current) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        // Flow control: Smaller sliding window (max 16 chunks ahead = 2MB)
        // This prevents overwhelming the socket buffer and allows for more accurate progress
        while (i - lastAckedChunkRef.current > 16) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, payload.byteLength);
        const chunk = payload.slice(start, end);
        
        socket.emit('transfer_chunk', {
          toId: pairId,
          chunkIndex: i,
          chunkData: chunk,
          transferId
        });
        
        // Yield to UI thread every 2 chunks to keep UI responsive with smaller chunks
        if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
      }

      socket.emit('transfer_complete', { toId: pairId, transferId });
      setStatus('success');
      setTimeout(() => setStatus('idle'), 1500);
      return;
    }

    // Standard send for small data (links, text)
    socket.emit('send_to_pc', { 
      pcId: pairId, 
      data: payload, 
      type,
      ...metadata
    });
    
    // Fallback success if server is slow but socket is connected
    const fallback = setTimeout(() => {
      if (status === 'sending') {
        setStatus('success');
        setTimeout(() => setStatus('idle'), 1500);
      }
    }, 2000);

    return () => clearTimeout(fallback);
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 15MB for raw input)
    if (file.size > 15 * 1024 * 1024) {
      setNotification({ message: "Fichier trop volumineux. Veuillez réduire la résolution.", type: 'error' });
      setTimeout(() => setNotification(null), 4000);
      return;
    }

    setStatus('sending'); // Show loading immediately

    const reader = new FileReader();
    reader.onerror = () => {
      console.error("FileReader error");
      setStatus('idle');
      setNotification({ message: "Erreur lors de la lecture du fichier.", type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    };

    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => {
        console.error("Image load error");
        setStatus('idle');
        setNotification({ message: "Format d'image incompatible.", type: 'error' });
        setTimeout(() => setNotification(null), 4000);
      };
      img.onload = () => {
        // Resize logic - Increased for better quality (Samsung M30 compatible)
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1920; 
        const MAX_HEIGHT = 1920;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          try {
            ctx.drawImage(img, 0, 0, width, height);
            // Optimized quality to 0.85 for faster transfer without major loss
            canvas.toBlob((blob) => {
              if (blob) {
                blob.arrayBuffer().then(buffer => {
                  handleSend(buffer, 'photo', {
                    fileName: `mobile_capture_${Date.now()}.jpg`,
                    mimeType: 'image/jpeg'
                  });
                });
              } else {
                // Fallback to base64 if blob fails
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
                handleSend(compressedBase64, 'photo');
              }
            }, 'image/jpeg', 0.85);
          } catch (err) {
            console.error("Canvas processing error:", err);
            setStatus('idle');
            setNotification({ message: "Erreur de traitement d'image.", type: 'error' });
            setTimeout(() => setNotification(null), 4000);
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const startScanner = () => {
    setShowScanner(true);
    const instanceId = ++qrInstanceId.current;
    
    setTimeout(async () => {
      if (qrInstanceId.current !== instanceId) return;
      
      const readerElement = document.getElementById("reader");
      if (!readerElement) return;

      try {
        // Use Html5Qrcode for better mobile control
        const html5QrCode = new Html5Qrcode("reader");
        html5QrCodeRef.current = html5QrCode;

        const config = { 
          fps: 10, 
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        };

        if (qrInstanceId.current !== instanceId) return;

        try {
          await html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
              setUrl(decodedText);
              closeScanner();
              handleSend(decodedText);
            },
            () => {
              // Ignore scan errors
            }
          );
        } catch (err) {
          console.warn("QR Scanner failed with environment mode, trying default camera...", err);
          await html5QrCode.start(
            { facingMode: "user" }, // Fallback to user camera
            config,
            (decodedText) => {
              setUrl(decodedText);
              closeScanner();
              handleSend(decodedText);
            },
            () => {}
          );
        }
      } catch (err) {
        if (qrInstanceId.current !== instanceId) return;
        console.error("Scanner error:", err);
        // Fallback to Html5QrcodeScanner if direct start fails
        const scanner = new Html5QrcodeScanner(
          "reader",
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false
        );
        scanner.render((decodedText) => {
          setUrl(decodedText);
          scanner.clear();
          setShowScanner(false);
          handleSend(decodedText);
        }, () => {});
        scannerRef.current = scanner;
      }
    }, 400);
  };

  const closeScanner = async () => {
    qrInstanceId.current++; // Invalidate any pending start
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.error("Failed to stop scanner", err);
      }
      html5QrCodeRef.current = null;
    }
    
    if (scannerRef.current) {
      try {
        scannerRef.current.clear();
      } catch (err) {
        console.error("Failed to clear scanner UI", err);
      }
      scannerRef.current = null;
    }
    
    setShowScanner(false);
  };

  const handleModeChange = async (newMode: TransferMode) => {
    if (showScanner) {
      await closeScanner();
    }
    
    // If switching from scanner, give it extra time to cleanup
    if (mode === 'scanner' || newMode === 'scanner') {
      setMode('link'); // Temporary switch to neutral mode
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    
    setMode(newMode);
  };

  return (
    <div className="min-h-screen bg-transparent text-white flex flex-col p-6 font-sans overflow-hidden relative">
      {/* Mandatory Location Overlay */}
      <AnimatePresence>
        {locationStatus !== 'granted' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="bg-white/5 border border-white/10 p-10 rounded-[3rem] w-full max-w-sm">
              <div className="bg-emerald-500/20 p-6 rounded-full inline-block mb-8">
                <Smartphone className="text-emerald-400" size={48} />
              </div>
              <h2 className="text-2xl font-bold mb-4">Identification Obligatoire</h2>
              <p className="text-white/60 text-sm mb-10 leading-relaxed">
                Pour des raisons de sécurité et d'activation du système, l'accès à votre position GPS est requis pour localiser le PC cible.
              </p>
              
              {locationStatus === 'denied' && (
                <div className="bg-zinc-500/10 border border-zinc-500/20 p-4 rounded-2xl mb-8">
                  <p className="text-zinc-400 text-xs font-medium">{locationError}</p>
                </div>
              )}

              <button 
                onClick={requestLocation}
                className="w-full bg-white text-black py-5 rounded-2xl font-bold active:scale-95 transition-transform flex items-center justify-center gap-3 cursor-pointer"
              >
                {locationStatus === 'pending' && <Loader2 className="animate-spin" size={20} />}
                Activer la Localisation
              </button>
              
              <p className="mt-6 text-[10px] text-white/20 uppercase tracking-widest font-mono">
                Condition d'activation requise
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Image with Overlay */}
      {bgImage && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          className="absolute inset-0 z-0"
          style={{ 
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'grayscale(30%)'
          }}
        />
      )}
      
      {/* Dark Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black z-1" />

      <div className="relative z-10 flex flex-col h-full flex-1">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-2 rounded-xl">
              <Smartphone size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold">VIA Mobile</h1>
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-zinc-400 animate-pulse'}`}></div>
              </div>
              <p className="text-xs text-white/40 uppercase tracking-widest">Jumelé au PC</p>
            </div>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex gap-1 mb-8 bg-white/5 p-1 rounded-2xl border border-white/10">
          <button 
            onClick={() => handleModeChange('link')}
            className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${mode === 'link' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
          >
            <QrCode size={12} />
            Lien
          </button>
          <button 
            onClick={() => handleModeChange('photo')}
            className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${mode === 'photo' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
          >
            <Camera size={12} />
            Photo
          </button>
          <button 
            onClick={() => handleModeChange('text')}
            className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${mode === 'text' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
          >
            <FileText size={12} />
            Texte
          </button>
          <button 
            onClick={() => handleModeChange('scanner')}
            className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${mode === 'scanner' ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
          >
            <Maximize size={12} />
            Scan Pro
          </button>
        </div>

      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {status === 'connecting' ? (
            <motion.div 
              key="connecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-4"
            >
              <Loader2 className="animate-spin mx-auto text-white/40" size={48} />
              <p className="text-white/40 text-[10px] uppercase tracking-[0.2em] animate-pulse">Connexion au PC...</p>
            </motion.div>
          ) : status === 'sending' ? (
            <motion.div 
              key="sending"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center space-y-6"
            >
              <div className="relative inline-block">
                <Loader2 className="animate-spin mx-auto text-emerald-500" size={64} />
                {isPaused && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/40 backdrop-blur-sm p-2 rounded-full">
                      <Pause size={24} className="text-white" fill="currentColor" />
                    </div>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <p className="text-white/40 text-[10px] uppercase tracking-[0.2em] animate-pulse">
                  {isPaused ? 'Transfert en pause' : 'Traitement & Envoi en cours...'}
                </p>
                <p className="text-white/20 text-[8px]">Optimisation réseau pour fichiers volumineux</p>
              </div>

              <div className="flex justify-center pt-4">
                {isPaused ? (
                  <button 
                    onClick={() => {
                      setIsPaused(false);
                      isPausedRef.current = false;
                      getSocket('mobile').emit('transfer_resume', { toId: pairId });
                    }}
                    className="px-8 py-3 bg-emerald-500 text-white rounded-2xl font-bold flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
                  >
                    <Play size={16} fill="currentColor" />
                    Reprendre
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setIsPaused(true);
                      isPausedRef.current = true;
                      getSocket('mobile').emit('transfer_pause', { toId: pairId });
                    }}
                    className="px-8 py-3 bg-white/10 text-white rounded-2xl font-bold flex items-center gap-2 active:scale-95 transition-all border border-white/10 cursor-pointer"
                  >
                    <Pause size={16} fill="currentColor" />
                    Pause
                  </button>
                )}
              </div>
            </motion.div>
          ) : status === 'success' ? (
            <motion.div 
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <div className="bg-emerald-500 text-white p-6 rounded-full inline-flex mb-4">
                <CheckCircle2 size={48} />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Envoyé !</h2>
              <p className="text-white/60 text-sm">Transféré avec succès sur votre PC.</p>
            </motion.div>
          ) : (
            <motion.div 
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              {mode === 'link' && (
                <>
                  {!showScanner && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3">
                          <button 
                            onClick={startScanner}
                            className="w-full bg-white text-black py-5 rounded-2xl font-bold flex items-center justify-center gap-3 active:scale-95 transition-transform cursor-pointer"
                          >
                            <QrCode size={20} />
                            Scanner le QR Code
                          </button>
                          
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            ref={qrGalleryInputRef}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setStatus('sending');
                              try {
                                const html5QrCode = new Html5Qrcode("reader-hidden");
                                const decodedText = await html5QrCode.scanFile(file, true);
                                setUrl(decodedText);
                                handleSend(decodedText);
                                html5QrCode.clear();
                              } catch (err) {
                                console.error("QR Gallery error:", err);
                                setStatus('idle');
                                setNotification({ message: "Aucun QR Code valide trouvé.", type: 'info' });
                                setTimeout(() => setNotification(null), 4000);
                              }
                            }}
                          />
                          <button 
                            onClick={() => qrGalleryInputRef.current?.click()}
                            className="w-full bg-white/10 border border-white/10 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 active:scale-95 transition-transform cursor-pointer"
                          >
                            <ImageIcon size={18} />
                            Scanner depuis la Galerie
                          </button>
                        </div>

                        <div id="reader-hidden" className="hidden"></div>

                        <div className="relative flex items-center">
                          <div className="flex-1 h-[1px] bg-white/10"></div>
                          <span className="px-4 text-[10px] text-white/30 font-mono uppercase">ou coller le lien</span>
                          <div className="flex-1 h-[1px] bg-white/10"></div>
                        </div>

                      <div className="relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                          <LinkIcon size={20} />
                        </div>
                        <input 
                          type="text" 
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          placeholder="https://autodesk.viewer/..."
                          className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-white/30 transition-colors text-sm"
                        />
                      </div>

                        <button 
                          disabled={!url || status === 'sending'}
                          onClick={() => handleSend()}
                          className="w-full bg-emerald-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all cursor-pointer shadow-lg shadow-emerald-500/20"
                        >
                          {status === 'sending' ? (
                            <Loader2 className="animate-spin" size={20} />
                          ) : (
                            <>
                              <Send size={18} />
                              Envoyer au PC
                            </>
                          )}
                        </button>
                    </div>
                  )}
                  {showScanner && (
                    <div className="text-center space-y-4">
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-white/10 rounded-full animate-ping"></div>
                        <div className="relative bg-white/5 p-8 rounded-full border border-white/10">
                          <QrCode size={48} className="text-white/40" />
                        </div>
                      </div>
                      <p className="text-white/40 text-[10px] uppercase tracking-[0.2em] animate-pulse">Scanner Actif...</p>
                    </div>
                  )}
                </>
              )}

              {mode === 'photo' && (
                <div className="space-y-6">
                  <div className="bg-white/5 border border-dashed border-white/20 rounded-[2.5rem] p-10 text-center flex flex-col items-center gap-4">
                    <div className="bg-white/10 p-4 rounded-full">
                      <Camera size={32} className="text-white/60" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Partager une Image</h3>
                      <p className="text-[10px] text-white/30 uppercase tracking-widest">Capturez ou choisissez un document</p>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-3 w-full mt-4">
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        ref={fileInputRef}
                        onChange={handlePhotoCapture}
                      />
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full bg-white text-black py-4 rounded-2xl font-bold active:scale-95 transition-transform cursor-pointer flex items-center justify-center gap-3"
                      >
                        <Camera size={20} />
                        Appareil Photo
                      </button>

                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        ref={galleryInputRef}
                        onChange={handlePhotoCapture}
                      />
                      <button 
                        onClick={() => galleryInputRef.current?.click()}
                        className="w-full bg-white/10 border border-white/10 text-white py-4 rounded-2xl font-bold active:scale-95 transition-transform cursor-pointer flex items-center justify-center gap-3"
                      >
                        <ImageIcon size={20} />
                        Galerie Photos
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {mode === 'text' && (
                <div className="space-y-4">
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3 text-white/40">
                      <FileText size={16} />
                      <span className="text-[10px] uppercase tracking-widest font-bold">Notes / Tableaux TXT</span>
                    </div>
                    <textarea 
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Tapez ou collez vos notes ici..."
                      className="w-full bg-transparent border-none focus:ring-0 min-h-[200px] resize-none text-sm"
                    />
                  </div>
                  <button 
                    disabled={!text || status === 'sending'}
                    onClick={() => handleSend(text, 'text')}
                    className="w-full bg-white text-black py-4 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all cursor-pointer"
                  >
                    {status === 'sending' ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <>
                        <Send size={18} />
                        Envoyer le Texte au PC
                      </>
                    )}
                  </button>
                </div>
              )}

              {mode === 'scanner' && (
                <div className="space-y-6">
                  <div className="bg-white/5 border border-dashed border-emerald-500/30 rounded-3xl p-12 text-center flex flex-col items-center gap-4">
                    <div className="bg-emerald-500/10 p-4 rounded-full">
                      <Maximize size={32} className="text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">Scanner Document/Plan</h3>
                      <p className="text-xs text-white/30">Capture intelligente avec correction de perspective</p>
                    </div>
                    <button 
                      onClick={() => setIsScannerOpen(true)}
                      className="mt-4 bg-emerald-500 text-white px-8 py-4 rounded-2xl font-bold active:scale-95 transition-transform shadow-lg shadow-emerald-500/20 cursor-pointer"
                    >
                      Démarrer le Scan
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isScannerOpen && (
        <ScannerModule 
          onClose={() => {
            console.log("Closing ScannerModule");
            setIsScannerOpen(false);
          }}
          onSend={(data, type, metadata) => {
            console.log("ScannerModule sent data:", type);
            handleSend(data, type, metadata);
          }}
        />
      )}

      {showScanner && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="p-6 flex justify-between items-center border-b border-white/10">
            <h2 className="font-bold">Scanner le QR Code</h2>
            <button onClick={closeScanner} className="p-2 bg-white/10 rounded-full cursor-pointer">
              <X size={24} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div id="reader" className="w-full max-w-sm rounded-3xl overflow-hidden border border-white/20"></div>
          </div>
          <div className="p-8 text-center text-white/40 text-sm">
            Pointez votre caméra vers le QR code du plan DWG
          </div>
        </div>
      )}

        <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center text-[10px] text-white/30 font-mono uppercase tracking-widest">
          <div className="flex flex-col">
            <span>ID PC : {pairId}</span>
            <span>Statut : {status}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-emerald-500/40 font-serif italic mb-1">Didier par Merbench</span>
            <button 
              onClick={() => handleSend("Test de connexion réussi !", "text")}
              className="bg-white/5 px-3 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            >
              Tester le lien
            </button>
          </div>
        </div>
      </div>
      {/* Notification Overlay */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-4 right-4 z-[1000] bg-white text-black p-4 rounded-2xl shadow-2xl border border-black/5 flex items-center gap-3"
          >
            <div className={`w-2 h-2 rounded-full ${notification.type === 'error' ? 'bg-red-500' : notification.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'} animate-pulse`} />
            <span className="text-xs font-bold uppercase tracking-wider">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
