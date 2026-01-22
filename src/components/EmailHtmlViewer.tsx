'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify';

interface EmailHtmlViewerProps {
  html: string;
  plainText?: string;
  className?: string;
  maxHeight?: number;
  /** Navigate to next thread (swipe left) */
  onNextEmail?: () => void;
  /** Navigate to previous thread (swipe right) */
  onPreviousEmail?: () => void;
}

/**
 * Normalize plain text for display:
 * - Convert CRLF to LF
 * - Treat whitespace-only lines as empty
 * - Strip trailing whitespace per line
 * - Collapse excessive blank lines (3+ newlines -> 2 newlines)
 *
 * This fixes common artifacts like "\n \n\n" (blank line with a single space).
 */
export function normalizeEmailPlainText(text: string): string {
  if (!text) return '';
  let t = text;
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\u00a0/g, ' '); // nbsp -> space

  const lines = t.split('\n').map((line) => {
    // Keep leading whitespace (indentation), but strip trailing whitespace
    const withoutTrailing = line.replace(/[ \t]+$/g, '');
    // If line is only whitespace, treat as blank
    return withoutTrailing.trim().length === 0 ? '' : withoutTrailing;
  });

  t = lines.join('\n');
  // Collapse excessive blank lines to a single blank line
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * EmailHtmlViewer - A secure HTML email viewer component
 * 
 * Displays HTML emails exactly as they were designed, with a white background
 * like Gmail. Does NOT modify colors or inject dark mode styles.
 * 
 * Security features:
 * - DOMPurify sanitization (removes XSS vectors)
 * - Sandboxed iframe (no scripts, no forms)
 * - Links open in new tab
 */
