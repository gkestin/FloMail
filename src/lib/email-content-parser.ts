/**
 * Advanced Email Content Parser
 *
 * Intelligently separates email content into structured parts:
 * - Message metadata (sender, date, subject)
 * - Main message content
 * - Quoted/forwarded content
 *
 * Handles various email client formats including Gmail, Outlook, Apple Mail
 */

import { EmailMessage } from '@/types';

export interface ParsedEmailContent {
  // The actual message content (what the sender wrote)
  mainContent: string;
  // Metadata like sender info, date, etc.
  metadata?: EmailMetadata;
  // Quoted or forwarded content from previous messages
  quotedContent?: QuotedContent[];
  // Whether the email contains HTML that needs special rendering
  hasRichHtml: boolean;
  // Clean text suitable for TTS (no metadata, no quotes)
  ttsContent: string;
}

export interface EmailMetadata {
  from?: string;
  to?: string[];
  cc?: string[];
  date?: string;
  subject?: string;
}

export interface QuotedContent {
  // Attribution line like "On Jan 1, John wrote:"
  attribution?: string;
  // The quoted message content
  content: string;
  // Type of quote (reply or forward)
  type: 'reply' | 'forward';
}

// Common quote attribution patterns across email clients
const QUOTE_ATTRIBUTION_PATTERNS = [
  // Gmail style: "On Mon, Jan 1, 2024 at 12:00 PM John Doe <john@example.com> wrote:"
  /^On\s+.+?\s+wrote:?\s*$/im,
  // Outlook style: "From: John Doe\nSent: Monday, January 1, 2024 12:00 PM"
  /^From:\s*.+?\nSent:\s*.+?$/im,
  // Apple Mail: "On Jan 1, 2024, at 12:00 PM, John Doe <john@example.com> wrote:"
  /^On\s+.+?,\s+at\s+.+?,\s+.+?\s+wrote:?\s*$/im,
  // Generic: "----Original Message----"
  /^-{3,}\s*Original\s+Message\s*-{3,}$/im,
  // Forward header
  /^-{3,}\s*Forwarded\s+message\s*-{3,}$/im,
  /^Begin\s+forwarded\s+message:?\s*$/im,
];

// Patterns that indicate quoted lines
const QUOTED_LINE_PATTERNS = [
  /^\s*>\s+/,  // Lines starting with >
  /^\s*\|\s+/, // Lines starting with | (some clients)
];

// Separator patterns used by various clients
const SEPARATOR_PATTERNS = [
  /^_{3,}$/m,                    // _____
  /^-{3,}$/m,                    // -----
  /^={3,}$/m,                    // =====
  /^\*{3,}$/m,                   // *****
  /^~{3,}$/m,                    // ~~~~~
  /^\.{3,}$/m,                   // .....
];

// Common signature indicators
const SIGNATURE_PATTERNS = [
  /^--\s*$/m,                    // Standard signature delimiter
  /^Sent from my (iPhone|iPad|Android|Samsung|mobile device)/im,
  /^Get Outlook for (iOS|Android)/im,
  /^Best,?\s*$/im,
  /^Regards,?\s*$/im,
  /^Thanks,?\s*$/im,
  /^Sincerely,?\s*$/im,
  /^Cheers,?\s*$/im,
];

/**
 * Parse email content into structured parts
 */
