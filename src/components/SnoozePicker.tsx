'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Sun, Calendar, ChevronRight, X, Timer, RotateCcw, Loader2 } from 'lucide-react';
import { SnoozeOption, calculateSnoozeUntil, formatSnoozeTime } from '@/lib/snooze-persistence';

interface SnoozePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (option: SnoozeOption, customDate?: Date) => Promise<void> | void;
  isLoading?: boolean;
}

// Storage key for last snooze option
const LAST_SNOOZE_KEY = 'flomail_last_snooze';

// Get the last used snooze option from localStorage
function getLastSnooze(): { option: SnoozeOption; customDate?: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LAST_SNOOZE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// Save the last used snooze option
export function saveLastSnooze(option: SnoozeOption, customDate?: Date) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAST_SNOOZE_KEY, JSON.stringify({
      option,
      customDate: customDate?.toISOString(),
    }));
  } catch {
    // Ignore storage errors
  }
}

// Get label for a snooze option
function getOptionLabel(option: SnoozeOption): string {
  switch (option) {
    case 'later_today': return 'Later today';
    case 'tomorrow': return 'Tomorrow';
    case 'this_weekend': return 'This weekend';
    case 'in_30_minutes': return '30 min';
    case 'in_1_hour': return '1 hour';
    case 'in_3_hours': return '3 hours';
    case 'custom': return 'Custom';
    default: return option;
  }
}

// Quick snooze options with preview times
const SNOOZE_OPTIONS: { 
  option: SnoozeOption; 
  label: string; 
  icon: React.ElementType;
  getPreview: () => string;
}[] = [
  { 
    option: 'later_today', 
    label: 'Later today',
    icon: Clock,
    getPreview: () => formatSnoozeTime(calculateSnoozeUntil('later_today')),
  },
  { 
    option: 'tomorrow', 
    label: 'Tomorrow',
    icon: Sun,
    getPreview: () => formatSnoozeTime(calculateSnoozeUntil('tomorrow')),
  },
  { 
    option: 'this_weekend', 
    label: 'This weekend',
    icon: Calendar,
    getPreview: () => formatSnoozeTime(calculateSnoozeUntil('this_weekend')),
  },
];

// Quick delay options
const QUICK_SNOOZE_OPTIONS: { 
  option: SnoozeOption; 
  label: string; 
  icon: React.ElementType;
  getPreview: () => string;
}[] = [
  { 
    option: 'in_30_minutes', 
    label: '30 min',
    icon: Timer,
    getPreview: () => formatSnoozeTime(calculateSnoozeUntil('in_30_minutes')),
  },
  { 
    option: 'in_1_hour', 
    label: '1 hour',
    icon: Timer,
    getPreview: () => formatSnoozeTime(calculateSnoozeUntil('in_1_hour')),
  },
  { 
    option: 'in_3_hours', 
    label: '3 hours',
    icon: Timer,
    getPreview: () => formatSnoozeTime(calculateSnoozeUntil('in_3_hours')),
  },
];

