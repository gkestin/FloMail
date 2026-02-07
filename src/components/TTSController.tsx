'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

// Globals for floating mini-player: tracks the active TTS element and playback metadata
let globalActiveElement: HTMLElement | null = null;
let globalDisplaySpeed = 1.0;
let globalApiBaseSpeed = 1.0;
let globalTTSContent = ''; // Text being spoken (for browser TTS speed changes from floating player)

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
  const containerRef = useRef<HTMLDivElement>(null);
  const isRestartingRef = useRef(false); // Flag to prevent race condition during restart
  const apiBaseSpeedRef = useRef(1.0); // The speed baked into the TTS API audio

  // Strip HTML from content so TTS reads only visible text
  // Handles: style/script blocks, HTML tags, entities, excessive whitespace
  const cleanContent = useMemo(() => {
    let text = content;

    // Use DOM parsing if content looks like it contains HTML tags
    if (typeof document !== 'undefined' && /<[a-z/][\s\S]*?>/i.test(text)) {
      const tmp = document.createElement('div');
      tmp.innerHTML = text;
      // Remove style/script/noscript - their textContent is CSS/JS junk
      tmp.querySelectorAll('style, script, noscript').forEach(el => el.remove());
      text = tmp.textContent || tmp.innerText || text;
    }

    // Decode HTML entities that might remain (e.g. from partially-stripped HTML)
    text = text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'");

    // Clean up excessive whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }, [content]);

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

  // Register this element for the floating mini-player to track visibility
  useEffect(() => {
    if ((state === 'playing' || state === 'paused' || state === 'loading') && globalCurrentSpeakingId === id) {
      globalActiveElement = containerRef.current;
    }
    return () => {
      if (globalActiveElement === containerRef.current) {
        globalActiveElement = null;
      }
    };
  }, [state, id]);
  
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
    globalTTSContent = text;
    globalDisplaySpeed = speed;
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
      speakWithBrowser(cleanContent, settings.speed);
      return;
    }
    
    // Truncate for natural voice API (OpenAI TTS limit is ~4096 chars)
    const MAX_TTS_CHARS = 4000;
    let ttsText = cleanContent;
    if (ttsText.length > MAX_TTS_CHARS) {
      const truncated = ttsText.substring(0, MAX_TTS_CHARS);
      // Try to break at a sentence boundary
      const lastBreak = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('? '),
        truncated.lastIndexOf('! '),
        truncated.lastIndexOf('.\n'),
      );
      ttsText = lastBreak > MAX_TTS_CHARS * 0.5
        ? truncated.substring(0, lastBreak + 1)
        : truncated;
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
          text: ttsText,
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
        speakWithBrowser(cleanContent, settings.speed);
      };
      
      stopAll(); // Stop any previous audio
      globalCurrentAudio = audio;
      globalCurrentSpeakingId = id;
      globalIsBrowserTTS = false;
      globalTTSContent = ttsText;
      globalDisplaySpeed = settings.speed;
      globalApiBaseSpeed = settings.speed;
      audioRef.current = audio;
      apiBaseSpeedRef.current = settings.speed; // Track the speed baked into the audio
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
      speakWithBrowser(cleanContent, settings.speed);
    }
  };
  
  const handleSwitchToSystem = () => {
    // Abort any ongoing fetch
    abortControllerRef.current?.abort();
    const settings = getTTSSettings();
    speakWithBrowser(cleanContent, settings.speed);
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
      
      // Increment token BEFORE cancel so the old utterance's onend/onerror is invalidated
      const utteranceToken = ++globalBrowserUtteranceToken;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanContent);
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

    // Find current speed index and calculate new speed
    // Always use currentSpeed (the UI-displayed speed) as reference, not playbackRate
    // (for natural voice, playbackRate is a ratio of newSpeed/apiBaseSpeed, not the absolute speed)
    const refSpeed = currentSpeed;
    const currentIdx = SPEED_OPTIONS.findIndex(s => Math.abs(s - refSpeed) < 0.01);
    let newIdx = currentIdx + delta;

    if (currentIdx === -1) {
      const closestIdx = SPEED_OPTIONS.reduce((prevIdx, speed, idx) => {
        const prevDiff = Math.abs(SPEED_OPTIONS[prevIdx] - refSpeed);
        const currDiff = Math.abs(speed - refSpeed);
        return currDiff < prevDiff ? idx : prevIdx;
      }, 0);
      newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, closestIdx + delta));
    } else {
      newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, newIdx));
    }

    const newSpeed = SPEED_OPTIONS[newIdx];
    setCurrentSpeed(newSpeed);
    globalDisplaySpeed = newSpeed;

    if (isBrowserTTS) {
      // Browser TTS: restart at new speed (SpeechSynthesis can't change rate mid-utterance)
      isRestartingRef.current = true;
      setState('playing');
      globalCurrentSpeakingId = id;
      globalIsBrowserTTS = true;

      // Increment token BEFORE cancel so the old utterance's onend/onerror is invalidated
      const utteranceToken = ++globalBrowserUtteranceToken;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanContent);
      utterance.rate = newSpeed;
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

      setTimeout(() => {
        isRestartingRef.current = false;
      }, 200);
    } else if (globalCurrentAudio) {
      // Natural voice: the API already baked in apiBaseSpeed, so adjust playbackRate
      // as a ratio to get the desired effective speed
      // e.g., if API generated at 0.5x and user wants 0.75x: playbackRate = 0.75/0.5 = 1.5
      globalCurrentAudio.playbackRate = newSpeed / apiBaseSpeedRef.current;
    }
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
  const canChangeSpeed = state !== 'idle' && state !== 'loading';
  const canPause = state === 'playing' || state === 'paused';
  
  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${state === 'idle' ? className : ''}`}>
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
            
            {/* Browser TTS indicator badge */}
            {isBrowserTTS && (
              <div className="flex items-center px-1" title="System voice">
                <Zap className="w-3 h-3 opacity-50" style={{ color: 'var(--text-muted)' }} />
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

// Floating mini-player that appears when the active TTS controls scroll out of view
export function FloatingTTSMiniPlayer() {
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [browserTTS, setBrowserTTS] = useState(false);
  const [speed, setSpeed] = useState(1.0);

  // Poll global TTS state and check if original element is visible
  useEffect(() => {
    const check = () => {
      if (!globalCurrentSpeakingId) {
        if (visible) setVisible(false);
        return;
      }

      let isPlaying = false;
      let isPaused = false;
      const isBrowser = globalIsBrowserTTS;

      if (isBrowser) {
        isPlaying = speechSynthesis.speaking && !speechSynthesis.paused;
        isPaused = speechSynthesis.paused;
      } else if (globalCurrentAudio) {
        isPlaying = !globalCurrentAudio.paused && !globalCurrentAudio.ended;
        isPaused = globalCurrentAudio.paused && !globalCurrentAudio.ended && globalCurrentAudio.currentTime > 0;
      }

      if (!isPlaying && !isPaused) {
        if (visible) setVisible(false);
        return;
      }

      setPlaying(isPlaying);
      setBrowserTTS(isBrowser);
      setSpeed(globalDisplaySpeed);

      // Check if original controls element is in viewport
      const el = globalActiveElement;
      if (!el) {
        setVisible(true);
        return;
      }
      const rect = el.getBoundingClientRect();
      const inView = rect.top < window.innerHeight && rect.bottom > 0;
      setVisible(!inView);
    };

    const interval = setInterval(check, 200);
    return () => clearInterval(interval);
  }, [visible]);

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    stopAllTTS();
    setVisible(false);
  };

  const handlePauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (browserTTS) {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
      } else {
        speechSynthesis.pause();
      }
    } else if (globalCurrentAudio) {
      if (globalCurrentAudio.paused) {
        globalCurrentAudio.play();
      } else {
        globalCurrentAudio.pause();
      }
    }
  };

  const handleSpeedChange = (e: React.MouseEvent, delta: number) => {
    e.stopPropagation();
    const currentIdx = SPEED_OPTIONS.findIndex(s => Math.abs(s - speed) < 0.01);
    let newIdx: number;

    if (currentIdx === -1) {
      const closestIdx = SPEED_OPTIONS.reduce((prevIdx, _s, idx) =>
        Math.abs(SPEED_OPTIONS[idx] - speed) < Math.abs(SPEED_OPTIONS[prevIdx] - speed) ? idx : prevIdx, 0);
      newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, closestIdx + delta));
    } else {
      newIdx = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, currentIdx + delta));
    }

    const newSpeed = SPEED_OPTIONS[newIdx];
    setSpeed(newSpeed);
    globalDisplaySpeed = newSpeed;

    if (browserTTS && globalTTSContent) {
      // Restart browser TTS at new speed
      const utteranceToken = ++globalBrowserUtteranceToken;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(globalTTSContent);
      utterance.rate = newSpeed;
      utterance.pitch = 1.0;
      utterance.onend = () => {
        if (utteranceToken !== globalBrowserUtteranceToken) return;
        globalCurrentSpeakingId = null;
        globalIsBrowserTTS = false;
      };
      utterance.onerror = () => {
        if (utteranceToken !== globalBrowserUtteranceToken) return;
        globalCurrentSpeakingId = null;
        globalIsBrowserTTS = false;
      };
      speechSynthesis.speak(utterance);
    } else if (globalCurrentAudio) {
      globalCurrentAudio.playbackRate = newSpeed / globalApiBaseSpeed;
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="floating-tts"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 px-2 py-1.5 rounded-full shadow-lg"
          style={{
            background: 'rgba(20, 20, 40, 0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          }}
        >
          {/* Stop */}
          <button
            onClick={handleStop}
            className="p-2 rounded-full transition-colors hover:bg-white/10 active:bg-white/20"
            style={{ color: 'var(--text-muted)' }}
            title="Stop"
          >
            <Square className="w-3.5 h-3.5" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePauseResume}
            className="p-2 rounded-full transition-colors hover:bg-white/10 active:bg-white/20"
            style={{ color: playing ? 'var(--text-accent-blue)' : 'var(--text-muted)' }}
            title={playing ? 'Pause' : 'Resume'}
          >
            {playing ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Speed - */}
          <button
            onClick={(e) => handleSpeedChange(e, -1)}
            disabled={speed <= SPEED_OPTIONS[0]}
            className="p-2 rounded-full transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-30"
            style={{ color: 'var(--text-muted)' }}
            title="Slow down"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <span
            className="text-xs font-medium min-w-[32px] text-center select-none"
            style={{ color: 'var(--text-secondary)' }}
          >
            {speed}x
          </span>

          {/* Speed + */}
          <button
            onClick={(e) => handleSpeedChange(e, 1)}
            disabled={speed >= SPEED_OPTIONS[SPEED_OPTIONS.length - 1]}
            className="p-2 rounded-full transition-colors hover:bg-white/10 active:bg-white/20 disabled:opacity-30"
            style={{ color: 'var(--text-muted)' }}
            title="Speed up"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Browser TTS indicator */}
          {browserTTS && (
            <div className="flex items-center px-0.5" title="System voice">
              <Zap className="w-3 h-3 opacity-50" style={{ color: 'var(--text-muted)' }} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
