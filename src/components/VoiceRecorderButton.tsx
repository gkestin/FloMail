'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square } from 'lucide-react';
import { WaveformVisualizer } from './WaveformVisualizer';

interface VoiceRecorderButtonProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  analyserNode: AnalyserNode | null;
  duration: number;
  disabled?: boolean;
}

export function VoiceRecorderButton({
  isRecording,
  onStartRecording,
  onStopRecording,
  analyserNode,
  duration,
  disabled = false,
}: VoiceRecorderButtonProps) {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClick = () => {
    if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Waveform - shows when recording */}
      <AnimatePresence>
        {isRecording && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="flex items-center gap-2 overflow-hidden"
          >
            <WaveformVisualizer
              analyserNode={analyserNode}
              isRecording={isRecording}
              compact
              className="w-32"
            />
            <span className="text-xs font-mono text-slate-400 min-w-[40px]">
              {formatDuration(duration)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record/Stop Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleClick}
        disabled={disabled}
        className={`
          relative p-3 rounded-full transition-all duration-200
          ${isRecording
            ? 'bg-red-500 shadow-lg shadow-red-500/30'
            : 'bg-gradient-to-r from-purple-500 to-cyan-500 shadow-lg shadow-purple-500/20'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <AnimatePresence mode="wait">
          {isRecording ? (
            <motion.div
              key="stop"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 90 }}
              transition={{ duration: 0.15 }}
            >
              <Square className="w-5 h-5 text-white fill-white" />
            </motion.div>
          ) : (
            <motion.div
              key="mic"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Mic className="w-5 h-5 text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pulsing ring when recording */}
        {isRecording && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-red-400"
            animate={{ scale: [1, 1.4], opacity: [0.6, 0] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </motion.button>
    </div>
  );
}
