'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion, useAnimation, useMotionValue, useTransform } from 'framer-motion';
import { EmailThread, EmailDraft, AIDraftingPreferences } from '@/types';
import { ChatInterface } from './ChatInterface';
import { MailFolder } from './InboxList';

interface SwipeableMessageViewProps {
  currentThread: EmailThread;
  previousThread?: EmailThread | null;
  nextThread?: EmailThread | null;
  folder: MailFolder;
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  draftingPreferences: AIDraftingPreferences;
  onDraftCreated: (draft: EmailDraft) => void;
  onSendEmail: (draft: EmailDraft) => Promise<void>;
  onSaveDraft: (draft: EmailDraft) => Promise<EmailDraft>;
  onDeleteDraft: (draftId: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onMoveToInbox: () => Promise<void>;
  onStar: () => Promise<void>;
  onUnstar: () => Promise<void>;
  onSnooze: (snoozeUntil: Date) => Promise<void>;
  onOpenSnoozePicker: () => void;
  onNavigateToPrevious: () => void;
  onNavigateToNext: () => void;
  onGoToInbox: () => void;
  onRegisterArchiveHandler: (handler: () => void) => void;
}

export default function SwipeableMessageView({
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
  onNavigateToPrevious,
  onNavigateToNext,
  onGoToInbox,
  onRegisterArchiveHandler,
}: SwipeableMessageViewProps) {
  const x = useMotionValue(0);
  const controls = useAnimation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [windowWidth, setWindowWidth] = useState(0);

  // Track window width for responsive behavior
  useEffect(() => {
    const updateWidth = () => setWindowWidth(window.innerWidth);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Transform x position to opacity for adjacent messages
  const currentOpacity = useTransform(x, [-windowWidth / 2, 0, windowWidth / 2], [0.5, 1, 0.5]);
  const previousOpacity = useTransform(x, [0, windowWidth], [0, 1]);
  const nextOpacity = useTransform(x, [-windowWidth, 0], [1, 0]);

  // Handle drag end - decide whether to navigate or snap back
  const handleDragEnd = useCallback(async () => {
    const currentX = x.get();
    const threshold = windowWidth * 0.25; // 25% of screen width

    if (currentX > threshold && previousThread) {
      // Navigate to previous
      await controls.start({ x: windowWidth });
      onNavigateToPrevious();
      // Reset position instantly for next interaction
      x.set(0);
      controls.set({ x: 0 });
    } else if (currentX < -threshold && nextThread) {
      // Navigate to next
      await controls.start({ x: -windowWidth });
      onNavigateToNext();
      // Reset position instantly for next interaction
      x.set(0);
      controls.set({ x: 0 });
    } else {
      // Snap back to center
      await controls.start({ x: 0 });
    }
  }, [x, controls, windowWidth, previousThread, nextThread, onNavigateToPrevious, onNavigateToNext]);

  // Reset position when thread changes
  useEffect(() => {
    x.set(0);
    controls.set({ x: 0 });
  }, [currentThread.id, x, controls]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-neutral-900">
      {/* Container for all three messages */}
      <motion.div
        drag="x"
        dragElastic={0.1}
        dragConstraints={{
          left: nextThread ? -windowWidth * 0.5 : 0,
          right: previousThread ? windowWidth * 0.5 : 0,
        }}
        dragTransition={{
          bounceStiffness: 600,
          bounceDamping: 30
        }}
        onDragEnd={handleDragEnd}
        style={{ x }}
        animate={controls}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 30,
        }}
        className="relative w-full h-full"
      >
        {/* Current Message */}
        <motion.div
          style={{ opacity: currentOpacity }}
          className="absolute inset-0"
        >
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
            onNextEmail={onNavigateToNext}
            onPreviousEmail={onNavigateToPrevious}
            onGoToInbox={onGoToInbox}
            onRegisterArchiveHandler={onRegisterArchiveHandler}
          />
        </motion.div>

        {/* Previous Message (slides in from left) */}
        {previousThread && (
          <motion.div
            style={{
              x: useTransform(x, [0, windowWidth], [-windowWidth, 0]),
              opacity: previousOpacity
            }}
            className="absolute inset-0"
          >
            <div className="w-full h-full pointer-events-none">
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
          </motion.div>
        )}

        {/* Next Message (slides in from right) */}
        {nextThread && (
          <motion.div
            style={{
              x: useTransform(x, [-windowWidth, 0], [0, windowWidth]),
              opacity: nextOpacity
            }}
            className="absolute inset-0"
          >
            <div className="w-full h-full pointer-events-none">
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
          </motion.div>
        )}
      </motion.div>

      {/* Visual indicators for swipe limits */}
      {!previousThread && x.get() > 0 && (
        <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-neutral-800 to-transparent opacity-50" />
      )}
      {!nextThread && x.get() < 0 && (
        <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-neutral-800 to-transparent opacity-50" />
      )}
    </div>
  );
}