export function EmailHtmlViewer({
  html,
  plainText,
  className = '',
  maxHeight = 600,
  onNextEmail,
  onPreviousEmail,
}: EmailHtmlViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(150);
  const [isLoading, setIsLoading] = useState(true);
  const heightCheckRef = useRef<NodeJS.Timeout | null>(null);
  const fitScaleRef = useRef(1);
  
  // Refs for swipe navigation
  const onNextEmailRef = useRef(onNextEmail);
  const onPreviousEmailRef = useRef(onPreviousEmail);
  useEffect(() => { onNextEmailRef.current = onNextEmail; }, [onNextEmail]);
  useEffect(() => { onPreviousEmailRef.current = onPreviousEmail; }, [onPreviousEmail]);

  // Sanitize HTML with DOMPurify - DO NOT modify colors
  const sanitizedHtml = useMemo(() => {
    if (!html || html.trim().length === 0) {
      return null;
    }

    // First, strip CID images since we can't display them (prevents console errors)
    const htmlWithoutCidImages = stripCidImages(html);

    // Configure DOMPurify for email content
    const config = {
      ALLOWED_TAGS: [
        'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote',
        'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del',
        'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins',
        'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'samp',
        'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
        'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
        'style', 'center', 'font',
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class', 'id', 'style', 'width', 'height',
        'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'align',
        'valign', 'bgcolor', 'color', 'face', 'size', 'target', 'rel',
      ],
      ALLOW_DATA_ATTR: true,
      ADD_ATTR: ['target'],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|data|cid):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    };

    // Just sanitize - DO NOT modify colors or styles
    return DOMPurify.sanitize(htmlWithoutCidImages, config);
  }, [html]);

  // Check if the email has explicit background colors that require white background
  const needsWhiteBackground = useMemo(() => {
    if (!html) return false;
    
    // Check for explicit background colors in the email
    const hasBgColor = /bgcolor\s*=\s*["']?(?!white|#fff|transparent)/i.test(html);
    const hasInlineBg = /background(-color)?\s*:\s*(?!transparent|inherit|none|white|#fff)/i.test(html);
    const hasImages = /https?:\/\/[^"'\s]+\.(jpg|jpeg|png|gif|webp)/i.test(html);
    const hasDataImages = /data:image\//i.test(html);
    
    // If email has explicit backgrounds or images, use white background
    return hasBgColor || hasInlineBg || hasImages || hasDataImages;
  }, [html]);

  // Build the full HTML document for the iframe
  // Use dark background for simple formatted emails, white for rich emails with colors/images
  const iframeContent = useMemo(() => {
    if (!sanitizedHtml) {
      return null;
    }

    const bgColor = needsWhiteBackground ? '#ffffff' : '#1e1e1e';
    const textColor = needsWhiteBackground ? '#222222' : '#e0e0e0';
    const linkColor = needsWhiteBackground ? '#1a73e8' : '#60a5fa';

    // For dark theme, we need to override inline dark text colors
    const darkThemeOverrides = needsWhiteBackground ? '' : `
    /* Override dark text colors for dark background */
    body, body * {
      color: ${textColor} !important;
    }
    a, a * {
      color: ${linkColor} !important;
    }
    /* Preserve some semantic colors */
    b, strong { font-weight: bold; }
    `;

    // Script to forward scroll/swipe events to parent
    // Iframe has overflow:hidden so it doesn't scroll - we forward events to parent
    const swipeScript = `
    <script>
      (function() {
        var touchStartX = 0, touchStartY = 0, hasActed = false;
        var wheelAccumX = 0, wheelTimeout = null;
        
        document.addEventListener('touchstart', function(e) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          hasActed = false;
        }, { passive: true });
        
        document.addEventListener('touchmove', function(e) {
          if (hasActed) return;
          var dx = e.touches[0].clientX - touchStartX;
          var dy = e.touches[0].clientY - touchStartY;
          
          // Horizontal swipe (prev/next thread)
          if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 80) {
            hasActed = true;
            parent.postMessage({ type: dx < 0 ? 'flomail-swipe-left' : 'flomail-swipe-right' }, '*');
          }
          // Forward vertical touch to parent for expand/collapse
          else if (Math.abs(dy) > 30) {
            parent.postMessage({ type: 'flomail-vertical-scroll', deltaY: -dy }, '*');
          }
        }, { passive: true });
        
        document.addEventListener('wheel', function(e) {
          // Horizontal scroll (prev/next thread)
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
            wheelAccumX += e.deltaX;
            if (Math.abs(wheelAccumX) > 100) {
              parent.postMessage({ type: wheelAccumX > 0 ? 'flomail-swipe-left' : 'flomail-swipe-right' }, '*');
              wheelAccumX = 0;
            }
            clearTimeout(wheelTimeout);
            wheelTimeout = setTimeout(function() { wheelAccumX = 0; }, 150);
          } else {
            // Forward vertical scroll to parent for expand/collapse
            parent.postMessage({ type: 'flomail-vertical-scroll', deltaY: e.deltaY }, '*');
          }
        }, { passive: true });
      })();
    </script>`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base target="_blank">
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 8px;
      background: ${bgColor} !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: ${textColor};
      word-wrap: break-word;
    }
    html, body { overflow: hidden; } /* No internal scrolling - parent container handles scroll */
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; max-width: 100%; }
    a { 
      color: ${linkColor}; 
      cursor: pointer;
      touch-action: manipulation; /* Removes 300ms tap delay */
      -webkit-tap-highlight-color: rgba(96, 165, 250, 0.3);
      text-decoration: underline;
    }
    a:active {
      opacity: 0.7;
    }
    /* Hide tracking pixels */
    img[width="1"], img[height="1"] { display: none !important; }
    /* Root wrapper allows fit-to-width scaling when content is wider than viewport */
    #flomail-email-root {
      display: inline-block;
      min-width: 100%;
      transform-origin: top left;
    }
    ${darkThemeOverrides}
  </style>
</head>
<body><div id="flomail-email-root">${sanitizedHtml}</div>${swipeScript}</body>
</html>`;
  }, [sanitizedHtml, needsWhiteBackground]);

  // Measure height from parent by accessing iframe document
  // NOTE: We do NOT clamp to maxHeight - the outer container handles scrolling
  const measureHeight = useCallback(() => {
    if (!iframeRef.current) return;
    
    try {
      const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (!iframeDoc || !iframeDoc.body) return;

      const root = iframeDoc.getElementById('flomail-email-root') as HTMLElement | null;
      const docEl = iframeDoc.documentElement;

      // ===== Fit-to-width for mobile/non-responsive emails =====
      // If content is wider than the viewport, scale it down to fit.
      if (root && docEl) {
        const viewportWidth = docEl.clientWidth;
        const contentWidth = root.scrollWidth;
        const nextScale = contentWidth > viewportWidth + 4 ? Math.min(1, viewportWidth / contentWidth) : 1;

        // Update transform only if meaningfully changed to avoid thrash
        if (Math.abs(nextScale - fitScaleRef.current) > 0.01) {
          fitScaleRef.current = nextScale;
          if (nextScale < 0.999) {
            root.style.transform = `scale(${nextScale})`;
          } else {
            root.style.transform = '';
          }
        }
      }

      // Measure visible height (accounts for scaling via getBoundingClientRect)
      const height = root
        ? Math.ceil(root.getBoundingClientRect().height)
        : Math.max(
            iframeDoc.body.scrollHeight,
            iframeDoc.body.offsetHeight,
            docEl?.scrollHeight || 0,
            docEl?.offsetHeight || 0
          );

      if (height > 0) {
        // Don't clamp - let the iframe be full height, outer container handles scroll
        setIframeHeight(height + 16);
        setIsLoading(false);
      }
    } catch {
      setIframeHeight(300);
      setIsLoading(false);
    }
  }, []);

  // Write content to iframe and measure height
  useEffect(() => {
    if (!iframeRef.current || !iframeContent) return;
    
    const iframe = iframeRef.current;
    
    if (heightCheckRef.current) {
      clearInterval(heightCheckRef.current);
    }
    
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(iframeContent);
        doc.close();
        
        // Measure immediately
        measureHeight();
        
        // Check height a few times as images load
        let checks = 0;
        heightCheckRef.current = setInterval(() => {
          measureHeight();
          checks++;
          if (checks >= 5) {
            if (heightCheckRef.current) {
              clearInterval(heightCheckRef.current);
            }
          }
        }, 300);
      }
    } catch (e) {
      console.error('Error writing to iframe:', e);
      setIsLoading(false);
    }
    
    return () => {
      if (heightCheckRef.current) {
        clearInterval(heightCheckRef.current);
      }
    };
  }, [iframeContent, measureHeight]);

  // Re-measure on window resize (helps fit-to-width on rotation / viewport changes)
  useEffect(() => {
    const onResize = () => measureHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureHeight]);

  // Listen for scroll/swipe messages from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const type = e.data?.type;
      if (type === 'flomail-swipe-left') {
        onNextEmailRef.current?.();
      } else if (type === 'flomail-swipe-right') {
        onPreviousEmailRef.current?.();
      } else if (type === 'flomail-vertical-scroll') {
        // Forward vertical scroll to parent container by dispatching a synthetic wheel event
        // This allows ThreadPreview's wheel handler to process it for expand/collapse
        const deltaY = e.data.deltaY || 0;
        if (iframeRef.current) {
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

  // Fallback to plain text
  if (!sanitizedHtml) {
    if (plainText) {
      return (
        <div 
          className={`whitespace-pre-wrap text-sm leading-relaxed ${className}`}
          style={{ color: 'var(--text-primary)' }}
        >
          {normalizeEmailPlainText(plainText)}
        </div>
      );
    }
    return (
      <div className={`text-sm ${className}`} style={{ color: 'var(--text-muted)' }}>
        (No content to display)
      </div>
    );
  }

  return (
    <div className={`relative rounded overflow-hidden ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50 rounded">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="Email Content"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation"
        style={{
          width: '100%',
          height: `${iframeHeight}px`,
          border: 'none',
          borderRadius: '4px',
          background: '#ffffff',
          opacity: isLoading ? 0 : 1,
          transition: 'opacity 0.15s ease-in-out',
        }}
      />
    </div>
  );
}

