import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Pause, Play, X, Minus, Square, ChevronDown, ChevronUp, GripHorizontal, Monitor, AlertCircle } from 'lucide-react';
import { useDragControls } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface TransferTask {
  id: string;
  targetName: string;
  fileName: string;
  totalSize: number;
  currentSize: number;
  isPaused: boolean;
  speed: number;
  speedHistory: { time: number; speed: number }[];
}

interface MultiTransferProgressProps {
  transfers: TransferTask[];
  isReceiving?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onCancelAll?: () => void;
  onPauseTask?: (id: string) => void;
  onResumeTask?: (id: string) => void;
  onCancelTask?: (id: string) => void;
}

export default function MultiTransferProgress({ 
  transfers, 
  isReceiving = false,
  onClose,
  onMinimize,
  onPauseAll,
  onResumeAll,
  onCancelAll,
  onPauseTask,
  onResumeTask,
  onCancelTask
}: MultiTransferProgressProps) {
  const [isMini, setIsMini] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const dragControls = useDragControls();

  const totalTransfers = transfers.length;
  const allPaused = transfers.every(t => t.isPaused);
  
  const globalProgress = useMemo(() => {
    if (totalTransfers === 0) return 0;
    const totalSize = transfers.reduce((acc, t) => acc + t.totalSize, 0);
    const currentSize = transfers.reduce((acc, t) => acc + t.currentSize, 0);
    return totalSize > 0 ? Math.min(Math.round((currentSize / totalSize) * 100), 100) : 0;
  }, [transfers]);

  const globalSpeed = useMemo(() => {
    return transfers.reduce((acc, t) => acc + t.speed, 0);
  }, [transfers]);

  const consolidatedHistory = useMemo(() => {
    if (transfers.length === 0) return [];
    
    // Create a map of all unique timestamps from all transfers
    const allTimes = new Set<number>();
    transfers.forEach(t => {
      t.speedHistory?.forEach(p => allTimes.add(p.time));
    });

    // Sort timestamps and take the most recent ones
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b).slice(-60);
    
    // If no history yet, provide a few zero points to keep the graph "alive"
    if (sortedTimes.length === 0) {
      const now = Date.now();
      return [
        { time: now - 2000, speed: 0 },
        { time: now - 1000, speed: 0 },
        { time: now, speed: 0 }
      ];
    }

    // If only one point, add a zero point before it for Recharts to render an area
    if (sortedTimes.length === 1) {
      const time = sortedTimes[0];
      let sumSpeed = 0;
      transfers.forEach(t => {
        const point = t.speedHistory?.find(p => p.time === time);
        if (point) sumSpeed += point.speed;
      });
      return [
        { time: time - 1000, speed: 0 },
        { time, speed: sumSpeed }
      ];
    }

    return sortedTimes.map(time => {
      let sumSpeed = 0;
      transfers.forEach(t => {
        if (!t.speedHistory || t.speedHistory.length === 0) return;
        
        // Find the closest point that is at or before this timestamp
        // Since history is sorted by time, we can find the last one <= time
        let closestSpeed = 0;
        for (let i = t.speedHistory.length - 1; i >= 0; i--) {
          if (t.speedHistory[i].time <= time) {
            // Only use it if it's reasonably close (within 2 seconds)
            if (time - t.speedHistory[i].time < 2000) {
              closestSpeed = t.speedHistory[i].speed;
            }
            break;
          }
        }
        sumSpeed += closestSpeed;
      });
      return { time, speed: sumSpeed };
    });
  }, [transfers]);

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

  return (
    <motion.div 
      initial={{ opacity: 0, y: 100, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        y: 0, 
        scale: 1,
        width: isMaximized ? '600px' : '450px'
      }}
      exit={{ opacity: 0, y: 200, scale: 0.8, transition: { duration: 0.3, ease: "easeIn" } }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      className={cn(
        "fixed z-[100] font-['Segoe_UI',_Tahoma,_Geneva,_Verdana,_sans-serif]",
        isReceiving ? "bottom-8 left-8" : "bottom-8 right-8"
      )}
    >
      <div className="bg-white/10 backdrop-blur-3xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Title Bar */}
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="h-10 bg-white/10 border-b border-white/10 flex items-center justify-between px-4 cursor-move select-none shrink-0"
        >
          <div className="flex items-center gap-2">
            <GripHorizontal size={14} className="text-white/20" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-white/60">
              {isReceiving ? 'Réception groupée' : 'Envoi groupé'}
            </span>
            <span className="bg-blue-500/20 text-blue-400 text-[9px] px-1.5 py-0.5 rounded border border-blue-500/30 font-bold">
              {totalTransfers} APPAREILS
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

        {/* Global Controls */}
        <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {allPaused ? (
              <button 
                onClick={onResumeAll}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-[10px] uppercase font-bold rounded-lg transition-all active:scale-95 shadow-lg shadow-blue-500/20"
              >
                <Play size={12} fill="currentColor" />
                Tout reprendre
              </button>
            ) : (
              <button 
                onClick={onPauseAll}
                className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase font-bold rounded-lg transition-all active:scale-95"
              >
                <Pause size={12} fill="currentColor" />
                Tout suspendre
              </button>
            )}
            <button 
              onClick={onCancelAll}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] uppercase font-bold rounded-lg transition-all active:scale-95 border border-red-500/20"
            >
              <X size={12} />
              Tout annuler
            </button>
          </div>
          <div className="text-right">
            <div className="text-2xl font-light text-white leading-none">
              {globalProgress}%
            </div>
            <div className="text-[9px] text-white/40 font-medium uppercase tracking-wider mt-1">
              Moyenne globale
            </div>
          </div>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {transfers.map((task) => {
            const taskPercentage = Math.min(Math.round((task.currentSize / task.totalSize) * 100), 100);
            return (
              <div key={task.id} className="bg-white/5 border border-white/10 rounded-xl p-3 hover:bg-white/10 transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                      <Monitor size={16} />
                    </div>
                    <div>
                      <h4 className="text-white text-xs font-semibold">{task.targetName}</h4>
                      <p className="text-[10px] text-white/40 truncate max-w-[150px]">{task.fileName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/60">{taskPercentage}%</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {task.isPaused ? (
                        <button onClick={() => onResumeTask?.(task.id)} className="p-1 hover:bg-white/10 rounded text-blue-400"><Play size={12} fill="currentColor" /></button>
                      ) : (
                        <button onClick={() => onPauseTask?.(task.id)} className="p-1 hover:bg-white/10 rounded text-white/60"><Pause size={12} fill="currentColor" /></button>
                      )}
                      <button onClick={() => onCancelTask?.(task.id)} className="p-1 hover:bg-red-500/20 rounded text-red-400"><X size={12} /></button>
                    </div>
                  </div>
                </div>
                
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mb-2">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${taskPercentage}%` }}
                    className={cn("h-full relative", task.isPaused ? "bg-yellow-500" : "bg-blue-500")}
                  />
                </div>

                <div className="flex justify-between text-[9px] text-white/30 font-medium">
                  <span>{formatSize(task.currentSize)} / {formatSize(task.totalSize)}</span>
                  <span>{formatSpeed(task.speed)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Global Stats & Graph */}
        <div className="shrink-0">
          <div className="px-4 py-2 flex justify-between items-center bg-white/5 border-t border-white/10">
            <button 
              onClick={() => setIsMini(!isMini)}
              className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
            >
              {isMini ? (
                <><ChevronDown size={10} /> Détails de vitesse</>
              ) : (
                <><ChevronUp size={10} /> Masquer le graphique</>
              )}
            </button>
            <div className="text-[10px] text-white/40 font-medium">
              Vitesse totale : <span className="text-blue-400">{formatSpeed(globalSpeed)}</span>
            </div>
          </div>

          <AnimatePresence>
            {!isMini && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 100, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="h-[100px] w-full px-2 overflow-hidden bg-white/5"
              >
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart 
                      data={consolidatedHistory}
                      margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                    >
                    <defs>
                      <linearGradient id="colorGlobalSpeed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.6}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid 
                      strokeDasharray="3 3" 
                      vertical={false} 
                      stroke="rgba(255,255,255,0.05)" 
                    />
                    <XAxis hide dataKey="time" />
                    <YAxis 
                      hide 
                      domain={[0, (dataMax: number) => Math.max(dataMax * 1.2, 1024 * 1024)]} 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="speed" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorGlobalSpeed)" 
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-black/20 text-[9px] text-white/20 font-mono flex justify-between items-center shrink-0">
          <span>VIA MULTI-TRANSFER ENGINE v3.0</span>
          <span>{allPaused ? 'SUSPENDU' : 'EN COURS...'}</span>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}} />
    </motion.div>
  );
}
