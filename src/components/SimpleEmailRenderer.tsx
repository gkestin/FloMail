'use client';

/**
 * SimpleEmailRenderer - A clean, consistent email renderer for dark mode
 *
 * Features:
 * - Consistent grayscale color palette
 * - Collapsed quotes by default
 * - Proper contrast for all content
 * - Smart HTML/plain text detection
 * - Clean, unified appearance
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Copy, Check, Volume2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { EmailMessage } from '@/types';
import { TTSController } from './TTSController';

interface SimpleEmailRendererProps {
  message: EmailMessage;
  className?: string;
}

// Parse email content to extract main body and quoted sections
function parseEmailQuotes(content: string, isHtml: boolean): {
  mainContent: string;
  quotes: Array<{ attribution?: string; content: string; depth: number }>;
} {
  const quotes: Array<{ attribution?: string; content: string; depth: number }> = [];

  if (isHtml) {
    // For HTML, extract blockquotes as quotes
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const blockquotes = doc.querySelectorAll('blockquote');

    // Remove blockquotes from main content and store as quotes
    blockquotes.forEach((bq, index) => {
      const quoteText = bq.textContent || '';
      if (quoteText.trim()) {
        // Check for attribution line before blockquote
        const prevElement = bq.previousElementSibling;
        let attribution: string | undefined;
        if (prevElement && prevElement.textContent) {
          const text = prevElement.textContent.trim();
          if (/On .+ wrote:|From:|Le .+ a écrit/i.test(text)) {
            attribution = text;
            prevElement.remove();
          }
        }

        quotes.push({
          attribution,
          content: quoteText.trim(),
          depth: 1
        });
      }

      // Replace blockquote with placeholder
      const placeholder = doc.createElement('div');
      placeholder.className = 'quote-placeholder';
      placeholder.setAttribute('data-quote-index', String(index));
      bq.parentNode?.replaceChild(placeholder, bq);
    });

    // Return modified HTML without blockquotes
    const mainContent = doc.body.innerHTML;
    return { mainContent, quotes };
  }

  // For plain text, detect common quote patterns
  const lines = content.split('\n');
  const mainLines: string[] = [];
  let currentQuote: string[] = [];
  let quoteAttribution: string | undefined;
  let inQuote = false;
  let depth = 0;

  for (const line of lines) {
    // Check for quote attribution lines
    if (/^On .+ wrote:?$/i.test(line.trim()) ||
        /^Le .+ a écrit/i.test(line.trim()) ||
        /^From:|^Sent:|^To:|^Subject:/i.test(line.trim())) {
      if (mainLines.length > 0 && !inQuote) {
        // Start a new quote
        quoteAttribution = line;
        inQuote = true;
        depth = 1;
        continue;
      }
    }

    // Check for quoted lines (starting with >)
    const quoteMatch = line.match(/^(>+)\s?(.*)/);
    if (quoteMatch) {
      if (!inQuote) {
        inQuote = true;
        depth = quoteMatch[1].length;
      }
      currentQuote.push(quoteMatch[2] || '');
      continue;
    }

    // Check for forwarded message markers
    if (line.includes('---------- Forwarded message ---------') ||
        line.includes('Begin forwarded message:')) {
      inQuote = true;
      quoteAttribution = line;
      depth = 1;
      continue;
    }

    if (inQuote) {
      // Continue adding to quote
      currentQuote.push(line);
    } else {
      // Add to main content
      mainLines.push(line);
    }

    // End quote on empty lines after quote content
    if (inQuote && line.trim() === '' && currentQuote.length > 0) {
      quotes.push({
        attribution: quoteAttribution,
        content: currentQuote.join('\n').trim(),
        depth
      });
      currentQuote = [];
      quoteAttribution = undefined;
      inQuote = false;
      depth = 0;
    }
  }

  // Handle remaining quote
  if (currentQuote.length > 0) {
    quotes.push({
      attribution: quoteAttribution,
      content: currentQuote.join('\n').trim(),
      depth
    });
  }

  return {
    mainContent: mainLines.join('\n').trim(),
    quotes
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

export function SimpleEmailRenderer({ message, className = '' }: SimpleEmailRendererProps) {
  const [expandedQuotes, setExpandedQuotes] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isHtml = !!(message.bodyHtml && message.bodyHtml.trim());
  const content = isHtml ? message.bodyHtml! : (message.body || '');

  // Parse email structure
  const { mainContent, quotes } = useMemo(
    () => parseEmailQuotes(content, isHtml),
    [content, isHtml]
  );

  // Get TTS content
  const ttsContent = useMemo(
    () => extractTTSContent(mainContent, isHtml),
    [mainContent, isHtml]
  );

  // Sanitize and process HTML content
  const processedContent = useMemo(() => {
    if (!isHtml) return mainContent;

    // Sanitize HTML
    let sanitized = DOMPurify.sanitize(mainContent, {
      ALLOWED_TAGS: [
        'a', 'b', 'blockquote', 'br', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td',
        'th', 'thead', 'tr', 'u', 'ul', 'font', 'center', 'hr', 'small', 'big', 'code'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'target', 'rel', 'width', 'height', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing'],
      ALLOW_DATA_ATTR: false
    });

    // Check if this is a rich HTML email (has substantial styling)
    const hasRichContent =
      sanitized.includes('<table') ||
      sanitized.includes('<img') ||
      sanitized.includes('style=') ||
      sanitized.includes('bgcolor=') ||
      sanitized.length > 1000;

    // For rich HTML, we need more aggressive dark mode transformation
    if (hasRichContent) {
      // Remove all background colors and replace with dark theme
      sanitized = sanitized.replace(/bgcolor=["']?[^"'\s>]+["']?/gi, '');
      sanitized = sanitized.replace(/background(-color)?:\s*[^;}"']+/gi, 'background: transparent');
      sanitized = sanitized.replace(/color:\s*(white|#fff(fff)?|rgb\(255,\s*255,\s*255\))/gi, 'color: #cbd5e1');
      sanitized = sanitized.replace(/color:\s*(black|#000(000)?|rgb\(0,\s*0,\s*0\))/gi, 'color: #cbd5e1');
    }

    // Force dark mode styles - inject CSS that overrides all colors
    const darkModeCSS = `
      <style>
        * {
          background-color: transparent !important;
          background-image: none !important;
          color: #cbd5e1 !important; /* slate-300 */
        }
        body, div, td, th, p, span {
          background: transparent !important;
          color: #cbd5e1 !important;
        }
        a {
          color: #60a5fa !important; /* blue-400 */
          text-decoration: underline !important;
        }
        a:hover {
          color: #93c5fd !important; /* blue-300 */
        }
        img {
          max-width: 100% !important;
          height: auto !important;
          opacity: 0.9;
          border-radius: 4px;
        }
        table {
          border-color: #475569 !important; /* slate-600 */
          background: transparent !important;
        }
        td, th {
          border-color: #475569 !important;
          background: transparent !important;
          color: #cbd5e1 !important;
        }
        blockquote {
          border-left: 3px solid #475569 !important;
          color: #94a3b8 !important; /* slate-400 */
          background: transparent !important;
          margin-left: 0 !important;
          padding-left: 1em !important;
        }
        pre, code {
          background: #1e293b !important;
          color: #cbd5e1 !important;
        }
        hr {
          border-color: #475569 !important;
        }
        /* Override any font colors */
        font[color] {
          color: #cbd5e1 !important;
        }
      </style>
    `;

    return darkModeCSS + sanitized;
  }, [mainContent, isHtml]);

  // Toggle quote expansion
  const toggleQuote = useCallback((index: number) => {
    setExpandedQuotes(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Copy content to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ttsContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [ttsContent]);

  // For rich HTML emails, use iframe for complete isolation
  const shouldUseIframe = isHtml && (
    content.includes('<table') ||
    content.includes('<img') ||
    content.includes('style=') ||
    content.includes('bgcolor=') ||
    content.length > 1000
  );

  // Auto-resize iframe to content
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

      // Resize on load and after a delay for images
      iframe.onload = () => {
        resizeIframe();
        setTimeout(resizeIframe, 500);
        setTimeout(resizeIframe, 1000);
      };
    }
  }, [shouldUseIframe, processedContent]);

  return (
    <div className={`simple-email-renderer ${className}`}>
      {/* Main Content */}
      <div className="email-main-content">
        {shouldUseIframe ? (
          // Use iframe for complete isolation of rich HTML emails
          <iframe
            ref={iframeRef}
            srcDoc={`
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <style>
                    html, body {
                      margin: 0;
                      padding: 0;
                      background: #0f172a !important;
                      overflow-x: hidden;
                    }
                    body {
                      padding: 16px;
                      color: #cbd5e1 !important;
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      font-size: 15px;
                      line-height: 1.6;
                    }
                    * {
                      background-color: transparent !important;
                      color: #cbd5e1 !important;
                    }
                    a {
                      color: #60a5fa !important;
                      text-decoration: underline !important;
                    }
                    img {
                      max-width: 100% !important;
                      height: auto !important;
                    }
                    table {
                      background: transparent !important;
                      border-color: #475569 !important;
                    }
                    td, th {
                      background: transparent !important;
                      border-color: #475569 !important;
                      color: #cbd5e1 !important;
                    }
                    ${processedContent.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''}
                  </style>
                </head>
                <body>
                  ${processedContent.replace(/<style>[\s\S]*?<\/style>/, '')}
                </body>
              </html>
            `}
            className="w-full border-0"
            style={{
              minHeight: '200px',
              background: '#0f172a',
              colorScheme: 'dark'
            }}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            title="Email content"
          />
        ) : isHtml ? (
          <div
            className="email-html-content"
            dangerouslySetInnerHTML={{ __html: processedContent }}
          />
        ) : (
          <div className="email-text-content whitespace-pre-wrap text-slate-300">
            {mainContent}
          </div>
        )}
      </div>

      {/* Quoted Sections - Collapsed by default */}
      {quotes.length > 0 && (
        <div className="email-quotes mt-4 space-y-2">
          {quotes.map((quote, index) => {
            const isExpanded = expandedQuotes.has(index);
            return (
              <div
                key={index}
                className="quote-section"
                style={{ marginLeft: `${Math.min(quote.depth - 1, 3) * 12}px` }}
              >
                <button
                  onClick={() => toggleQuote(index)}
                  className="quote-toggle group flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800/50 transition-colors"
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-slate-500 transition-transform ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="text-slate-500 text-sm">•••</span>
                  {quote.attribution && (
                    <span className="text-slate-600 text-xs truncate max-w-[300px]">
                      {quote.attribution}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 pl-5 border-l-2 border-slate-700 text-slate-400 text-sm whitespace-pre-wrap">
                        {quote.content}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Action Bar */}
      <div className="email-actions mt-4 pt-3 border-t border-slate-800 flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-slate-800/50 transition-colors text-slate-500"
          title="Copy message"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <TTSController
          content={ttsContent}
          id={`email-${message.id}`}
          compact={true}
        />
      </div>

      <style jsx>{`
        .simple-email-renderer {
          background: transparent;
          color: #cbd5e1; /* slate-300 */
          font-size: 15px;
          line-height: 1.6;
        }

        .email-html-content {
          word-wrap: break-word;
          overflow-wrap: break-word;
        }

        .email-html-content :global(img) {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
        }

        .email-html-content :global(a) {
          color: #60a5fa;
          text-decoration: underline;
        }

        .email-html-content :global(a:hover) {
          color: #93c5fd;
        }

        .email-html-content :global(blockquote) {
          margin: 1em 0;
          padding-left: 1em;
          border-left: 3px solid #475569;
          color: #94a3b8;
        }

        .email-html-content :global(pre) {
          background: #1e293b;
          padding: 0.75rem;
          border-radius: 4px;
          overflow-x: auto;
        }

        .email-html-content :global(code) {
          background: #1e293b;
          padding: 0.125rem 0.25rem;
          border-radius: 3px;
          font-size: 0.9em;
        }

        .email-html-content :global(table) {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
        }

        .email-html-content :global(th),
        .email-html-content :global(td) {
          border: 1px solid #475569;
          padding: 0.5rem;
          text-align: left;
        }

        .email-html-content :global(th) {
          background: #1e293b;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}