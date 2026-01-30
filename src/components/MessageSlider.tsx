'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, useAnimation, PanInfo } from 'framer-motion';
import { EmailThread } from '@/types';
import { ChatInterface } from './ChatInterface';

interface MessageSliderProps {
  currentThread: EmailThread;
  previousThread?: EmailThread | null;
  nextThread?: EmailThread | null;
  folder: string;
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  draftingPreferences: any;
  onDraftCreated: (draft: any) => void;
  onSendEmail: (draft: any) => Promise<void>;
  onSaveDraft: (draft: any) => Promise<void>;
  onDeleteDraft: (draftId: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onMoveToInbox: () => Promise<void>;
  onStar: () => Promise<void>;
  onUnstar: () => Promise<void>;
  onSnooze: (option: any, customDate?: Date) => Promise<void>;
  onOpenSnoozePicker: () => void;
  onNavigate: (direction: 'next' | 'previous') => void;
  onGoToInbox: () => void;
  onRegisterArchiveHandler: (handler: any) => void;
}

export default function MessageSlider({
  currentThread,
  previousThread,
  nextThread,
  folder,
  aiProvider,
  aiModel,
  draftingPreferences,
  onDraftCreated,
  onSendEmail,
  onSaveDraft,
  onDeleteDraft,
  onArchive,
  onMoveToInbox,
  onStar,
  onUnstar,
  onSnooze,
  onOpenSnoozePicker,
  onNavigate,
  onGoToInbox,
  onRegisterArchiveHandler,
}: MessageSliderProps) {
  const controls = useAnimation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);

  // Handle swipe gestures
  const handleDragEnd = async (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);

    const threshold = 100; // Minimum distance to trigger navigation
    const velocity = info.velocity.x;
    const offset = info.offset.x;

    // Check if we should navigate
    if (Math.abs(offset) > threshold || Math.abs(velocity) > 500) {
      if (offset > 0 && previousThread) {
        // Swipe right - go to previous
        await controls.start({ x: window.innerWidth });
        onNavigate('previous');
      } else if (offset < 0 && nextThread) {
        // Swipe left - go to next
        await controls.start({ x: -window.innerWidth });
        onNavigate('next');
      } else {
        // Snap back if no thread available
        await controls.start({ x: 0 });
      }
    } else {
      // Snap back to center
      await controls.start({ x: 0 });
    }
  };

  const handleDragStart = () => {
    setIsDragging(true);
  };

  // Reset position when thread changes
  useEffect(() => {
    controls.set({ x: 0 });
  }, [currentThread.id, controls]);

  // Render the three-panel layout
  return (
    <div className="relative w-full h-full overflow-hidden" ref={containerRef}>
      <motion.div
        drag="x"
        dragElastic={0.2}
        dragConstraints={{
          left: nextThread ? -window.innerWidth * 0.4 : 0,
          right: previousThread ? window.innerWidth * 0.4 : 0,
        }}
        animate={controls}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 30,
        }}
        className="flex absolute inset-0"
        style={{
          width: '300%',
          left: '-100%',
        }}
      >
        {/* Previous Message */}
        <div className="w-1/3 h-full relative">
          {previousThread ? (
            <div className="absolute inset-0 opacity-50 scale-95">
              <ChatInterface
                thread={previousThread}
                folder={folder}
                provider={aiProvider}
                model={aiModel}
                draftingPreferences={draftingPreferences}
                onDraftCreated={() => {}}
                onSendEmail={() => Promise.resolve()}
                onSaveDraft={() => Promise.resolve()}
                onDeleteDraft={() => Promise.resolve()}
                onArchive={() => Promise.resolve()}
                onMoveToInbox={() => Promise.resolve()}
                onStar={() => Promise.resolve()}
                onUnstar={() => Promise.resolve()}
                onSnooze={() => Promise.resolve()}
                onOpenSnoozePicker={() => {}}
                onNextEmail={() => {}}
                onPreviousEmail={() => {}}
                onGoToInbox={() => {}}
                onRegisterArchiveHandler={() => {}}
              />
            </div>
          ) : (
            <div className="h-full bg-neutral-900" />
          )}
        </div>

        {/* Current Message */}
        <div className="w-1/3 h-full relative">
          <div className={`absolute inset-0 transition-opacity ${isDragging ? 'opacity-95' : 'opacity-100'}`}>
            <ChatInterface
              thread={currentThread}
              folder={folder}
              provider={aiProvider}
              model={aiModel}
              draftingPreferences={draftingPreferences}
              onDraftCreated={onDraftCreated}
              onSendEmail={onSendEmail}
              onSaveDraft={onSaveDraft}
              onDeleteDraft={onDeleteDraft}
              onArchive={onArchive}
              onMoveToInbox={onMoveToInbox}
              onStar={onStar}
              onUnstar={onUnstar}
              onSnooze={onSnooze}
              onOpenSnoozePicker={onOpenSnoozePicker}
              onNextEmail={() => onNavigate('next')}
              onPreviousEmail={() => onNavigate('previous')}
              onGoToInbox={onGoToInbox}
              onRegisterArchiveHandler={onRegisterArchiveHandler}
            />
          </div>
        </div>

        {/* Next Message */}
        <div className="w-1/3 h-full relative">
          {nextThread ? (
            <div className="absolute inset-0 opacity-50 scale-95">
              <ChatInterface
                thread={nextThread}
                folder={folder}
                provider={aiProvider}
                model={aiModel}
                draftingPreferences={draftingPreferences}
                onDraftCreated={() => {}}
                onSendEmail={() => Promise.resolve()}
                onSaveDraft={() => Promise.resolve()}
                onDeleteDraft={() => Promise.resolve()}
                onArchive={() => Promise.resolve()}
                onMoveToInbox={() => Promise.resolve()}
                onStar={() => Promise.resolve()}
                onUnstar={() => Promise.resolve()}
                onSnooze={() => Promise.resolve()}
                onOpenSnoozePicker={() => {}}
                onNextEmail={() => {}}
                onPreviousEmail={() => {}}
                onGoToInbox={() => {}}
                onRegisterArchiveHandler={() => {}}
              />
            </div>
          ) : (
            <div className="h-full bg-neutral-900" />
          )}
        </div>
      </motion.div>
    </div>
  );
}