export function SnoozePicker({ isOpen, onClose, onSelect, isLoading = false }: SnoozePickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('13:00');
  const [lastSnooze, setLastSnooze] = useState<{ option: SnoozeOption; customDate?: string } | null>(null);

  // Load last snooze option on mount
  useEffect(() => {
    if (isOpen) {
      setLastSnooze(getLastSnooze());
    }
  }, [isOpen]);

  const handleCustomSubmit = () => {
    if (!customDate) return;
    
    const [year, month, day] = customDate.split('-').map(Number);
    const [hours, minutes] = customTime.split(':').map(Number);
    
    const date = new Date(year, month - 1, day, hours, minutes);
    
    if (date <= new Date()) {
      // Don't allow snoozing to the past
      return;
    }
    
    onSelect('custom', date);
    setShowCustom(false);
    setCustomDate('');
  };

  const handleSelectOption = (option: SnoozeOption, customDate?: Date) => {
    onSelect(option, customDate);
  };

  // Get minimum date for the date picker (today)
  const today = new Date().toISOString().split('T')[0];

  // Use portal to render at document body to avoid positioning issues
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[9998]"
            style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          />
          
          {/* Picker modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed z-[9999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] max-w-[90vw] rounded-xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5" style={{ color: 'var(--text-accent-blue)' }} />
                <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  Snooze until...
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10" 
                style={{ background: 'rgba(0, 0, 0, 0.7)' }}>
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-accent-blue)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Snoozing...</span>
                </div>
              </div>
            )}
            
            {!showCustom ? (
              /* Quick options */
              <div className="py-2">
                {/* Repeat last snooze (if available) */}
                {lastSnooze && (
                  <>
                    <button
                      onClick={() => {
                        const customDate = lastSnooze.customDate ? new Date(lastSnooze.customDate) : undefined;
                        handleSelectOption(lastSnooze.option, customDate);
                      }}
                      disabled={isLoading}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-center gap-3">
                        <RotateCcw className="w-5 h-5" style={{ color: 'rgb(168, 85, 247)' }} />
                        <span style={{ color: 'var(--text-primary)' }}>
                          Repeat: {getOptionLabel(lastSnooze.option)}
                        </span>
                      </div>
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {lastSnooze.option === 'custom' && lastSnooze.customDate
                          ? formatSnoozeTime(new Date(lastSnooze.customDate))
                          : formatSnoozeTime(calculateSnoozeUntil(lastSnooze.option))}
                      </span>
                    </button>
                    <div style={{ borderBottom: '1px solid var(--border-subtle)', margin: '0.25rem 0' }} />
                  </>
                )}
                
                {/* Snooze until section */}
                <div className="px-4 py-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Snooze until
                  </span>
                </div>
                {SNOOZE_OPTIONS.map(({ option, label, icon: Icon, getPreview }) => (
                  <button
                    key={option}
                    onClick={() => handleSelectOption(option)}
                    disabled={isLoading}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5" style={{ color: 'var(--text-accent-blue)' }} />
                      <span style={{ color: 'var(--text-primary)' }}>{label}</span>
                    </div>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {getPreview()}
                    </span>
                  </button>
                ))}
                
                {/* Quick snooze section - compact horizontal layout */}
                <div className="px-4 py-1.5 mt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    Quick snooze
                  </span>
                </div>
                <div className="flex gap-2 px-4 py-2">
                  {QUICK_SNOOZE_OPTIONS.map(({ option, label }) => (
                    <button
                      key={option}
                      onClick={() => handleSelectOption(option)}
                      disabled={isLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                      style={{ background: 'var(--bg-interactive)', border: '1px solid var(--border-subtle)' }}
                    >
                      <Timer className="w-3.5 h-3.5" style={{ color: 'var(--text-accent-blue)' }} />
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{label}</span>
                    </button>
                  ))}
                </div>
                
                {/* Custom option */}
                <button
                  onClick={() => setShowCustom(true)}
                  disabled={isLoading}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors disabled:opacity-50"
                  style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '0.25rem' }}
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
                    <span style={{ color: 'var(--text-primary)' }}>Pick date & time</span>
                  </div>
                  <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                </button>
              </div>
            ) : (
              /* Custom date/time picker */
              <div className="p-4 space-y-4" style={{ overflow: 'hidden' }}>
                <div style={{ width: '100%', overflow: 'hidden' }}>
                  <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    min={today}
                    className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-interactive)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-default)',
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                      appearance: 'none',
                    }}
                  />
                </div>

                <div style={{ width: '100%', overflow: 'hidden' }}>
                  <label className="block text-sm mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    Time
                  </label>
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      background: 'var(--bg-interactive)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-default)',
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                      appearance: 'none',
                    }}
                  />
                </div>
                
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowCustom(false)}
                    className="flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors"
                    style={{ 
                      background: 'var(--bg-interactive)', 
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCustomSubmit}
                    disabled={!customDate}
                    className="flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ 
                      background: 'var(--bg-accent-blue)', 
                      color: 'white',
                    }}
                  >
                    Snooze
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
