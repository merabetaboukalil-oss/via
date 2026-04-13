import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getSocket } from '../socket';
import { Monitor, Smartphone, Loader2, ExternalLink, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function PCView() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'waiting' | 'connected' | 'received'>('waiting');
  const [receivedUrl, setReceivedUrl] = useState<string | null>(null);

  useEffect(() => {
    const socket = getSocket();

    socket.emit('request_session');

    socket.on('session_created', (id: string) => {
      setSessionId(id);
    });

    socket.on('mobile_connected', () => {
      setStatus('connected');
    });

    socket.on('file_received', (url: string) => {
      setReceivedUrl(url);
      setStatus('received');
      // Automatically open the URL in a new tab
      window.open(url, '_blank');
    });

    return () => {
      socket.off('session_created');
      socket.off('mobile_connected');
      socket.off('file_received');
    };
  }, []);

  const mobileUrl = sessionId ? `${window.location.origin}?session=${sessionId}` : '';

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col items-center justify-center p-6 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-sm border border-black/5 p-8 text-center"
      >
        <div className="flex justify-center mb-6">
          <div className="bg-black text-white p-3 rounded-2xl">
            <Monitor size={32} />
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-2">DWG Link Bridge</h1>
        <p className="text-gray-500 mb-8">Connect your mobile to transfer file links instantly.</p>

        <AnimatePresence mode="wait">
          {status === 'waiting' && (
            <motion.div 
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center"
            >
              {sessionId ? (
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-inner mb-6">
                  <QRCodeSVG value={mobileUrl} size={200} level="H" />
                </div>
              ) : (
                <div className="h-[232px] flex items-center justify-center mb-6">
                  <Loader2 className="animate-spin text-gray-300" size={48} />
                </div>
              )}
              <div className="flex items-center gap-2 text-sm font-medium text-gray-600 bg-gray-50 px-4 py-2 rounded-full">
                <Smartphone size={16} />
                <span>Scan with your phone to link</span>
              </div>
            </motion.div>
          )}

          {status === 'connected' && (
            <motion.div 
              key="connected"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="py-12 flex flex-col items-center"
            >
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-emerald-100 rounded-full animate-ping opacity-25"></div>
                <div className="relative bg-emerald-500 text-white p-4 rounded-full">
                  <CheckCircle2 size={48} />
                </div>
              </div>
              <h2 className="text-xl font-medium text-gray-900 mb-2">Connected!</h2>
              <p className="text-gray-500">Waiting for file link from your mobile...</p>
            </motion.div>
          )}

          {status === 'received' && (
            <motion.div 
              key="received"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-8 flex flex-col items-center"
            >
              <div className="bg-emerald-50 text-emerald-700 p-4 rounded-2xl border border-emerald-100 mb-6 w-full text-left overflow-hidden">
                <p className="text-xs uppercase tracking-wider font-bold mb-1 opacity-60">Received Link</p>
                <p className="font-mono text-sm truncate">{receivedUrl}</p>
              </div>
              <button 
                onClick={() => window.open(receivedUrl!, '_blank')}
                className="w-full bg-black text-white py-4 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors"
              >
                <ExternalLink size={18} />
                Open File Again
              </button>
              <button 
                onClick={() => setStatus('connected')}
                className="mt-4 text-sm text-gray-500 hover:text-gray-900"
              >
                Transfer another file
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="mt-8 text-xs text-gray-400 font-mono uppercase tracking-widest">
        Session ID: {sessionId || '...'}
      </div>
    </div>
  );
}
