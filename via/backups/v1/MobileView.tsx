import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../socket';
import { Smartphone, Send, QrCode, Link as LinkIcon, Loader2, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface MobileViewProps {
  sessionId: string;
}

export default function MobileView({ sessionId }: MobileViewProps) {
  const [status, setStatus] = useState<'connecting' | 'idle' | 'sending' | 'success'>('connecting');
  const [url, setUrl] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('join_session', sessionId);
    setStatus('idle');

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
    };
  }, [sessionId]);

  const handleSend = (targetUrl?: string) => {
    const finalUrl = targetUrl || url;
    if (!finalUrl) return;

    setStatus('sending');
    const socket = getSocket();
    socket.emit('send_to_pc', { sessionId, url: finalUrl });
    
    setTimeout(() => {
      setStatus('success');
      setUrl('');
      setTimeout(() => setStatus('idle'), 2000);
    }, 1000);
  };

  const startScanner = () => {
    setShowScanner(true);
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner(
        "reader",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        /* verbose= */ false
      );
      
      scanner.render((decodedText) => {
        setUrl(decodedText);
        scanner.clear();
        setShowScanner(false);
        handleSend(decodedText);
      }, (error) => {
        // console.warn(error);
      });
      
      scannerRef.current = scanner;
    }, 100);
  };

  const closeScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear();
    }
    setShowScanner(false);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col p-6 font-sans overflow-hidden">
      <div className="flex items-center gap-3 mb-8">
        <div className="bg-white/10 p-2 rounded-xl">
          <Smartphone size={24} />
        </div>
        <div>
          <h1 className="font-semibold">Mobile Bridge</h1>
          <p className="text-xs text-white/40 uppercase tracking-widest">Linked to PC</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {status === 'success' ? (
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
              <h2 className="text-2xl font-semibold mb-2">Sent Successfully!</h2>
              <p className="text-white/60">The file link is now open on your PC.</p>
            </motion.div>
          ) : (
            <motion.div 
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="space-y-4">
                <button 
                  onClick={startScanner}
                  className="w-full bg-white text-black py-6 rounded-3xl font-bold flex items-center justify-center gap-3 active:scale-95 transition-transform"
                >
                  <QrCode size={24} />
                  Scan DWG QR Code
                </button>

                <div className="relative flex items-center">
                  <div className="flex-1 h-px bg-white/10"></div>
                  <span className="px-4 text-xs text-white/30 font-mono uppercase">or paste link</span>
                  <div className="flex-1 h-px bg-white/10"></div>
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
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>

                <button 
                  disabled={!url || status === 'sending'}
                  onClick={() => handleSend()}
                  className="w-full bg-white/10 border border-white/10 py-4 rounded-2xl font-medium flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all"
                >
                  {status === 'sending' ? (
                    <Loader2 className="animate-spin" size={20} />
                  ) : (
                    <>
                      <Send size={18} />
                      Send to PC
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showScanner && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="p-6 flex justify-between items-center border-bottom border-white/10">
            <h2 className="font-bold">Scan QR Code</h2>
            <button onClick={closeScanner} className="p-2 bg-white/10 rounded-full">
              <X size={24} />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div id="reader" className="w-full max-w-sm rounded-3xl overflow-hidden border border-white/20"></div>
          </div>
          <div className="p-8 text-center text-white/40 text-sm">
            Point your camera at the DWG plan's QR code
          </div>
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-white/10 flex justify-between items-center text-[10px] text-white/30 font-mono uppercase tracking-widest">
        <span>Session: {sessionId}</span>
        <span>Status: {status}</span>
      </div>
    </div>
  );
}
