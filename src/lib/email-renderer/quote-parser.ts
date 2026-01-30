/**
 * Advanced Quote Detection and Parsing System
 *
 * Intelligently identifies and structures quoted content in emails
 */

import { QuotedSection, ParsedEmailStructure } from './types';

/**
 * Quote attribution patterns for multiple languages and email clients
 */
const QUOTE_PATTERNS = {
  // English
  en: [
    /^On\s+.+?,\s*.+?wrote:?\s*$/im,
    /^On\s+.+?\s+at\s+.+?,\s*.+?wrote:?\s*$/im,
    /^.+?\s+wrote\s+on\s+.+?:?\s*$/im,
  ],
  // French
  fr: [
    /^Le\s+.+?,\s*.+?a\s+écrit\s*:?\s*$/im,
  ],
  // German
  de: [
    /^Am\s+.+?\s+schrieb\s*.+?:?\s*$/im,
  ],
  // Spanish
  es: [
    /^El\s+.+?,\s*.+?escribió:?\s*$/im,
  ],
  // Italian
  it: [
    /^Il\s+.+?,\s*.+?ha\s+scritto:?\s*$/im,
  ],
  // Portuguese
  pt: [
    /^Em\s+.+?,\s*.+?escreveu:?\s*$/im,
  ],
  // Generic patterns
  generic: [
    /^-{3,}\s*Original\s+Message\s*-{3,}$/im,
    /^-{3,}\s*Forwarded\s+message\s*-{3,}$/im,
    /^Begin\s+forwarded\s+message:?\s*$/im,
    /^From:\s*.+?\s*$/im,
    /^Date:\s*.+?\s*$/im,
    /^Subject:\s*.+?\s*$/im,
    /^To:\s*.+?\s*$/im,
  ]
};

/**
 * Parse email content and extract quoted sections
 */
export function parseQuotedContent(
  content: string,
  isHtml: boolean = false
): ParsedEmailStructure {
  // Convert HTML to text if needed
  const textContent = isHtml ? htmlToText(content) : content;

  // Initialize structure
  const structure: ParsedEmailStructure = {
    mainContent: '',
    quotedSections: [],
    signature: undefined,
    metadata: undefined,
    renderMode: isHtml ? 'light_html' : 'plain_text' as any,
    ttsContent: '',
    flags: {
      hasImages: false,
      hasExternalStyles: false,
      hasScripts: false,
      hasForms: false,
      hasTracking: false,
      needsIframeIsolation: false,
      isRTL: false,
    }
  };

  // Detect signature
  const { content: contentWithoutSig, signature } = extractSignature(textContent);
  structure.signature = signature;

  // Parse quotes
  const { mainContent, quotedSections } = extractQuotedSections(contentWithoutSig);
  structure.mainContent = mainContent;
  structure.quotedSections = quotedSections;

  // Generate TTS content (clean main content only)
  structure.ttsContent = generateTTSContent(mainContent);

  // Set flags for HTML content
  if (isHtml) {
    structure.flags = analyzeHtmlFlags(content);
  }

  return structure;
}

/**
 * Extract signature from email content
 */
function extractSignature(content: string): {
  content: string;
  signature?: string;
} {
  const lines = content.split('\n');
  let signatureStart = -1;

  // Common signature delimiters
  const signaturePatterns = [
    /^--\s*$/,                                    // Standard delimiter
    /^Sent from my (iPhone|iPad|Android)/i,      // Mobile signatures
    /^Get Outlook for/i,                         // Outlook
    /^Best regards?|Sincerely|Thanks|Regards|Cheers/i,  // Closings
    /^\w+\s*$/,                                  // Single name
  ];

  // Scan from bottom up for signature
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
    const line = lines[i].trim();

    for (const pattern of signaturePatterns) {
      if (pattern.test(line)) {
        signatureStart = i;
        break;
      }
    }

    if (signatureStart !== -1) break;
  }

  if (signatureStart !== -1 && signatureStart < lines.length - 1) {
    return {
      content: lines.slice(0, signatureStart).join('\n'),
      signature: lines.slice(signatureStart).join('\n')
    };
  }

  return { content };
}

/**
 * Extract quoted sections from email content
 */
