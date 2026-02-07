'use client';

/**
 * ProfessionalEmailRenderer - A sophisticated email renderer with proper hierarchy
 *
 * Inspired by Superhuman, Spark, and modern email clients
 * Features:
 * - Professional dark color palette (no blues in backgrounds)
 * - Gmail-style stacked cards with clear separation
 * - Proper message hierarchy and visual boundaries
 * - Collapsed quotes by default with subtle indicators
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Copy, Check, MoreHorizontal } from 'lucide-react';
import DOMPurify from 'dompurify';
import { EmailMessage } from '@/types';
import { TTSController } from './TTSController';

interface ProfessionalEmailRendererProps {
  message: EmailMessage;
  isReply?: boolean;
  depth?: number;
  className?: string;
  onNextEmail?: () => void;
  onPreviousEmail?: () => void;
}

/**
 * Professional Dark Color Palette
 * Inspired by Superhuman and Spark
 *
 * Background layers (closer = lighter):
 * - Layer 0 (furthest/base): #0a0a0b
 * - Layer 1 (cards): #131316
 * - Layer 2 (elevated): #1a1a1f
 * - Layer 3 (hover): #232329
 *
 * Text hierarchy:
 * - Primary: rgba(255, 255, 255, 0.90) - Main content
 * - Secondary: rgba(255, 255, 255, 0.70) - Metadata
 * - Tertiary: rgba(255, 255, 255, 0.50) - Muted elements
 * - Quaternary: rgba(255, 255, 255, 0.30) - Very muted
 *
 * Accent colors (muted for dark mode):
 * - Links: #4a9eff (muted blue)
 * - Success: #22c55e (muted green)
 * - Warning: #f59e0b (muted amber)
 * - Error: #ef4444 (muted red)
 *
 * Borders and separators:
 * - Default: rgba(255, 255, 255, 0.08)
 * - Strong: rgba(255, 255, 255, 0.12)
 * - Subtle: rgba(255, 255, 255, 0.04)
 */

const COLORS = {
  bg: {
    base: '#0a0a0b',      // Darkest background
    card: '#131316',      // Card background
    elevated: '#1a1a1f',  // Elevated elements
    hover: '#232329',     // Hover state
  },
  text: {
    primary: 'rgba(255, 255, 255, 0.90)',
    secondary: 'rgba(255, 255, 255, 0.70)',
    tertiary: 'rgba(255, 255, 255, 0.50)',
    quaternary: 'rgba(255, 255, 255, 0.30)',
  },
  border: {
    default: 'rgba(255, 255, 255, 0.08)',
    strong: 'rgba(255, 255, 255, 0.12)',
    subtle: 'rgba(255, 255, 255, 0.04)',
  },
  accent: {
    link: '#4a9eff',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
  }
};

// Parse email content to extract quotes
function parseEmailQuotes(content: string, isHtml: boolean): {
  mainContent: string;
  quotedContent: string | null;
  hasQuotes: boolean;
} {
  if (isHtml) {
    // For HTML, extract ALL blockquotes as a single quoted section
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const blockquotes = doc.querySelectorAll('blockquote');

    if (blockquotes.length === 0) {
      return { mainContent: content, quotedContent: null, hasQuotes: false };
    }

    // Collect ALL quoted content as one section
    let allQuotedHtml = '';
    blockquotes.forEach((bq) => {
      // Preserve the blockquote structure for proper nesting/indentation
      allQuotedHtml += bq.outerHTML;
      // Remove from main content
      bq.remove();
    });

    return {
      mainContent: doc.body.innerHTML,
      quotedContent: allQuotedHtml,
      hasQuotes: true
    };
  }

  // For plain text - find where quoting starts and take EVERYTHING after that
  const lines = content.split('\n');
  const mainLines: string[] = [];
  const quotedLines: string[] = [];
  let inQuote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for markers that indicate the start of ALL quoted content
    if (!inQuote && (
      /^On .+ wrote:?$/i.test(line.trim()) ||
      /^From:|^Sent:|^To:|^Subject:/i.test(line.trim()) ||
      line.includes('---------- Forwarded message') ||
      line.startsWith('>') ||
      // Also check for the specific pattern we see in the emails
      /^On \w+, \w+ \d+, \d+ at \d+:\d+ [AP]M .+ wrote:?$/i.test(line.trim())
    )) {
      inQuote = true;
      // Everything from here is quoted content
      quotedLines.push(line);
      continue;
    }

    if (inQuote) {
      quotedLines.push(line);
    } else {
      mainLines.push(line);
    }
  }

  // Trim trailing empty lines from main content
  while (mainLines.length > 0 && mainLines[mainLines.length - 1].trim() === '') {
    mainLines.pop();
  }

  return {
    mainContent: mainLines.join('\n').trim(),
    quotedContent: quotedLines.length > 0 ? quotedLines.join('\n') : null,
    hasQuotes: quotedLines.length > 0
  };
}

