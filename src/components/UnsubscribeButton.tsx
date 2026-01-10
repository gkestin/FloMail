'use client';

import React, { useState } from 'react';
import { Mail, ExternalLink, Loader2, Check, AlertCircle } from 'lucide-react';
import { getListUnsubscribeAction, ListUnsubscribeAction } from '@/lib/gmail';

interface UnsubscribeButtonProps {
  listUnsubscribe?: string;
  listUnsubscribePost?: string;
  className?: string;
  variant?: 'subtle' | 'normal';
}

/**
 * Unsubscribe button that handles RFC 8058 one-click unsubscribe,
 * HTTP link unsubscribe, and mailto: unsubscribe.
 */
export function UnsubscribeButton({
  listUnsubscribe,
  listUnsubscribePost,
  className = '',
  variant = 'subtle',
}: UnsubscribeButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Get the unsubscribe action
  const action = getListUnsubscribeAction({ listUnsubscribe, listUnsubscribePost });

  if (!action) {
    // No unsubscribe option available
    return null;
  }

  const handleUnsubscribe = async () => {
    if (status === 'loading' || status === 'success') return;

    setStatus('loading');
    setErrorMessage('');

    try {
      switch (action.type) {
        case 'post':
          // RFC 8058 one-click unsubscribe via POST
          const response = await fetch('/api/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: action.url, body: action.body }),
          });

          if (!response.ok) {
            throw new Error('Failed to unsubscribe');
          }
          setStatus('success');
          break;

        case 'get':
          // Open unsubscribe page in new tab
          window.open(action.url, '_blank', 'noopener,noreferrer');
          setStatus('success');
          break;

        case 'email':
          // Open mailto link
          const mailtoUrl = `mailto:${action.emailAddress}?subject=${encodeURIComponent(action.subject)}`;
          window.open(mailtoUrl, '_blank');
          setStatus('success');
          break;
      }
    } catch (err) {
      console.error('Unsubscribe failed:', err);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unsubscribe failed');
    }
  };

  // Get display info based on action type
  const getActionInfo = () => {
    switch (action.type) {
      case 'post':
        return { icon: Check, label: 'One-click unsubscribe', description: 'Instant unsubscribe' };
      case 'get':
        return { icon: ExternalLink, label: 'Unsubscribe', description: `Opens ${action.host}` };
      case 'email':
        return { icon: Mail, label: 'Unsubscribe via email', description: `Sends to ${action.emailAddress}` };
    }
  };

  const actionInfo = getActionInfo();
  const Icon = actionInfo.icon;

  // Subtle variant (inline text link)
  if (variant === 'subtle') {
    return (
      <button
        onClick={handleUnsubscribe}
        disabled={status === 'loading' || status === 'success'}
        className={`
          inline-flex items-center gap-1 text-xs
          ${status === 'success' 
            ? 'text-green-400' 
            : status === 'error'
              ? 'text-red-400'
              : 'text-text-secondary hover:text-text-primary'
          }
          transition-colors disabled:opacity-50
          ${className}
        `}
        title={actionInfo.description}
      >
        {status === 'loading' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : status === 'success' ? (
          <Check className="w-3 h-3" />
        ) : status === 'error' ? (
          <AlertCircle className="w-3 h-3" />
        ) : (
          <Icon className="w-3 h-3" />
        )}
        <span>{status === 'success' ? 'Unsubscribed' : status === 'error' ? 'Failed' : 'Unsubscribe'}</span>
      </button>
    );
  }

  // Normal variant (button)
  return (
    <button
      onClick={handleUnsubscribe}
      disabled={status === 'loading' || status === 'success'}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
        ${status === 'success'
          ? 'bg-green-500/20 text-green-400'
          : status === 'error'
            ? 'bg-red-500/20 text-red-400'
            : 'bg-surface-secondary hover:bg-surface-tertiary text-text-secondary hover:text-text-primary'
        }
        transition-colors disabled:opacity-50
        ${className}
      `}
      title={actionInfo.description}
    >
      {status === 'loading' ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : status === 'success' ? (
        <Check className="w-4 h-4" />
      ) : status === 'error' ? (
        <AlertCircle className="w-4 h-4" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      <span>
        {status === 'success'
          ? 'Unsubscribed'
          : status === 'error'
            ? 'Failed'
            : actionInfo.label}
      </span>
      {status === 'error' && errorMessage && (
        <span className="text-xs opacity-75">({errorMessage})</span>
      )}
    </button>
  );
}

export default UnsubscribeButton;