function extractQuotedSections(content: string): {
  mainContent: string;
  quotedSections: QuotedSection[];
} {
  const quotedSections: QuotedSection[] = [];
  const lines = content.split('\n');
  let mainContent: string[] = [];
  let currentQuote: QuotedSection | null = null;
  let quoteBuffer: string[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const attribution = detectAttribution(line);

    if (attribution) {
      // Save previous quote if exists
      if (currentQuote && quoteBuffer.length > 0) {
        currentQuote.content = quoteBuffer.join('\n').trim();
        quotedSections.push(currentQuote);
      }

      // Start new quote
      currentQuote = {
        id: `quote-${quotedSections.length}`,
        attribution: line,
        content: '',
        depth: depth++,
        type: line.toLowerCase().includes('forward') ? 'forward' : 'reply',
        sender: extractSenderInfo(line)
      };
      quoteBuffer = [];
    } else if (isQuotedLine(line)) {
      // Add to current quote
      const cleanLine = line.replace(/^>+\s*/, '');
      quoteBuffer.push(cleanLine);
    } else if (currentQuote) {
      // Continuing quoted content
      quoteBuffer.push(line);
    } else {
      // Main content
      mainContent.push(line);
    }
  }

  // Save last quote if exists
  if (currentQuote && quoteBuffer.length > 0) {
    currentQuote.content = quoteBuffer.join('\n').trim();
    quotedSections.push(currentQuote);
  }

  return {
    mainContent: mainContent.join('\n').trim(),
    quotedSections
  };
}

/**
 * Detect if a line is an attribution line
 */
function detectAttribution(line: string): boolean {
  const allPatterns = Object.values(QUOTE_PATTERNS).flat();

  for (const pattern of allPatterns) {
    if (pattern.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a line is quoted (starts with >)
 */
function isQuotedLine(line: string): boolean {
  return /^\s*>+\s*/.test(line);
}

/**
 * Extract sender information from attribution line
 */
function extractSenderInfo(attribution: string): {
  name?: string;
  email?: string;
  date?: string;
} | undefined {
  const info: any = {};

  // Try to extract email
  const emailMatch = attribution.match(/<([^>]+@[^>]+)>/);
  if (emailMatch) {
    info.email = emailMatch[1];
  }

  // Try to extract date
  const datePatterns = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    /(\w+\s+\d{1,2},?\s+\d{4})/,
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
  ];

  for (const pattern of datePatterns) {
    const match = attribution.match(pattern);
    if (match) {
      info.date = match[1];
      break;
    }
  }

  // Try to extract name
  if (info.email) {
    const beforeEmail = attribution.substring(0, attribution.indexOf('<')).trim();
    const nameMatch = beforeEmail.match(/([A-Za-z]+(?:\s+[A-Za-z]+)*)\s*$/);
    if (nameMatch) {
      info.name = nameMatch[1];
    }
  }

  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * Convert HTML to plain text for quote detection
 */
function htmlToText(html: string): string {
  // Remove scripts and styles
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Convert breaks and paragraphs to newlines
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/p>/gi, '\n\n');
  html = html.replace(/<\/div>/gi, '\n');

  // Convert blockquotes to quoted lines
  html = html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    return content.split('\n').map((line: string) => `> ${line}`).join('\n');
  });

  // Remove all other tags
  html = html.replace(/<[^>]+>/g, '');

  // Decode entities
  html = decodeHtmlEntities(html);

  // Clean up whitespace
  html = html.replace(/\n{3,}/g, '\n\n');

  return html.trim();
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&hellip;': '...',
  };

  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'gi'), char);
  }

  return text;
}

/**
 * Generate clean content for TTS
 */
function generateTTSContent(content: string): string {
  let tts = content;

  // Remove URLs
  tts = tts.replace(/https?:\/\/[^\s]+/g, 'link');

  // Remove emails
  tts = tts.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'email address');

  // Remove special characters
  tts = tts.replace(/[<>{}[\]\\|`~]/g, '');

  // Clean up excessive punctuation
  tts = tts.replace(/[.]{3,}/g, '...');
  tts = tts.replace(/[!]{2,}/g, '!');
  tts = tts.replace(/[?]{2,}/g, '?');

  // Clean up whitespace
  tts = tts.replace(/\s+/g, ' ').trim();

  return tts;
}

/**
 * Analyze HTML content for flags
 */
function analyzeHtmlFlags(html: string): ParsedEmailStructure['flags'] {
  return {
    hasImages: /<img[^>]*>/i.test(html),
    hasExternalStyles: /<link[^>]*stylesheet/i.test(html) || /@import/i.test(html),
    hasScripts: /<script/i.test(html),
    hasForms: /<form/i.test(html),
    hasTracking: /<img[^>]*width=["']?1["']?[^>]*height=["']?1["']?/i.test(html),
    needsIframeIsolation: false, // Will be determined by analyzer
    isRTL: /dir=["']?rtl/i.test(html) || /direction:\s*rtl/i.test(html),
  };
}