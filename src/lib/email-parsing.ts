/**
 * Email Parsing Utilities
 * 
 * Inspired by Zero's email-utils.ts but adapted for FloMail.
 * Provides RFC-compliant email address parsing and common utilities.
 * 
 * MIT License compatible utilities for email handling.
 */

import { ParsedSender, ListUnsubscribeAction } from './mail-driver/types';

// ============================================================================
// EMAIL ADDRESS PARSING
// ============================================================================

/**
 * Parse a From header into name and email components.
 * Handles various formats:
 * - "John Doe <john@example.com>"
 * - "john@example.com"
 * - "<john@example.com>"
 * - "\"John Doe\" <john@example.com>"
 */
export function parseFrom(fromHeader: string | undefined | null): ParsedSender {
  if (!fromHeader) {
    return { name: '', email: '' };
  }

  const trimmed = fromHeader.trim();
  
  // Format: "Name <email>" or "\"Name\" <email>"
  const angleMatch = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (angleMatch) {
    return {
      name: (angleMatch[1] || '').trim().replace(/^"(.*)"$/, '$1'),
      email: angleMatch[2].trim().toLowerCase()
    };
  }
  
  // Format: just an email address
  const emailMatch = trimmed.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/);
  if (emailMatch) {
    return {
      name: '',
      email: emailMatch[1].toLowerCase()
    };
  }
  
  // Fallback: try to extract anything that looks like an email
  const fallbackMatch = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (fallbackMatch) {
    const email = fallbackMatch[1].toLowerCase();
    // Use the part before the email as the name
    const namepart = trimmed.substring(0, trimmed.indexOf(fallbackMatch[1])).trim();
    return {
      name: namepart.replace(/[<>"]/g, '').trim(),
      email
    };
  }
  
  // Last resort: treat whole thing as name
  return { name: trimmed, email: '' };
}

/**
 * Parse a comma-separated list of addresses (To, Cc, Bcc headers).
 */
export function parseAddressList(header: string | undefined | null): ParsedSender[] {
  if (!header) {
    return [];
  }
  
  const results: ParsedSender[] = [];
  
  // Split by comma, but be careful of commas inside quoted strings
  const addresses = splitAddresses(header);
  
  for (const addr of addresses) {
    const parsed = parseFrom(addr.trim());
    if (parsed.email) {
      results.push(parsed);
    }
  }
  
  return results;
}

/**
 * Split address list, respecting quoted strings.
 */
function splitAddresses(header: string): string[] {
  const results: string[] = [];
  let current = '';
  let inQuote = false;
  let depth = 0;
  
  for (let i = 0; i < header.length; i++) {
    const char = header[i];
    
    if (char === '"' && header[i - 1] !== '\\') {
      inQuote = !inQuote;
    } else if (char === '<') {
      depth++;
    } else if (char === '>') {
      depth--;
    }
    
    if (char === ',' && !inQuote && depth === 0) {
      if (current.trim()) {
        results.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    results.push(current.trim());
  }
  
  return results;
}

/**
 * Clean and normalize email addresses.
 */
export function cleanEmailAddresses(emails: string | undefined): string[] {
  if (!emails) return [];
  
  return parseAddressList(emails)
    .map(a => a.email)
    .filter(Boolean);
}

/**
 * Format recipients for display (names or emails).
 */
export function formatRecipients(recipients: ParsedSender[] | string[] | undefined): string {
  if (!recipients || recipients.length === 0) return '';
  
  return recipients.map(r => {
    if (typeof r === 'string') {
      return r;
    }
    return r.name || r.email;
  }).join(', ');
}

/**
 * Format recipients for MIME headers.
 */
export function formatMimeRecipients(recipients: ParsedSender[] | string | string[]): string {
  if (typeof recipients === 'string') {
    return recipients;
  }
  
  const list = Array.isArray(recipients) ? recipients : [recipients];
  
  return list.map(r => {
    if (typeof r === 'string') {
      return r;
    }
    if (r.name) {
      // Quote name if it contains special characters
      const quotedName = /[,<>@"']/.test(r.name) 
        ? `"${r.name.replace(/"/g, '\\"')}"` 
        : r.name;
      return `${quotedName} <${r.email}>`;
    }
    return r.email;
  }).join(', ');
}

// ============================================================================
// TLS VERIFICATION
// ============================================================================

/**
 * Check if message was sent with TLS by analyzing Received headers.
 * Based on Zero's implementation.
 */
export function wasSentWithTLS(receivedHeaders: string[]): boolean {
  if (!receivedHeaders || receivedHeaders.length === 0) {
    return false;
  }
  
  // Look for TLS indicators in Received headers
  const tlsIndicators = [
    'TLS',
    'ESMTPS',
    'using TLSv',
    'with SMTPS',
    'SSL',
    'version=TLS'
  ];
  
  for (const header of receivedHeaders) {
    for (const indicator of tlsIndicators) {
      if (header.toUpperCase().includes(indicator)) {
        return true;
      }
    }
  }
  
  return false;
}

// ============================================================================
// LIST-UNSUBSCRIBE PARSING
// ============================================================================

/**
 * Parse List-Unsubscribe headers to determine the best unsubscribe action.
 * Prioritizes one-click (POST) > HTTP GET > mailto
 * 
 * Based on Zero's getListUnsubscribeAction implementation.
 */
export function getListUnsubscribeAction(options: {
  listUnsubscribe?: string | null;
  listUnsubscribePost?: string | null;
}): ListUnsubscribeAction | null {
  const { listUnsubscribe, listUnsubscribePost } = options;
  
  if (!listUnsubscribe) {
    return null;
  }
  
  // Parse the List-Unsubscribe header which may contain multiple URIs
  const uris = parseListUnsubscribeHeader(listUnsubscribe);
  
  const httpUrl = uris.find(u => u.startsWith('http://') || u.startsWith('https://'));
  const mailtoUrl = uris.find(u => u.startsWith('mailto:'));
  
  // RFC 8058: One-click unsubscribe via POST
  // List-Unsubscribe-Post: List-Unsubscribe=One-Click
  if (httpUrl && listUnsubscribePost) {
    try {
      const url = new URL(httpUrl);
      return {
        type: 'post',
        url: httpUrl,
        body: listUnsubscribePost,
        host: url.hostname
      };
    } catch {
      // Invalid URL, continue to fallback
    }
  }
  
  // Fallback to HTTP GET
  if (httpUrl) {
    try {
      const url = new URL(httpUrl);
      return {
        type: 'get',
        url: httpUrl,
        host: url.hostname
      };
    } catch {
      // Invalid URL, continue to fallback
    }
  }
  
  // Fallback to mailto
  if (mailtoUrl) {
    const parsed = parseMailtoUrl(mailtoUrl);
    if (parsed) {
      return {
        type: 'email',
        emailAddress: parsed.to,
        subject: parsed.subject || 'Unsubscribe',
        host: parsed.to.split('@')[1] || ''
      };
    }
  }
  
  return null;
}

/**
 * Parse List-Unsubscribe header into array of URIs.
 */
function parseListUnsubscribeHeader(header: string): string[] {
  const results: string[] = [];
  
  // Format: <uri1>, <uri2>
  const matches = header.match(/<([^>]+)>/g);
  if (matches) {
    for (const match of matches) {
      results.push(match.slice(1, -1).trim());
    }
  }
  
  return results;
}

/**
 * Parse mailto: URL.
 */
function parseMailtoUrl(url: string): { to: string; subject?: string } | null {
  if (!url.startsWith('mailto:')) {
    return null;
  }
  
  try {
    const withoutScheme = url.slice(7);
    const [address, params] = withoutScheme.split('?');
    
    const result: { to: string; subject?: string } = {
      to: decodeURIComponent(address)
    };
    
    if (params) {
      const searchParams = new URLSearchParams(params);
      const subject = searchParams.get('subject');
      if (subject) {
        result.subject = decodeURIComponent(subject);
      }
    }
    
    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// CONTENT UTILITIES
// ============================================================================

/**
 * Strip HTML tags and decode entities for plain text.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  
  return html
    // Remove script and style tags with content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Convert block elements to newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    // Remove all other tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Truncate text to a maximum length, respecting word boundaries.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}

/**
 * Extract a clean snippet from email content.
 */
export function extractSnippet(content: string, maxLength: number = 150): string {
  const plain = stripHtml(content);
  
  // Remove common email cruft
  const cleaned = plain
    .replace(/^On.*wrote:$/m, '')
    .replace(/^>+.*/gm, '')
    .replace(/^-{3,}.*$/m, '')
    .replace(/^_{3,}.*$/m, '')
    .trim();
  
  return truncateText(cleaned, maxLength);
}

// ============================================================================
// DATE UTILITIES
// ============================================================================

/**
 * Format a date for display in email list.
 */
export function formatEmailDate(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    // Today: show time
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    // This week: show day name
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else if (date.getFullYear() === now.getFullYear()) {
    // This year: show month and day
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    // Older: show full date
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  }
}

/**
 * Format a date for email headers.
 */
export function formatRFC2822Date(date: Date = new Date()): string {
  return date.toUTCString().replace('GMT', '+0000');
}

// ============================================================================
// ATTACHMENT UTILITIES
// ============================================================================

/**
 * Get file extension from filename.
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Get appropriate icon name for file type.
 */
export function getFileIcon(mimeType: string, filename?: string): string {
  const ext = filename ? getFileExtension(filename) : '';
  
  // Check MIME type first
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'spreadsheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
  if (mimeType.includes('document') || mimeType.includes('word')) return 'document';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'archive';
  
  // Fallback to extension
  const extMap: Record<string, string> = {
    pdf: 'pdf',
    doc: 'document', docx: 'document',
    xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet',
    ppt: 'presentation', pptx: 'presentation',
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
    mp4: 'video', mov: 'video', avi: 'video', mkv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio',
    zip: 'archive', rar: 'archive', tar: 'archive', gz: 'archive',
    txt: 'text', md: 'text',
    js: 'code', ts: 'code', py: 'code', html: 'code', css: 'code',
  };
  
  return extMap[ext] || 'file';
}

// ============================================================================
// COLOR CONTRAST UTILITIES
// ============================================================================

/**
 * Parse a color string (hex, rgb, rgba) to RGB values.
 */
function parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
  if (!color) return null;
  
  const trimmed = color.trim().toLowerCase();
  
  // Hex format
  const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255
      };
    }
  }
  
  // RGB/RGBA format
  const rgbMatch = trimmed.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
      a: rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1
    };
  }
  
  return null;
}