export function parseEmailContent(
  content: string,
  isHtml: boolean = false
): ParsedEmailContent {
  if (!content) {
    return {
      mainContent: '',
      hasRichHtml: false,
      ttsContent: '',
    };
  }

  // For HTML emails, first convert to plain text for parsing
  let textContent = content;
  if (isHtml) {
    textContent = htmlToPlainText(content);
  }

  // Normalize the text
  textContent = normalizeText(textContent);

  // Find quote boundaries
  const quoteInfo = findQuoteBoundaries(textContent);

  // Extract main content (before quotes)
  let mainContent = textContent;
  let quotedContent: QuotedContent[] = [];

  if (quoteInfo.firstQuoteIndex !== -1) {
    mainContent = textContent.substring(0, quoteInfo.firstQuoteIndex).trim();

    // Parse quoted sections
    const quotedText = textContent.substring(quoteInfo.firstQuoteIndex);
    quotedContent = parseQuotedSections(quotedText);
  }

  // Remove signature from main content if present
  mainContent = removeSignature(mainContent);

  // Generate TTS-friendly content (clean, no metadata)
  const ttsContent = generateTTSContent(mainContent);

  // Check if HTML content needs rich rendering
  const hasRichHtml = isHtml && requiresHtmlRendering(content);

  return {
    mainContent,
    quotedContent: quotedContent.length > 0 ? quotedContent : undefined,
    hasRichHtml,
    ttsContent,
  };
}

/**
 * Find the boundaries of quoted content in email text
 */
function findQuoteBoundaries(text: string): {
  firstQuoteIndex: number;
  attributionLine?: string;
} {
  let firstQuoteIndex = -1;
  let attributionLine: string | undefined;

  // Check for quote attribution patterns
  for (const pattern of QUOTE_ATTRIBUTION_PATTERNS) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      if (firstQuoteIndex === -1 || match.index < firstQuoteIndex) {
        firstQuoteIndex = match.index;
        attributionLine = match[0];
      }
    }
  }

  // Check for separator patterns (might indicate forwarded content)
  for (const pattern of SEPARATOR_PATTERNS) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      // Check if there's quoted content after the separator
      const afterSeparator = text.substring(match.index + match[0].length);
      if (afterSeparator.trim() && (firstQuoteIndex === -1 || match.index < firstQuoteIndex)) {
        // Look for signs this is actually a quote separator
        const nextLines = afterSeparator.split('\n').slice(0, 3);
        const looksLikeQuote = nextLines.some(line =>
          QUOTED_LINE_PATTERNS.some(p => p.test(line)) ||
          /^(From|Date|Subject|To):/i.test(line.trim())
        );

        if (looksLikeQuote) {
          firstQuoteIndex = match.index;
        }
      }
    }
  }

  // If no attribution found, look for lines starting with >
  if (firstQuoteIndex === -1) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (QUOTED_LINE_PATTERNS.some(p => p.test(lines[i]))) {
        firstQuoteIndex = text.indexOf(lines[i]);
        break;
      }
    }
  }

  return { firstQuoteIndex, attributionLine };
}

/**
 * Parse quoted sections into structured format
 */
function parseQuotedSections(quotedText: string): QuotedContent[] {
  const sections: QuotedContent[] = [];
  const lines = quotedText.split('\n');

  let currentSection: QuotedContent | null = null;
  let contentBuffer: string[] = [];

  for (const line of lines) {
    // Check if this is an attribution line
    const isAttribution = QUOTE_ATTRIBUTION_PATTERNS.some(p => p.test(line));

    if (isAttribution) {
      // Save previous section if exists
      if (currentSection && contentBuffer.length > 0) {
        currentSection.content = contentBuffer.join('\n').trim();
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        attribution: line,
        content: '',
        type: line.toLowerCase().includes('forward') ? 'forward' : 'reply',
      };
      contentBuffer = [];
    } else {
      // Add to content buffer, removing quote markers
      let cleanLine = line;
      for (const pattern of QUOTED_LINE_PATTERNS) {
        cleanLine = cleanLine.replace(pattern, '');
      }
      contentBuffer.push(cleanLine);
    }
  }

  // Save last section
  if (currentSection || contentBuffer.length > 0) {
    if (!currentSection) {
      currentSection = {
        content: '',
        type: 'reply',
      };
    }
    currentSection.content = contentBuffer.join('\n').trim();
    if (currentSection.content) {
      sections.push(currentSection);
    }
  }

  return sections;
}

/**
 * Remove email signature from content
 */