/**
 * Helper function to check if content is HTML (any HTML tags)
 */
export function isHtmlContent(content: string): boolean {
  if (!content) return false;
  const htmlPattern = /<(?:html|head|body|div|p|table|span|a|img|br|hr)[^>]*>/i;
  return htmlPattern.test(content);
}

/**
 * Remove CID (Content-ID) image references that can't be displayed
 * These are embedded images like signatures that reference attachments
 */
export function stripCidImages(html: string): string {
  if (!html) return html;
  // Remove img tags with cid: src
  return html.replace(/<img[^>]*src=["']cid:[^"']*["'][^>]*\/?>/gi, '');
}

/**
 * Check if content has loadable images (not just cid: references)
 */
function hasLoadableImages(content: string): boolean {
  // Find all img tags
  const imgTags = content.match(/<img[^>]*>/gi) || [];
  
  for (const img of imgTags) {
    // Check if src is NOT a cid: reference
    const srcMatch = img.match(/src=["']([^"']+)["']/i);
    if (srcMatch && !srcMatch[1].startsWith('cid:')) {
      return true; // Has a loadable image (http, https, data:, etc.)
    }
  }
  
  return false;
}

/**
 * Check if content has "real" data tables with VISIBLE borders
 * Not layout tables used for formatting (common in HTML emails)
 * 
 * We're VERY conservative here - only return true if there's definitely a visible table
 */