/**
 * Calculate relative luminance of a color (WCAG formula).
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c => 
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Check if a text color has sufficient contrast against a dark background.
 * Returns true if the color is too dark to be readable.
 */
export function isLowContrastOnDark(color: string, backgroundLuminance: number = 0.05): boolean {
  const parsed = parseColor(color);
  if (!parsed) return false;
  
  const textLuminance = getLuminance(parsed.r, parsed.g, parsed.b);
  
  // WCAG contrast ratio formula: (L1 + 0.05) / (L2 + 0.05)
  // For text on dark background, L1 is text luminance, L2 is background
  const contrastRatio = (textLuminance + 0.05) / (backgroundLuminance + 0.05);
  
  // WCAG AA requires 4.5:1 for normal text, 3:1 for large text
  // We use 3:1 as minimum for readability
  return contrastRatio < 3;
}

/**
 * Fix low-contrast colors in HTML for dark mode viewing.
 * Replaces text colors that are too dark with a readable light color.
 * 
 * Based on Zero's fixNonReadableColors implementation.
 */
export function fixLowContrastColors(html: string): string {
  if (!html) return html;
  
  // Pattern to find color styles
  const colorPattern = /color\s*:\s*([^;}"']+)/gi;
  
  return html.replace(colorPattern, (match, colorValue) => {
    const trimmedColor = colorValue.trim();
    
    // Skip if it's already a CSS variable
    if (trimmedColor.startsWith('var(')) {
      return match;
    }
    
    if (isLowContrastOnDark(trimmedColor)) {
      // Replace with a readable light color
      return 'color: #e4e4e4';
    }
    
    return match;
  });
}

/**
 * Clean and process HTML email content for dark mode display.
 * Combines sanitization with color fixing.
 */
export function processEmailHtml(html: string): string {
  if (!html) return '';
  
  // First fix low-contrast colors
  let processed = fixLowContrastColors(html);
  
  // Remove background colors that might conflict with dark mode
  // (but keep them if they're part of a styled block)
  processed = processed.replace(
    /background(-color)?\s*:\s*(white|#fff|#ffffff|rgb\(255\s*,\s*255\s*,\s*255\))/gi,
    'background$1: transparent'
  );
  
  return processed;
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate email address format.
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  
  // Basic RFC 5322 pattern
  const pattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return pattern.test(email);
}

/**
 * Extract domain from email address.
 */
export function getEmailDomain(email: string): string {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : '';
}