function removeSignature(content: string): string {
  let result = content;
  let signatureIndex = -1;

  // Find signature start
  for (const pattern of SIGNATURE_PATTERNS) {
    const match = result.match(pattern);
    if (match && match.index !== undefined) {
      if (signatureIndex === -1 || match.index < signatureIndex) {
        signatureIndex = match.index;
      }
    }
  }

  if (signatureIndex !== -1) {
    result = result.substring(0, signatureIndex).trim();
  }

  return result;
}

/**
 * Generate clean content suitable for TTS
 */
function generateTTSContent(mainContent: string): string {
  if (!mainContent) return '';

  let tts = mainContent;

  // Remove URLs (they're hard to read aloud)
  tts = tts.replace(/https?:\/\/[^\s]+/g, '[link]');

  // Remove email addresses
  tts = tts.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]');

  // Remove excessive punctuation
  tts = tts.replace(/[.]{3,}/g, '...');
  tts = tts.replace(/[!]{2,}/g, '!');
  tts = tts.replace(/[?]{2,}/g, '?');

  // Remove special characters that TTS struggles with
  tts = tts.replace(/[<>{}[\]\\|`~]/g, '');

  // Clean up whitespace
  tts = tts.replace(/\n{3,}/g, '\n\n');
  tts = tts.trim();

  return tts;
}

/**
 * Convert HTML to plain text for parsing
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';

  let text = html;

  // Remove script and style content
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Convert breaks and paragraphs to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');

  // Add newlines before block elements
  text = text.replace(/<(p|div|li|blockquote|h[1-6])\b/gi, '\n<$1');

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Clean up excessive whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&apos;': "'",
    '&#x2F;': '/',
    '&#x60;': '`',
    '&#x3D;': '=',
    '&hellip;': '...',
    '&mdash;': '—',
    '&ndash;': '–',
    '&bull;': '•',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }

  // Decode numeric entities
  result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return result;
}

/**
 * Normalize text for consistent parsing
 */
function normalizeText(text: string): string {
  if (!text) return '';

  // Normalize line endings
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Convert non-breaking spaces
  normalized = normalized.replace(/\u00A0/g, ' ');

  // Remove zero-width characters
  normalized = normalized.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  // Trim each line but preserve overall structure
  normalized = normalized
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n');

  return normalized;
}

/**
 * Determine if HTML content requires rich rendering
 */
function requiresHtmlRendering(html: string): boolean {
  if (!html) return false;

  // Check for images
  if (/<img\s+[^>]*src=["'](?!cid:)[^"']+["']/i.test(html)) return true;

  // Check for tables with visible borders
  if (/<table[^>]*border=["']?[1-9]/i.test(html)) return true;

  // Check for background colors (not white)
  if (/bgcolor=["']?(?!#?fff|white)[^"'\s>]+/i.test(html)) return true;
  if (/background(-color)?\s*:\s*(?!#?fff|white|transparent|inherit)[^;}"']+/i.test(html)) return true;

  // Check for styled lists
  if (/<(ul|ol)\s/i.test(html) && /<li\s/i.test(html)) return true;

  // Check for significant CSS
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (styleMatch && styleMatch[1].length > 100) return true;

  return false;
}

/**
 * Extract clean message body from an EmailMessage
 */
export function extractMessageBody(message: EmailMessage): ParsedEmailContent {
  // Prefer HTML if available and substantial
  const hasHtml = message.bodyHtml && message.bodyHtml.trim().length > 0;
  const content = hasHtml ? message.bodyHtml! : (message.body || '');

  return parseEmailContent(content, hasHtml);
}

/**
 * Get display-ready content for a message
 */
export function getDisplayContent(message: EmailMessage): {
  content: string;
  isHtml: boolean;
  ttsContent: string;
} {
  const parsed = extractMessageBody(message);

  // If it needs HTML rendering, return the original HTML
  if (parsed.hasRichHtml && message.bodyHtml) {
    return {
      content: message.bodyHtml,
      isHtml: true,
      ttsContent: parsed.ttsContent,
    };
  }

  // Otherwise return the parsed plain text
  return {
    content: parsed.mainContent,
    isHtml: false,
    ttsContent: parsed.ttsContent,
  };
}