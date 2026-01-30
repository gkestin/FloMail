'use client';

/**
 * EmailRenderer Component
 *
 * Professional-grade email rendering system with dark mode,
 * responsive design, and intelligent content handling
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Eye, EyeOff, Maximize2, Minimize2, AlertTriangle } from 'lucide-react';
import DOMPurify from 'dompurify';

import { EmailMessage } from '@/types';
import {
  EmailRendererConfig,
  EmailRenderMode,
  ParsedEmailStructure,
  QuotedSection,
  DarkModeSettings,
  ResponsiveSettings,
} from '@/lib/email-renderer/types';
import { analyzeEmail, needsIframeIsolation } from '@/lib/email-renderer/analyzer';
import { transformForDarkMode, getDarkModeFilter } from '@/lib/email-renderer/dark-mode';
import { getResponsiveStyles, makeHtmlResponsive, calculateOptimalFontSize } from '@/lib/email-renderer/responsive';
import { parseQuotedContent } from '@/lib/email-renderer/quote-parser';
import { TTSController } from './TTSController';

interface EmailRendererProps {
  message: EmailMessage;
  config?: Partial<EmailRendererConfig>;
  onNextEmail?: () => void;
  onPreviousEmail?: () => void;
  className?: string;
}

// Default configuration
const DEFAULT_CONFIG: EmailRendererConfig = {
  darkMode: {
    enabled: true,
    strategy: 'adaptive',
    brightness: 0,
    contrast: 10,
  },
  responsive: {
    baseFontSize: 16,
    lineHeight: 1.625,
    maxWidth: '800px',
    fluidTypography: true,
    breakpoints: {
      mobile: 480,
      tablet: 768,
      desktop: 1024,
    },
  },
  security: {
    removeTracking: true,
    blockExternalResources: false,
    strictSanitization: true,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  },
  display: {
    collapseQuotes: true,
    showMetadata: false,
    animations: true,
    direction: 'auto',
  },
};

export function EmailRenderer({
  message,
  config: userConfig,
  onNextEmail,
  onPreviousEmail,
  className = '',
}: EmailRendererProps) {
  // Merge configuration
  const config = useMemo(() => ({
    ...DEFAULT_CONFIG,
    ...userConfig,
    darkMode: { ...DEFAULT_CONFIG.darkMode, ...userConfig?.darkMode },
    responsive: { ...DEFAULT_CONFIG.responsive, ...userConfig?.responsive },
    security: { ...DEFAULT_CONFIG.security, ...userConfig?.security },
    display: { ...DEFAULT_CONFIG.display, ...userConfig?.display },
  }), [userConfig]);

  // State
  const [expandedQuotes, setExpandedQuotes] = useState<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [renderMode, setRenderMode] = useState<EmailRenderMode>(EmailRenderMode.PLAIN_TEXT);
  const [showOriginal, setShowOriginal] = useState(false);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Analyze email content
  const analysis = useMemo(() => {
    const html = message.bodyHtml || '';
    const text = message.body || '';
    return analyzeEmail(html, text);
  }, [message]);

  // Parse email structure
  const structure = useMemo(() => {
    const html = message.bodyHtml || '';
    const text = message.body || '';
    const isHtml = !!html && html.trim().length > 0;
    return parseQuotedContent(isHtml ? html : text, isHtml);
  }, [message]);

  // Determine render mode
  useEffect(() => {
    setRenderMode(analysis.recommendedMode);
  }, [analysis]);

  // Sanitize and transform content
  const processedContent = useMemo(() => {
    const content = message.bodyHtml || message.body || '';
    const isHtml = !!message.bodyHtml;

    // Sanitize
    const sanitized = DOMPurify.sanitize(content, {
      ALLOWED_TAGS: [
        'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote',
        'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del',
        'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins',
        'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp',
        'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
        'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
        'style',
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class', 'id', 'style', 'width', 'height',
        'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'align',
        'valign', 'bgcolor', 'color', 'target', 'rel', 'dir',
      ],
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    });

    // Apply transformations
    let processed = sanitized;

    if (isHtml) {
      // Make responsive
      processed = makeHtmlResponsive(processed);

      // Apply dark mode if enabled
      if (config.darkMode.enabled) {
        processed = transformForDarkMode(processed, config.darkMode);
      }
    }

    return processed;
  }, [message, config]);

  // Toggle quote expansion
  const toggleQuote = useCallback((quoteId: string) => {
    setExpandedQuotes((prev) => {
      const next = new Set(prev);
      if (next.has(quoteId)) {
        next.delete(quoteId);
      } else {
        next.add(quoteId);
      }
      return next;
    });
  }, []);

  // Render quoted section
  const renderQuotedSection = useCallback((quote: QuotedSection) => {
    const isExpanded = expandedQuotes.has(quote.id);

    return (
      <div key={quote.id} className="quoted-section" style={{ marginLeft: `${quote.depth * 12}px` }}>
        <button
          onClick={() => toggleQuote(quote.id)}
          className="quote-toggle flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm hover:bg-white/10 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          <span className="tracking-wider">•••</span>
          {quote.attribution && (
            <span className="text-xs opacity-70">{quote.attribution.slice(0, 50)}...</span>
          )}
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="quoted-content mt-2 pl-4 border-l-2 border-slate-600/50"
              style={{ color: 'var(--text-secondary)' }}
            >
              <div className="text-sm opacity-80 whitespace-pre-wrap">
                {quote.content}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }, [expandedQuotes, toggleQuote]);

  // Render content based on mode
  const renderContent = useCallback(() => {
    const needsIframe = needsIframeIsolation(analysis);

    if (needsIframe) {
      // Iframe isolation for complex/untrusted content
      return (
        <iframe
          ref={iframeRef}
          srcDoc={`
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                  ${getResponsiveStyles(config.responsive)}
                  body {
                    margin: 0;
                    padding: 0;
                    background: ${config.darkMode.enabled ? '#0f172a' : '#ffffff'};
                    color: ${config.darkMode.enabled ? '#e2e8f0' : '#1e293b'};
                  }
                </style>
              </head>
              <body>
                ${processedContent}
              </body>
            </html>
          `}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="email-iframe w-full border-0"
          style={{ minHeight: '400px', height: 'auto' }}
          title="Email content"
        />
      );
    }

    // Shadow DOM isolation for moderate content
    return (
      <div
        ref={(el) => {
          if (el && !shadowRootRef.current) {
            shadowRootRef.current = el.attachShadow({ mode: 'open' });
            const style = document.createElement('style');
            style.textContent = `
              ${getResponsiveStyles(config.responsive)}
              :host {
                display: block;
                background: ${config.darkMode.enabled ? '#0f172a' : '#ffffff'};
                color: ${config.darkMode.enabled ? '#e2e8f0' : '#1e293b'};
              }
            `;
            shadowRootRef.current.appendChild(style);
          }
          if (shadowRootRef.current) {
            const contentDiv = shadowRootRef.current.querySelector('.email-content-root') ||
                              document.createElement('div');
            contentDiv.className = 'email-content-root';
            contentDiv.innerHTML = processedContent;
            if (!contentDiv.parentNode) {
              shadowRootRef.current.appendChild(contentDiv);
            }
          }
        }}
        className="email-shadow-root"
      />
    );
  }, [analysis, processedContent, config]);

  return (
    <div
      ref={containerRef}
      className={`email-renderer ${className} ${isFullscreen ? 'fullscreen' : ''}`}
      data-render-mode={renderMode}
    >
      {/* Controls Bar */}
      <div className="email-controls flex items-center justify-between px-4 py-2 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          {/* TTS Button */}
          <TTSController
            content={structure.ttsContent}
            id={`email-${message.id}`}
            compact={true}
          />

          {/* View Original Toggle */}
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title={showOriginal ? 'View formatted' : 'View original'}
          >
            {showOriginal ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Render Mode Indicator */}
        <div className="flex items-center gap-2">
          {analysis.hasSuspiciousContent && (
            <span title="Content may be suspicious">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
            </span>
          )}
          <span className="text-xs opacity-60">
            {renderMode.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Email Content */}
      <div className="email-body">
        {showOriginal ? (
          // Show original plain text
          <pre className="p-4 text-sm font-mono whitespace-pre-wrap opacity-80">
            {message.body || message.bodyHtml}
          </pre>
        ) : (
          <>
            {/* Main Content */}
            <div className="email-main-content">
              {renderContent()}
            </div>

            {/* Quoted Sections */}
            {structure.quotedSections.length > 0 && (
              <div className="email-quotes mt-4 pt-4 border-t border-slate-700/50">
                {structure.quotedSections.map(renderQuotedSection)}
              </div>
            )}

            {/* Signature */}
            {structure.signature && (
              <div className="email-signature mt-4 pt-4 border-t border-slate-700/50 opacity-60 text-sm">
                {structure.signature}
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .email-renderer {
          position: relative;
          width: 100%;
          background: var(--bg-primary, #0f172a);
          color: var(--text-primary, #e2e8f0);
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .email-renderer.fullscreen {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 9999;
          border-radius: 0;
        }

        .email-body {
          padding: 1rem;
          max-width: 100%;
          overflow-x: auto;
        }

        @media (min-width: 640px) {
          .email-body {
            padding: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
}