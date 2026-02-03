'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Volume2, 
  VolumeX, 
  Loader2, 
  Square, 
  RotateCcw,
  Minus,
  Plus,
  Zap,
  RefreshCw
} from 'lucide-react';

// TTS settings type
interface TTSSettings {
  voice: string;
  speed: number;
  useNaturalVoice: boolean;
}

const DEFAULT_TTS_SETTINGS: TTSSettings = {
  voice: 'nova',
  speed: 1.0,
  useNaturalVoice: true,
};

function getTTSSettings(): TTSSettings {
  if (typeof window === 'undefined') return DEFAULT_TTS_SETTINGS;
  try {
    const stored = localStorage.getItem('flomail_tts_settings');
    if (stored) return { ...DEFAULT_TTS_SETTINGS, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_TTS_SETTINGS;
}

// Singleton audio references
let globalCurrentAudio: HTMLAudioElement | null = null;
let globalCurrentSpeakingId: string | null = null;
let globalIsBrowserTTS = false;
let globalBrowserUtteranceToken = 0;

// Speed options for the controls
const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

interface TTSControllerProps {
  content: string;
  id: string;
  className?: string;
  compact?: boolean; // For inline usage like in message lists
}

export function TTSController({ content, id, className = '', compact = true }: TTSControllerProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [isBrowserTTS, setIsBrowserTTS] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(() => getTTSSettings().speed);
  const [showControls, setShowControls] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isRestartingRef = useRef(false); // Flag to prevent race condition during restart
  
  // Check if this button's content is currently being spoken
  useEffect(() => {
    const checkState = () => {
      // During restart, ignore transient state changes (cancel -> speak gap)
      if (isRestartingRef.current) {
        return;
      }
      if (globalCurrentSpeakingId !== id) {
        if (state !== 'idle' && state !== 'loading') {
          setState('idle');
          setShowControls(false);
        }
        return;
      }

      if (globalIsBrowserTTS) {
        if (speechSynthesis.speaking) {
          setState(speechSynthesis.paused ? 'paused' : 'playing');
        } else {
          setState('idle');
          setShowControls(false);
        }
      } else if (globalCurrentAudio) {
        // Keep speed in sync with actual playback rate
        setCurrentSpeed(globalCurrentAudio.playbackRate);

        if (globalCurrentAudio.paused) {
          if (globalCurrentAudio.ended || globalCurrentAudio.currentTime === 0) {
            setState('idle');
            setShowControls(false);
          } else {
            setState('paused');
          }
        } else {
          setState('playing');
        }
      }
    };

    checkState();
    const interval = setInterval(checkState, 100);
    return () => clearInterval(interval);
  }, [id, state]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);
  
  const stopAll = useCallback(() => {
    // Stop any browser TTS
    speechSynthesis.cancel();
    
    // Stop any audio
    if (globalCurrentAudio) {
      globalCurrentAudio.pause();
      globalCurrentAudio.currentTime = 0;
      if (globalCurrentAudio.src.startsWith('blob:')) {
        URL.revokeObjectURL(globalCurrentAudio.src);
      }
      globalCurrentAudio = null;
    }
    
    globalCurrentSpeakingId = null;
    globalIsBrowserTTS = false;
    audioRef.current = null;
  }, []);
  
  const speakWithBrowser = useCallback((text: string, speed: number) => {
    stopAll();
    
    const utteranceToken = ++globalBrowserUtteranceToken;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.pitch = 1.0;
    
    utterance.onend = () => {
      if (utteranceToken !== globalBrowserUtteranceToken) return;
      globalCurrentSpeakingId = null;
      globalIsBrowserTTS = false;
      setState('idle');
      setShowControls(false);
    };
    
    utterance.onerror = () => {
      if (utteranceToken !== globalBrowserUtteranceToken) return;
      globalCurrentSpeakingId = null;
      globalIsBrowserTTS = false;
      setState('idle');
      setShowControls(false);
    };
    
    globalCurrentSpeakingId = id;
    globalIsBrowserTTS = true;
    setIsBrowserTTS(true);
    setState('playing');
    setShowControls(true);
    speechSynthesis.speak(utterance);
  }, [id, stopAll]);
  
  const handleStart = async () => {
    const settings = getTTSSettings();
    setCurrentSpeed(settings.speed);
    
    // If natural voice is disabled, use browser fallback immediately
    if (!settings.useNaturalVoice) {
      speakWithBrowser(content, settings.speed);
      return;
    }
    
    // Start loading natural voice
    setState('loading');
    setIsBrowserTTS(false);
    abortControllerRef.current = new AbortController();
    
    try {
      const response = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          voice: settings.voice,
          speed: settings.speed,
        }),
        signal: abortControllerRef.current.signal,
      });
      
      if (!response.ok) {
        throw new Error('TTS API failed');
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        globalCurrentAudio = null;
        globalCurrentSpeakingId = null;
        audioRef.current = null;
        setState('idle');
        setShowControls(false);
      };
      
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        globalCurrentAudio = null;
        globalCurrentSpeakingId = null;
        audioRef.current = null;
        setState('idle');
        setShowControls(false);
        // Fallback to browser
        speakWithBrowser(content, settings.speed);
      };
      
      stopAll(); // Stop any previous audio
      globalCurrentAudio = audio;
      globalCurrentSpeakingId = id;
      globalIsBrowserTTS = false;
      audioRef.current = audio;
      setIsBrowserTTS(false);
      setState('playing');
      setShowControls(true);
      await audio.play();
      
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return; // User cancelled, don't fallback
      }
      console.error('TTS error, falling back to browser:', error);
      setState('idle');
      // Fallback to browser speech synthesis
      speakWithBrowser(content, settings.speed);
    }
  };
  
  const handleSwitchToSystem = () => {
    // Abort any ongoing fetch
    abortControllerRef.current?.abort();
    const settings = getTTSSettings();
    speakWithBrowser(content, settings.speed);
  };
  
  const handleStop = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    stopAll();
    setState('idle');
    setShowControls(false);
  };
  
  const handlePauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isBrowserTTS) {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
        setState('playing');
      } else {
        speechSynthesis.pause();
        setState('paused');
      }
    } else if (globalCurrentAudio) {
      if (globalCurrentAudio.paused) {
        globalCurrentAudio.play();
        setState('playing');
      } else {
        globalCurrentAudio.pause();
        setState('paused');
      }
    }
  };
  
  const handleRewind = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isBrowserTTS && globalCurrentAudio) {
      globalCurrentAudio.currentTime = Math.max(0, globalCurrentAudio.currentTime - 10);
    }
    // Browser TTS doesn't support seeking
  };
  
  // Restart from beginning - works for both audio and browser TTS
  const handleRestart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBrowserTTS) {
      // Set flag to prevent the state checker from seeing the brief "not speaking" gap
      isRestartingRef.current = true;
      setShowControls(true);
      setState('playing');
      globalCurrentSpeakingId = id;
      globalIsBrowserTTS = true;
      
      // For browser TTS, cancel current speech and restart with same speed
      speechSynthesis.cancel();
      
      const utteranceToken = ++globalBrowserUtteranceToken;
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.rate = currentSpeed;
      utterance.pitch = 1.0;
      
      utterance.onend = () => {
        if (utteranceToken !== globalBrowserUtteranceToken) return;
        globalCurrentSpeakingId = null;
        globalIsBrowserTTS = false;
        setState('idle');
        setShowControls(false);
      };
      
      utterance.onerror = () => {
        if (utteranceToken !== globalBrowserUtteranceToken) return;
        globalCurrentSpeakingId = null;
        globalIsBrowserTTS = false;
        setState('idle');
        setShowControls(false);
      };
      
      speechSynthesis.speak(utterance);
      
      // Clear the restarting flag after a short delay (speech should have started by then)
      setTimeout(() => {
        isRestartingRef.current = false;
      }, 200);
    } else if (globalCurrentAudio) {
      // For audio, just seek to beginning
      globalCurrentAudio.currentTime = 0;
      if (globalCurrentAudio.paused) {
        globalCurrentAudio.play();
        setState('playing');
      }
    }
  };
  
  const handleSpeedChange = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    if (!isBrowserTTS && globalCurrentAudio) {
      // Get the actual current speed from the audio element
      const actualCurrentSpeed = globalCurrentAudio.playbackRate;
      const currentIdx = SPEED_OPTIONS.findIndex(s => Math.abs(s - actualCurrentSpeed) < 0.01);

      // Calculate new index with bounds checking
      let newIdx = currentIdx + delta;

      // If we can't find the current speed in options (edge case), find the closest one
      if (currentIdx === -1) {
        // Find the closest speed option
        const closestIdx = SPEED_OPTIONS.reduce((prevIdx, speed, idx) => {
          const prevDiff = Math.abs(SPEED_OPTIONS[prevIdx] - actualCurrentSpeed);
          const currDiff = Math.abs(speed - actualCurrentSpeed);
          return currDiff < prevDiff ? idx : prevIdx;
        }, 0);
        newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, closestIdx + delta));
      } else {
        newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, newIdx));
      }

      const newSpeed = SPEED_OPTIONS[newIdx];
      globalCurrentAudio.playbackRate = newSpeed;
      setCurrentSpeed(newSpeed);
    }
    // Browser TTS doesn't support speed change mid-speech
  };
  
  const handleMainButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (state === 'idle') {
      handleStart();
    } else if (state === 'loading') {
      // Cancel loading
      abortControllerRef.current?.abort();
      setState('idle');
    } else if (state === 'playing' || state === 'paused') {
      // Toggle play/pause or stop
      if (showControls) {
        handlePauseResume(e);
      } else {
        handleStop(e);
      }
    }
  };
  
  // Determine what controls are available
  const canSeek = !isBrowserTTS && state !== 'idle' && state !== 'loading';
  const canChangeSpeed = !isBrowserTTS && state !== 'idle' && state !== 'loading';
  const canPause = state === 'playing' || state === 'paused';
  
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <AnimatePresence mode="wait">
        {/* Idle state - just the speaker button */}
        {state === 'idle' && (
          <motion.button
            key="idle"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            onClick={handleMainButtonClick}
            className="p-1.5 rounded-md transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
            title="Read aloud"
          >
            <Volume2 className="w-4 h-4" />
          </motion.button>
        )}
        
        {/* Loading state - spinner + switch to system button */}
        {state === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-1.5 p-1 rounded-lg"
            style={{ background: 'rgba(59, 130, 246, 0.1)' }}
          >
            <button
              onClick={handleMainButtonClick}
              className="p-1.5 rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-accent-blue)' }}
              title="Cancel"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
            </button>
            
            <button
              onClick={(e) => { e.stopPropagation(); handleSwitchToSystem(); }}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
              title="Use system voice (faster)"
            >
              <Zap className="w-3 h-3" />
              <span className="hidden sm:inline">System</span>
            </button>
          </motion.div>
        )}
        
        {/* Playing/Paused state - full controls */}
        {(state === 'playing' || state === 'paused') && showControls && (
          <motion.div
            key="controls"
            initial={{ opacity: 0, scale: 0.9, width: 'auto' }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex items-center gap-0.5 p-1 rounded-lg"
            style={{ background: 'rgba(59, 130, 246, 0.15)' }}
          >
            {/* Stop button */}
            <button
              onClick={handleStop}
              className="p-2 sm:p-1.5 rounded-md transition-colors hover:bg-white/15 active:bg-white/20"
              style={{ color: 'var(--text-muted)' }}
              title="Stop"
            >
              <Square className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </button>
            
            {/* Rewind 10s - only for audio (not browser TTS) */}
            {canSeek && (
              <button
                onClick={handleRewind}
                className="p-2 sm:p-1.5 rounded-md transition-colors hover:bg-white/15 active:bg-white/20"
                style={{ color: 'var(--text-muted)' }}
                title="Rewind 10 seconds"
              >
                <RotateCcw className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
            )}
            
            {/* Restart - for browser TTS (since we can't rewind) */}
            {isBrowserTTS && (
              <button
                onClick={handleRestart}
                className="p-2 sm:p-1.5 rounded-md transition-colors hover:bg-white/15 active:bg-white/20"
                style={{ color: 'var(--text-muted)' }}
                title="Restart from beginning"
              >
                <RefreshCw className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              </button>
            )}
            
            {/* Play/Pause button */}
            <button
              onClick={handlePauseResume}
              className="p-2 sm:p-1.5 rounded-md transition-colors hover:bg-white/15 active:bg-white/20"
              style={{ color: state === 'playing' ? 'var(--text-accent-blue)' : 'var(--text-muted)' }}
              title={state === 'playing' ? 'Pause' : 'Resume'}
            >
              {state === 'playing' ? (
                <VolumeX className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              ) : (
                <Volume2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              )}
            </button>
            
            {/* Speed controls - only for audio (not browser TTS) */}
            {canChangeSpeed && (
              <>
                <button
                  onClick={(e) => handleSpeedChange(e, -1)}
                  disabled={currentSpeed <= SPEED_OPTIONS[0]}
                  className="p-2 sm:p-1.5 rounded-md transition-colors hover:bg-white/15 active:bg-white/20 disabled:opacity-30"
                  style={{ color: 'var(--text-muted)' }}
                  title="Slow down"
                >
                  <Minus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </button>
                
                <span 
                  className="px-1.5 text-xs font-medium min-w-[36px] text-center"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {currentSpeed}x
                </span>
                
                <button
                  onClick={(e) => handleSpeedChange(e, 1)}
                  disabled={currentSpeed >= SPEED_OPTIONS[SPEED_OPTIONS.length - 1]}
                  className="p-2 sm:p-1.5 rounded-md transition-colors hover:bg-white/15 active:bg-white/20 disabled:opacity-30"
                  style={{ color: 'var(--text-muted)' }}
                  title="Speed up"
                >
                  <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                </button>
              </>
            )}
            
            {/* Browser TTS indicator with speed (can't change mid-speech, but shows what it's set to) */}
            {isBrowserTTS && (
              <div 
                className="flex items-center gap-1 px-1.5"
                title={`System voice at ${currentSpeed}x speed (set in settings)`}
              >
                <Zap className="w-3 h-3 opacity-60" style={{ color: 'var(--text-muted)' }} />
                <span 
                  className="text-xs font-medium opacity-60"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {currentSpeed}x
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Stop any currently playing TTS (exported for use when navigating away, etc.)
export function stopAllTTS() {
  speechSynthesis.cancel();
  if (globalCurrentAudio) {
    globalCurrentAudio.pause();
    globalCurrentAudio.currentTime = 0;
    if (globalCurrentAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(globalCurrentAudio.src);
    }
    globalCurrentAudio = null;
  }
  globalCurrentSpeakingId = null;
  globalIsBrowserTTS = false;
}