// Extract clean text for TTS - always strips HTML regardless of isHtml flag
function extractTTSContent(content: string, isHtml: boolean): string {
  // Always try to strip if content looks like it has HTML (body can have HTML even when isHtml is false)
  if (isHtml || /<[a-z/][\s\S]*?>/i.test(content)) {
    const tmp = document.createElement('div');
    tmp.innerHTML = content;
    // Remove style/script/noscript - their textContent is CSS/JS junk
    tmp.querySelectorAll('style, script, noscript').forEach(el => el.remove());
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }
  return content;
}

export function ProfessionalEmailRenderer({
  message,
  isReply = false,
  depth = 0,
  className = '',
  onNextEmail,
  onPreviousEmail
}: ProfessionalEmailRendererProps) {
  const [showQuotedContent, setShowQuotedContent] = useState(false);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onNextEmailRef = useRef(onNextEmail);
  const onPreviousEmailRef = useRef(onPreviousEmail);

  const isHtml = !!(message.bodyHtml && message.bodyHtml.trim());
  const content = isHtml ? message.bodyHtml! : (message.body || '');

  // Generate a stable key for the iframe based on content length + first/last chars
  // This forces React to recreate the iframe when content actually changes
  // (fixes issue where navigating between threads doesn't update iframe srcDoc)
  const contentKey = useMemo(() => {
    if (!content) return 'empty';
    return `${message.id}-${content.length}-${content.charCodeAt(0)}-${content.charCodeAt(Math.min(100, content.length - 1))}`;
  }, [message.id, content]);

  // Update refs when props change
  useEffect(() => {
    onNextEmailRef.current = onNextEmail;
    onPreviousEmailRef.current = onPreviousEmail;
  }, [onNextEmail, onPreviousEmail]);

  // Handle postMessage events from iframe for swipe gestures
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const type = e.data?.type;
      if (type === 'flomail-swipe-left') {
        onNextEmailRef.current?.();
      } else if (type === 'flomail-swipe-right') {
        onPreviousEmailRef.current?.();
      } else if (type === 'flomail-vertical-scroll') {
        const deltaY = e.data.deltaY || 0;
        if (iframeRef.current) {
          // Forward vertical scroll to parent for expand/collapse
          const syntheticEvent = new WheelEvent('wheel', {
            deltaY: deltaY,
            deltaX: 0,
            bubbles: true,
            cancelable: true,
          });
          iframeRef.current.dispatchEvent(syntheticEvent);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Parse email structure - now returns a single quoted section
  const { mainContent, quotedContent, hasQuotes } = useMemo(
    () => parseEmailQuotes(content, isHtml),
    [content, isHtml]
  );

  // Get TTS content
  const ttsContent = useMemo(
    () => extractTTSContent(mainContent, isHtml),
    [mainContent, isHtml]
  );

  // Process HTML content with dark mode
  const processedContent = useMemo(() => {
    if (!isHtml) return mainContent;

    let sanitized = DOMPurify.sanitize(mainContent, {
      ALLOWED_TAGS: [
        'a', 'b', 'blockquote', 'br', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td',
        'th', 'thead', 'tr', 'u', 'ul', 'font', 'center', 'hr', 'small', 'big', 'code'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'target', 'rel', 'width', 'height'],
      ALLOW_DATA_ATTR: false
    });

    // Strip all background colors and force dark mode
    sanitized = sanitized.replace(/background(-color)?:\s*[^;}"']+/gi, 'background: transparent');
    sanitized = sanitized.replace(/bgcolor=["']?[^"'\s>]+["']?/gi, '');

    return sanitized;
  }, [mainContent, isHtml]);

  // Detect if we need iframe isolation
  const shouldUseIframe = isHtml && (
    content.includes('<table') ||
    content.includes('<img') ||
    content.includes('style=') ||
    content.length > 2000
  );

  // Auto-resize iframe
  useEffect(() => {
    if (shouldUseIframe && iframeRef.current) {
      const iframe = iframeRef.current;
      const resizeIframe = () => {
        try {
          const height = iframe.contentDocument?.body.scrollHeight || 400;
          iframe.style.height = `${height + 40}px`;
        } catch (e) {
          console.log('Could not resize iframe:', e);
        }
      };

      iframe.onload = () => {
        resizeIframe();
        setTimeout(resizeIframe, 500);
        setTimeout(resizeIframe, 1000);
      };
    }
  }, [shouldUseIframe, processedContent]);

  // Toggle quoted content visibility
  const toggleQuotedContent = useCallback(() => {
    setShowQuotedContent(prev => !prev);
  }, []);

  // Copy content
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ttsContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [ttsContent]);

  // Calculate indentation for replies
  const indentClass = depth > 0 ? `ml-${Math.min(depth * 4, 12)}` : '';
  const borderLeftStyle = depth > 0 ? {
    borderLeft: `2px solid ${COLORS.border.default}`,
    paddingLeft: '12px'
  } : {};

  return (
    <div
      className={`professional-email-renderer ${className} ${indentClass}`}
      style={{
        ...borderLeftStyle,
        background: isReply ? COLORS.bg.card : 'transparent',
        borderRadius: isReply ? '8px' : '0',
        padding: isReply ? '12px' : '0',
        marginBottom: isReply ? '8px' : '0',
        boxShadow: isReply ? '0 1px 3px rgba(0, 0, 0, 0.3)' : 'none'
      }}
    >
      {/* Message Card */}
      <div
        className="message-card"
        style={{
          background: depth === 0 ? COLORS.bg.card : 'transparent',
          borderRadius: '8px',
          padding: depth === 0 ? '16px' : '8px 0',
          border: depth === 0 ? `1px solid ${COLORS.border.subtle}` : 'none',
        }}
      >
        {/* Main Content */}
        <div className="email-content">
          {shouldUseIframe ? (
            <iframe
              key={contentKey}
              ref={iframeRef}
              srcDoc={`
                <!DOCTYPE html>
                <html>
                  <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <base target="_blank">
                    <style>
                      * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                      }
                      html, body {
                        background: ${COLORS.bg.card} !important;
                        color: ${COLORS.text.primary} !important;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        font-size: 15px;
                        line-height: 1.6;
                        padding: 16px;
                      }
                      * {
                        background-color: transparent !important;
                        color: ${COLORS.text.primary} !important;
                      }
                      a {
                        color: ${COLORS.accent.link} !important;
                        text-decoration: underline !important;
                        cursor: pointer !important;
                        touch-action: manipulation !important;
                        -webkit-tap-highlight-color: rgba(74, 158, 255, 0.3) !important;
                      }
                      a:hover {
                        opacity: 0.8 !important;
                      }
                      img {
                        max-width: 100% !important;
                        height: auto !important;
                        border-radius: 4px;
                        opacity: 0.9;
                      }
                      table {
                        border-collapse: collapse !important;
                        border-color: ${COLORS.border.default} !important;
                      }
                      td, th {
                        border-color: ${COLORS.border.default} !important;
                        padding: 8px !important;
                      }
                      blockquote {
                        border-left: 3px solid ${COLORS.border.strong} !important;
                        padding-left: 12px !important;
                        margin: 8px 0 !important;
                        color: ${COLORS.text.secondary} !important;
                      }
                      pre, code {
                        background: ${COLORS.bg.elevated} !important;
                        padding: 8px !important;
                        border-radius: 4px !important;
                        font-size: 14px !important;
                      }
                      hr {
                        border: none !important;
                        border-top: 1px solid ${COLORS.border.default} !important;
                        margin: 16px 0 !important;
                      }
                    </style>
                  </head>
                  <body>
                    ${processedContent}
                    <script>
                      (function() {
                        var touchStartX = 0, touchStartY = 0, touchStartTime = 0, hasActed = false;
                        var wheelAccumX = 0, wheelTimeout = null;
                        var lastWheelTime = 0, wheelVelocityX = 0;

                        // Touch event handling for mobile swipes
                        document.addEventListener('touchstart', function(e) {
                          touchStartX = e.touches[0].clientX;
                          touchStartY = e.touches[0].clientY;
                          touchStartTime = Date.now();
                          hasActed = false;
                        }, { passive: true });

                        document.addEventListener('touchmove', function(e) {
                          if (hasActed) return;
                          var dx = e.touches[0].clientX - touchStartX;
                          var dy = e.touches[0].clientY - touchStartY;
                          var elapsed = Date.now() - touchStartTime;
                          var velocity = Math.abs(dx) / Math.max(elapsed, 1);

                          // Horizontal swipe detection - DISABLED in message region
                          // to allow free horizontal scrolling of wide content.
                          // Navigation should be done via buttons or chat region swipes.
                          // Uncomment below to re-enable with very high thresholds:
                          /*
                          var isDefiniteHorizontalSwipe = Math.abs(dx) > Math.abs(dy) * 3.0;
                          var isVeryLargeSwipe = Math.abs(dx) > 250;
                          var isVeryFastSwipe = velocity > 1.0 && Math.abs(dx) > 150;

                          if (isDefiniteHorizontalSwipe && (isVeryLargeSwipe || isVeryFastSwipe)) {
                            hasActed = true;
                            parent.postMessage({ type: dx < 0 ? 'flomail-swipe-left' : 'flomail-swipe-right' }, '*');
                          }
                          */
                          // Forward vertical touch to parent for expand/collapse
                          if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) {
                            parent.postMessage({ type: 'flomail-vertical-scroll', deltaY: -dy }, '*');
                          }
                        }, { passive: true });

                        // Wheel event handling for desktop trackpad gestures
                        document.addEventListener('wheel', function(e) {
                          var now = Date.now();
                          var timeDelta = now - lastWheelTime;
                          lastWheelTime = now;

                          // Calculate velocity for momentum feel
                          if (timeDelta > 0 && timeDelta < 100) {
                            wheelVelocityX = e.deltaX / timeDelta;
                          } else {
                            wheelVelocityX = 0;
                          }

                          // Horizontal scroll detection - DISABLED in message region
                          // to allow free horizontal scrolling of wide content.
                          // Only forward vertical scroll events to parent.

                          // Always forward vertical scroll to parent for expand/collapse
                          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                            parent.postMessage({ type: 'flomail-vertical-scroll', deltaY: e.deltaY }, '*');
                          }

                          // Note: Horizontal scrolling is now handled natively by the browser
                          // for scrolling wide content. Navigation between threads should be
                          // done via buttons or swipes in the chat region.
                        }, { passive: true });
                      })();
                    </script>
                  </body>
                </html>
              `}
              className="w-full border-0"
              style={{
                minHeight: '100px',
                background: COLORS.bg.card,
                borderRadius: '4px'
              }}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation"
              title="Email content"
            />
          ) : isHtml ? (
            <div
              className="html-content"
              style={{ color: COLORS.text.primary }}
              dangerouslySetInnerHTML={{ __html: processedContent }}
            />
          ) : (
            <div
              className="text-content whitespace-pre-wrap"
              style={{
                color: COLORS.text.primary,
                fontSize: '15px',
                lineHeight: '1.6'
              }}
            >
              {mainContent}
            </div>
          )}
        </div>

        {/* Single Quoted Content Section - Gmail style */}
        {hasQuotes && (
          <div className="quoted-section mt-3">
            <button
              onClick={toggleQuotedContent}
              className="quote-toggle flex items-center gap-1.5 px-2 py-1 rounded-md transition-all"
              style={{
                background: showQuotedContent ? COLORS.bg.elevated : 'transparent',
                color: COLORS.text.tertiary,
                fontSize: '13px',
                border: `1px solid ${showQuotedContent ? COLORS.border.default : 'transparent'}`,
              }}
              onMouseEnter={(e) => {
                if (!showQuotedContent) {
                  e.currentTarget.style.background = COLORS.bg.elevated;
                  e.currentTarget.style.border = `1px solid ${COLORS.border.subtle}`;
                }
              }}
              onMouseLeave={(e) => {
                if (!showQuotedContent) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.border = '1px solid transparent';
                }
              }}
            >
              <ChevronRight
                className={`w-3 h-3 transition-transform ${showQuotedContent ? 'rotate-90' : ''}`}
              />
              <MoreHorizontal className="w-4 h-4" />
              <span style={{ color: COLORS.text.quaternary, fontSize: '12px' }}>
                Show quoted text
              </span>
            </button>

            <AnimatePresence>
              {showQuotedContent && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div
                    className="mt-2 ml-6 p-3 rounded-md"
                    style={{
                      background: COLORS.bg.elevated,
                      border: `1px solid ${COLORS.border.subtle}`,
                      borderLeft: `3px solid ${COLORS.border.strong}`,
                    }}
                  >
                    {isHtml && quotedContent ? (
                      // For HTML, render the quoted content with proper structure
                      <div
                        className="quoted-html-content"
                        style={{
                          color: COLORS.text.secondary,
                          fontSize: '14px',
                        }}
                        dangerouslySetInnerHTML={{ __html: quotedContent }}
                      />
                    ) : (
                      // For plain text, render with preserved formatting
                      <div
                        className="whitespace-pre-wrap"
                        style={{
                          color: COLORS.text.secondary,
                          fontSize: '14px',
                        }}
                      >
                        {quotedContent}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Action Bar */}
        <div
          className="action-bar mt-4 pt-3 flex items-center gap-2"
          style={{ borderTop: `1px solid ${COLORS.border.subtle}` }}
        >
          <button
            onClick={handleCopy}
            className="action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all"
            style={{
              background: 'transparent',
              color: COLORS.text.tertiary,
              border: `1px solid ${COLORS.border.subtle}`
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.bg.elevated;
              e.currentTarget.style.color = COLORS.text.secondary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = COLORS.text.tertiary;
            }}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          <TTSController
            content={ttsContent}
            id={`email-${message.id}`}
            compact={true}
          />
        </div>
      </div>

      <style jsx>{`
        .professional-email-renderer {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .html-content :global(*) {
          background-color: transparent !important;
          color: ${COLORS.text.primary} !important;
        }

        .html-content :global(a) {
          color: ${COLORS.accent.link} !important;
          text-decoration: none !important;
        }

        .html-content :global(a:hover) {
          text-decoration: underline !important;
        }

        .html-content :global(img) {
          max-width: 100% !important;
          height: auto !important;
          border-radius: 4px;
          opacity: 0.9;
        }

        .html-content :global(blockquote),
        .quoted-html-content :global(blockquote) {
          border-left: 3px solid ${COLORS.border.strong} !important;
          padding-left: 12px !important;
          margin: 12px 0 !important;
          color: ${COLORS.text.secondary} !important;
        }

        /* Nested blockquotes for proper thread indentation */
        .quoted-html-content :global(blockquote blockquote) {
          margin-left: 12px !important;
          border-left: 2px solid ${COLORS.border.default} !important;
        }

        .quoted-html-content :global(blockquote blockquote blockquote) {
          margin-left: 24px !important;
          border-left: 2px solid ${COLORS.border.subtle} !important;
        }

        .html-content :global(pre),
        .html-content :global(code) {
          background: ${COLORS.bg.elevated} !important;
          padding: 8px !important;
          border-radius: 4px !important;
          color: ${COLORS.text.primary} !important;
        }

        .html-content :global(table) {
          border-collapse: collapse !important;
          margin: 12px 0 !important;
        }

        .html-content :global(td),
        .html-content :global(th) {
          border: 1px solid ${COLORS.border.default} !important;
          padding: 8px !important;
        }

        .html-content :global(th) {
          background: ${COLORS.bg.elevated} !important;
          font-weight: 600;
        }

        .html-content :global(hr) {
          border: none !important;
          border-top: 1px solid ${COLORS.border.default} !important;
          margin: 16px 0 !important;
        }
      `}</style>
    </div>
  );
}