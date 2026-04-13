import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Share2, Download } from 'lucide-react';

interface TransferTaskbarIconProps {
  percentage: number;
  fileName: string;
  isReceiving: boolean;
  onClick: () => void;
}

export default function TransferTaskbarIcon({ 
  percentage, 
  fileName, 
  isReceiving, 
  onClick 
}: TransferTaskbarIconProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="relative">
      {/* Thumbnail Preview */}
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-48 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-xl p-3 shadow-2xl pointer-events-none z-[110]"
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-white font-semibold truncate flex-1">
                  {fileName}
                </span>
                <span className="text-[10px] text-white/60 font-mono">
                  {percentage}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  className="h-full bg-blue-500"
                />
              </div>
              <div className="text-[8px] text-white/40 uppercase tracking-widest font-bold">
                {isReceiving ? 'Réception...' : 'Envoi...'}
              </div>
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-white/10" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Taskbar Icon */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative p-3 bg-white/10 hover:bg-white/20 rounded-xl border border-white/10 transition-colors group"
      >
        {isReceiving ? (
          <Download size={20} className="text-blue-400" />
        ) : (
          <Share2 size={20} className="text-emerald-400" />
        )}
        
        {/* Progress Ring (Subtle) */}
        <svg className="absolute inset-0 w-full h-full -rotate-90">
          <circle
            cx="22"
            cy="22"
            r="18"
            stroke="currentColor"
            strokeWidth="2"
            fill="transparent"
            className="text-white/5"
          />
          <motion.circle
            cx="22"
            cy="22"
            r="18"
            stroke="currentColor"
            strokeWidth="2"
            fill="transparent"
            strokeDasharray="113"
            animate={{ strokeDashoffset: 113 - (113 * percentage) / 100 }}
            className={isReceiving ? "text-blue-500" : "text-emerald-500"}
          />
        </svg>

        {/* Badge */}
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[8px] font-bold text-white shadow-lg">
          !
        </div>
      </motion.button>
    </div>
  );
}
