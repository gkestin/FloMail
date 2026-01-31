'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatInterface } from './ChatInterface';
import { EmailThread, EmailDraft, AIDraftingPreferences } from '@/types';
import { MailFolder } from './InboxList';

interface ThreadSliderProps {
  threads: EmailThread[];
  currentIndex: number;
  folder: MailFolder;
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  draftingPreferences: AIDraftingPreferences;
  onDraftCreated: (draft: EmailDraft) => void;
  onSendEmail: (draft: EmailDraft) => Promise<void>;
  onSaveDraft: (draft: EmailDraft) => Promise<EmailDraft>;
  onDeleteDraft: (draftId: string) => Promise<void>;
  onArchive: () => void;
  onMoveToInbox: () => void;
  onStar: () => void;
  onUnstar: () => void;
  onSnooze: (snoozeUntil: Date) => Promise<void>;
  onOpenSnoozePicker: () => void;
  onNextEmail: () => void;
  onPreviousEmail: () => void;
  onGoToInbox: () => void;
  onRegisterArchiveHandler: (handler: () => void) => void;
  navigationDirection: 'forward' | 'backward';
}

export default function ThreadSlider({
  threads,
  currentIndex,
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
  onNextEmail,
  onPreviousEmail,
  onGoToInbox,
  onRegisterArchiveHandler,
  navigationDirection
}: ThreadSliderProps) {
  const [displayIndex, setDisplayIndex] = useState(currentIndex);
  const prevIndexRef = useRef(currentIndex);

  useEffect(() => {
    if (currentIndex !== prevIndexRef.current) {
      setDisplayIndex(currentIndex);
      prevIndexRef.current = currentIndex;
    }
  }, [currentIndex]);

  // Get the three threads to render (previous, current, next)
  const prevThread = displayIndex > 0 ? threads[displayIndex - 1] : null;
  const currentThread = threads[displayIndex];
  const nextThread = displayIndex < threads.length - 1 ? threads[displayIndex + 1] : null;

  if (!currentThread) return null;

  // Calculate the X offset based on which thread we're showing
  const xOffset = navigationDirection === 'forward' ? '-100%' : '100%';

  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute inset-0 flex"
        initial={false}
        animate={{ x: 0 }}
        transition={{
          type: "tween",
          duration: 0.25,
          ease: [0.25, 0.1, 0.25, 1]
        }}
        style={{ width: '300%', left: '-100%' }}
      >
        {/* Previous thread */}
        <div className="w-1/3 h-full">
          {prevThread && (
            <ChatInterface
              thread={prevThread}
              folder={folder}
              provider={aiProvider}
              model={aiModel}
              draftingPreferences={draftingPreferences}
              onDraftCreated={() => {}}
              onSendEmail={() => Promise.resolve()}
              onSaveDraft={(draft) => Promise.resolve(draft)}
              onDeleteDraft={() => Promise.resolve()}
              onArchive={() => {}}
              onMoveToInbox={() => {}}
              onStar={() => {}}
              onUnstar={() => {}}
              onSnooze={() => Promise.resolve()}
              onOpenSnoozePicker={() => {}}
              onNextEmail={() => {}}
              onPreviousEmail={() => {}}
              onGoToInbox={() => {}}
              onRegisterArchiveHandler={() => {}}
            />
          )}
        </div>

        {/* Current thread */}
        <div className="w-1/3 h-full">
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
            onNextEmail={onNextEmail}
            onPreviousEmail={onPreviousEmail}
            onGoToInbox={onGoToInbox}
            onRegisterArchiveHandler={onRegisterArchiveHandler}
          />
        </div>

        {/* Next thread */}
        <div className="w-1/3 h-full">
          {nextThread && (
            <ChatInterface
              thread={nextThread}
              folder={folder}
              provider={aiProvider}
              model={aiModel}
              draftingPreferences={draftingPreferences}
              onDraftCreated={() => {}}
              onSendEmail={() => Promise.resolve()}
              onSaveDraft={(draft) => Promise.resolve(draft)}
              onDeleteDraft={() => Promise.resolve()}
              onArchive={() => {}}
              onMoveToInbox={() => {}}
              onStar={() => {}}
              onUnstar={() => {}}
              onSnooze={() => Promise.resolve()}
              onOpenSnoozePicker={() => {}}
              onNextEmail={() => {}}
              onPreviousEmail={() => {}}
              onGoToInbox={() => {}}
              onRegisterArchiveHandler={() => {}}
            />
          )}
        </div>
      </motion.div>
    </div>
  );
}