function hasRealTables(content: string): boolean {
  // Find all table tags
  const tableTags = content.match(/<table[^>]*>/gi) || [];
  
  for (const tableTag of tableTags) {
    // Only flag as "real" table if it has an EXPLICIT border > 0
    const borderMatch = tableTag.match(/border\s*=\s*["']?(\d+)["']?/i);
    if (borderMatch && parseInt(borderMatch[1]) > 0) {
      return true;
    }
    
    // Check for visible border in inline CSS
    // BUT ignore layout properties: border-collapse, border-spacing
    const styleMatch = tableTag.match(/style\s*=\s*["']([^"']+)["']/i);
    if (styleMatch) {
      const styleContent = styleMatch[1];
      // Look for actual border definitions (border:, border-width:, border-style:, border-color:)
      // Exclude border-collapse and border-spacing which are layout properties
      const hasBorderStyle = /(?:^|;)\s*border(?:-(?:width|style|color|top|bottom|left|right))?:/i.test(styleContent);
      const isOnlyLayoutBorder = /border-(?:collapse|spacing)/i.test(styleContent) && 
                                  !/(?:^|;)\s*border(?:-(?:width|style|color|top|bottom|left|right))?:/i.test(styleContent);
      
      if (hasBorderStyle && !isOnlyLayoutBorder) {
        // Check if the border value is actually visible (not 0 or none)
        const borderValue = styleContent.match(/(?:^|;)\s*border(?:-(?:width|style|color|top|bottom|left|right))?:\s*([^;]+)/i);
        if (borderValue) {
          const value = borderValue[1].toLowerCase();
          // Skip if it's explicitly 0, none, or hidden
          if (!/^(0|none|hidden|0px)/.test(value.trim())) {
            return true;
          }
        }
      }
    }
  }
  
  // All other tables (no border, border=0, Outlook tables) are layout tables
  return false;
}

/**
 * Check if content requires iframe rendering (has its own visual styling)
 * vs can be displayed with app's dark theme
 * 
 * STRATEGY: Only use iframe if the email EXPLICITLY sets visual styling.
 * Default to dark theme for everything else (the safer, cleaner approach).
 * 
 * We check for:
 * 1. Explicit background colors (not white - white is the default we'd use anyway)
 * 2. Loadable images (http/https/data: - need proper rendering context)
 * 3. Real tables with visible borders (actual data tables, not layout)
 * 4. Complex CSS in style tags (newsletters, marketing emails)
 * 
 * Everything else (divs, spans, basic formatting) → dark theme plain text
 */
export function isRichHtmlContent(content: string): boolean {
  if (!content) return false;
  
  // Strip CID images first (can't display them, they just cause errors)
  const cleaned = stripCidImages(content);
  
  // === CHECK 1: Does it have loadable images? ===
  // Images need the iframe context to render properly
  if (hasLoadableImages(cleaned)) {
    return true;
  }
  
  // === CHECK 2: Does it have explicit background colors? ===
  // Any bgcolor attribute (except white/transparent/inherit)
  const bgcolorMatch = cleaned.match(/bgcolor\s*=\s*["']?([^"'\s>]+)/gi);
  if (bgcolorMatch) {
    for (const match of bgcolorMatch) {
      const colorValue = match.replace(/bgcolor\s*=\s*["']?/i, '').replace(/["']$/, '').toLowerCase();
      if (!isDefaultColor(colorValue)) {
        return true;
      }
    }
  }
  
  // Any background or background-color in inline styles
  const inlineStyleBgMatches = cleaned.match(/style\s*=\s*["'][^"']*background(-color)?\s*:\s*([^;"']+)/gi);
  if (inlineStyleBgMatches) {
    for (const match of inlineStyleBgMatches) {
      const colorMatch = match.match(/background(-color)?\s*:\s*([^;"']+)/i);
      if (colorMatch) {
        const colorValue = colorMatch[2].toLowerCase().trim();
        if (!isDefaultColor(colorValue)) {
          return true;
        }
      }
    }
  }
  
  // === CHECK 3: Does CSS define problematic colors? ===
  // Only care about BACKGROUND colors in CSS - text colors are fine on dark theme
  // (link colors like blue/purple work great on dark backgrounds)
  const styleBlocks = cleaned.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (styleBlocks) {
    for (const block of styleBlocks) {
      const cssContent = block.replace(/<\/?style[^>]*>/gi, '');
      
      // Only look for BACKGROUND color definitions - these would clash with dark theme
      // Text colors (including link colors) are fine - they'll be visible on dark
      const bgColorMatches = cssContent.match(/(?:^|[;\s{])background(?:-color)?\s*:\s*([^;}\s]+)/gi);
      if (bgColorMatches) {
        for (const match of bgColorMatches) {
          const colorValue = match.replace(/.*:\s*/i, '').trim().toLowerCase();
          // Skip if it's a default background color
          if (!isDefaultColor(colorValue)) {
            return true;
          }
        }
      }
    }
  }
  
  // === CHECK 4: Real tables with visible structure? ===
  // Only data tables with actual borders, not Outlook layout wrappers
  if (hasRealTables(cleaned)) {
    return true;
  }
  
  // === CHECK 5: Semantic formatting that can't be rendered as plain text ===
  // Lists, bold, italic, headings - these need HTML rendering to look right
  const hasLists = /<(ul|ol)\b/i.test(cleaned) && /<li\b/i.test(cleaned);
  if (hasLists) {
    return true;
  }
  
  // Headings indicate structured content
  const hasHeadings = /<h[1-6]\b/i.test(cleaned);
  if (hasHeadings) {
    return true;
  }
  
  // === Everything else: render as dark theme plain text ===
  // This includes: divs, spans, p tags, br tags, font tags with just black text,
  // Outlook layout tables (border=0), basic bold/italic (can work in dark theme)
  return false;
}

/**
 * Check if a color value is a "default" that doesn't require special rendering
 * (white, transparent, inherit, or no color)
 */
function isDefaultColor(color: string): boolean {
  if (!color) return true;
  const c = color.toLowerCase().trim();
  
  // White variants
  if (c === 'white' || c === '#fff' || c === '#ffffff') return true;
  if (c === 'rgb(255,255,255)' || c === 'rgb(255, 255, 255)') return true;
  if (c === 'rgba(255,255,255,1)' || c === 'rgba(255, 255, 255, 1)') return true;
  
  // Transparent/inherit (not setting a color)
  if (c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'unset') return true;
  
  // Sometimes emails specify "none" 
  if (c === 'none') return true;
  
  return false;
}

/**
 * Check if a text color is default/safe for dark theme rendering
 * (black, dark gray, inherit - colors that would be readable on white)
 */
function isDefaultTextColor(color: string): boolean {
  if (!color) return true;
  const c = color.toLowerCase().trim();
  
  // Black variants (default text color)
  if (c === 'black' || c === '#000' || c === '#000000') return true;
  if (c === 'rgb(0,0,0)' || c === 'rgb(0, 0, 0)') return true;
  
  // Common dark grays used for text
  if (c.startsWith('#1') || c.startsWith('#2') || c.startsWith('#3')) return true;
  if (c.startsWith('rgb(') && /rgb\(\s*(\d+)/.test(c)) {
    const match = c.match(/rgb\(\s*(\d+)/);
    if (match && parseInt(match[1]) < 80) return true; // Very dark colors
  }
  
  // windowtext is Outlook's way of saying "use default text color"
  if (c === 'windowtext') return true;
  
  // Inherit/initial means use parent's color
  if (c === 'inherit' || c === 'initial' || c === 'unset' || c === 'currentcolor') return true;
  
  return false;
}

/**
 * Helper function to convert plain text to basic HTML
 */
export function plainTextToHtml(text: string): string {
  if (!text) return '';
  
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  
  html = html.replace(
    /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  
  html = html.replace(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
    '<a href="mailto:$1">$1</a>'
  );
  
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

/**
 * Strip basic HTML tags and convert to clean text for display
 * Preserves line breaks and decodes HTML entities
 */
export function stripBasicHtml(html: string): string {
  if (!html) return '';
  
  // First strip CID images
  let text = stripCidImages(html);
  
  // Convert <br> to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  
  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
  text = text.replace(/<(p|div|li|h[1-6])[^>]*>/gi, '');
  
  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&apos;/gi, "'");
  text = text.replace(/&#(\d+);/gi, (_, num) => String.fromCharCode(parseInt(num, 10)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  return normalizeEmailPlainText(text);
}
