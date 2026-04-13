import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Pause, Play, X, Minus, Square, ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';
import { useDragControls } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TransferProgressProps {
  fileName: string;
  totalSize: number;
  currentSize: number;
  isReceiving?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  isPaused?: boolean;
}

export default function TransferProgress({ 
  fileName, 
  totalSize, 
  currentSize, 
  isReceiving = false,
  onClose,
  onMinimize,
  onPause,
  onResume,
  isPaused = false
}: TransferProgressProps) {
  const [speedHistory, setSpeedHistory] = useState<{ time: number; speed: number }[]>([]);
  const [lastSize, setLastSize] = useState(0);
  const [lastTime, setLastTime] = useState(Date.now());
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [isMini, setIsMini] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const dragControls = useDragControls();

  const percentage = Math.min(Math.round((currentSize / totalSize) * 100), 100);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isPaused) {
        setCurrentSpeed(0);
        setSpeedHistory(prev => {
          const newHistory = [...prev, { time: Date.now(), speed: 0 }];
          return newHistory.slice(-20);
        });
        return;
      }
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000; // seconds
      if (timeDiff >= 0.5) {
        const sizeDiff = currentSize - lastSize;
        const speed = sizeDiff / timeDiff; // bytes per second
        
        // Add some "jitter" for a dynamic curve as requested
        const jitteredSpeed = speed * (0.9 + Math.random() * 0.2);
        
        setCurrentSpeed(speed);
        setSpeedHistory(prev => {
          const newHistory = [...prev, { time: now, speed: jitteredSpeed }];
          return newHistory.slice(-20); // Keep last 20 points
        });
        
        setLastSize(currentSize);
        setLastTime(now);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [currentSize, lastSize, lastTime, isPaused]);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec: number) => {
    return formatSize(bytesPerSec) + '/s';
  };

  const timeRemaining = useMemo(() => {
    if (currentSpeed <= 0) return '--';
    const remainingBytes = totalSize - currentSize;
    const seconds = Math.ceil(remainingBytes / currentSpeed);
    
    if (seconds > 3600) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
    if (seconds > 60) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    return seconds + 's';
  }, [currentSpeed, totalSize, currentSize]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 100, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        width: isMaximized ? '600px' : '400px'
      }}
      exit={{ opacity: 0, y: 200, scale: 0.8, transition: { duration: 0.3, ease: "easeIn" } }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      className={cn(
        "fixed z-[100] font-['Segoe_UI',_Tahoma,_Geneva,_Verdana,_sans-serif]",
        isReceiving ? "bottom-8 right-[430px]" : "bottom-8 right-8"
      )}
    >
      <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Title Bar (Draggable Area) */}
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="h-10 bg-white/10 border-b border-white/10 flex items-center justify-between px-4 cursor-move select-none"
        >
          <div className="flex items-center gap-2">
            <GripHorizontal size={14} className="text-white/20" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/60">
              {isReceiving ? 'Réception de données' : 'Envoi de données'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={onMinimize}
              className="p-1.5 hover:bg-white/10 rounded-md text-white/40 hover:text-white transition-colors"
              title="Réduire"
            >
              <Minus size={14} />
            </button>
            <button 
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 hover:bg-white/10 rounded-md text-white/40 hover:text-white transition-colors"
              title="Niveau"
            >
              <Square size={12} />
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 hover:bg-red-500/20 rounded-md text-white/40 hover:text-red-400 transition-colors"
              title="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Header Info */}
        <div className="p-5 pb-2 flex justify-between items-start">
          <div className="flex flex-col gap-1 max-w-[70%]">
            <h3 className="text-white font-semibold truncate text-sm" title={fileName}>
              {fileName}
            </h3>
            {!isMini && (
              <span className="text-[10px] text-white/40 font-medium">
                {formatSize(currentSize)} sur {formatSize(totalSize)}
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="text-2xl font-light text-white leading-none">
              {percentage}%
            </span>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div className="px-5 py-2">
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden relative">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              className="h-full bg-blue-500 relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-20 h-full animate-[shine_2s_infinite]" />
            </motion.div>
          </div>
          
          <AnimatePresence>
            {!isMini && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="flex justify-between mt-2 text-[10px] text-white/40 font-medium overflow-hidden"
              >
                <span>Vitesse : {formatSpeed(currentSpeed)}</span>
                <span>Temps restant : {timeRemaining}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Details Toggle Button */}
        <div className="px-5 py-1">
          <button 
            onClick={() => setIsMini(!isMini)}
            className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
          >
            {isMini ? (
              <><ChevronDown size={10} /> Plus de détails</>
            ) : (
              <><ChevronUp size={10} /> Moins de détails</>
            )}
          </button>
        </div>

        {/* Chart Section (Hidden in Mini Mode) */}
        <AnimatePresence>
          {!isMini && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 128, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="h-32 w-full mt-2 px-2 overflow-hidden"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={speedHistory}>
                  <defs>
                    <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    vertical={false} 
                    stroke="rgba(255,255,255,0.05)" 
                  />
                  <XAxis hide dataKey="time" />
                  <YAxis hide domain={[0, 'auto']} />
                  <Area 
                    type="monotone" 
                    dataKey="speed" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorSpeed)" 
                    isAnimationActive={false}
                    filter="drop-shadow(0 0 4px rgba(59, 130, 246, 0.5))"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Controls */}
        <div className="px-5 py-3 bg-white/5 flex justify-between items-center border-t border-white/10 gap-4">
          <div className="flex items-center gap-3">
            {isPaused ? (
              <button 
                onClick={onResume}
                className="flex items-center gap-2 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-[10px] uppercase font-bold rounded-lg transition-all active:scale-95 shadow-lg shadow-blue-500/20"
              >
                <Play size={12} fill="currentColor" />
                Reprendre
              </button>
            ) : (
              <button 
                onClick={onPause}
                className="flex items-center gap-2 px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase font-bold rounded-lg transition-all active:scale-95"
              >
                <Pause size={12} fill="currentColor" />
                Pause
              </button>
            )}
          </div>
          
          {!isMini && (
            <div className="text-[10px] text-white/20 font-mono">
              VIA TRANSFER ENGINE v2.1
            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}} />
    </motion.div>
  );
}
