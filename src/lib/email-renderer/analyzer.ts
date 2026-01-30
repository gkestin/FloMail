/**
 * Email Content Analyzer
 *
 * Intelligently analyzes email content to determine optimal rendering strategy
 */

import { EmailRenderMode, EmailAnalysis } from './types';

/**
 * Analyze email content to determine rendering strategy
 */
export function analyzeEmail(html: string, plainText?: string): EmailAnalysis {
  const content = html || plainText || '';

  // Initialize analysis
  const analysis: EmailAnalysis = {
    type: 'personal',
    complexity: 0,
    hasSuspiciousContent: false,
    recommendedMode: EmailRenderMode.PLAIN_TEXT,
    stats: {
      wordCount: 0,
      imageCount: 0,
      linkCount: 0,
      quoteDepth: 0
    }
  };

  if (!content) return analysis;

  // Analyze HTML content
  if (html) {
    // Count elements
    analysis.stats.imageCount = (html.match(/<img[^>]*>/gi) || []).length;
    analysis.stats.linkCount = (html.match(/<a[^>]*>/gi) || []).length;

    // Check for newsletter patterns
    const hasUnsubscribe = /unsubscribe|opt-out|email preferences/i.test(html);
    const hasMailingList = /mailing list|newsletter|update your preferences/i.test(html);
    const hasMarketingImages = analysis.stats.imageCount > 3;
    const hasTrackingPixel = /<img[^>]*width=["']?1["']?[^>]*height=["']?1["']?/i.test(html);

    // Check for transactional patterns
    const hasOrderInfo = /order #|invoice|receipt|confirmation/i.test(html);
    const hasAccountInfo = /account|password|verify|confirm your/i.test(html);

    // Check for complex HTML
    const hasTables = /<table/i.test(html);
    const hasMultipleColumns = /<td[^>]*>/gi.test(html) && (html.match(/<td[^>]*>/gi) || []).length > 3;
    const hasInlineStyles = /style=["'][^"']{50,}/i.test(html);
    const hasStyleTag = /<style[^>]*>[\s\S]{100,}<\/style>/i.test(html);

    // Determine email type
    if (hasUnsubscribe || hasMailingList) {
      analysis.type = hasMarketingImages ? 'marketing' : 'newsletter';
    } else if (hasOrderInfo || hasAccountInfo) {
      analysis.type = 'transactional';
    } else if (hasTrackingPixel || analysis.stats.linkCount > 10) {
      analysis.type = 'automated';
    } else {
      analysis.type = 'personal';
    }

    // Calculate complexity score
    let complexity = 0;
    if (hasTables) complexity += 20;
    if (hasMultipleColumns) complexity += 15;
    if (hasInlineStyles) complexity += 10;
    if (hasStyleTag) complexity += 10;
    if (analysis.stats.imageCount > 0) complexity += Math.min(analysis.stats.imageCount * 5, 25);
    if (analysis.stats.linkCount > 5) complexity += 10;
    if (html.length > 50000) complexity += 10;

    analysis.complexity = Math.min(complexity, 100);

    // Check for suspicious content
    const hasScripts = /<script/i.test(html);
    const hasIframes = /<iframe/i.test(html);
    const hasForms = /<form/i.test(html);
    const hasJavaScriptLinks = /href=["']?javascript:/i.test(html);

    analysis.hasSuspiciousContent = hasScripts || hasIframes || hasForms || hasJavaScriptLinks;

    // Determine recommended render mode
    if (analysis.hasSuspiciousContent || analysis.complexity > 70) {
      analysis.recommendedMode = EmailRenderMode.RICH_HTML; // Needs iframe isolation
    } else if (analysis.type === 'newsletter' || analysis.type === 'marketing') {
      analysis.recommendedMode = EmailRenderMode.NEWSLETTER;
    } else if (analysis.complexity > 30) {
      analysis.recommendedMode = EmailRenderMode.LIGHT_HTML;
    } else {
      analysis.recommendedMode = EmailRenderMode.PLAIN_TEXT;
    }
  } else {
    // Plain text analysis
    analysis.recommendedMode = EmailRenderMode.PLAIN_TEXT;
  }

  // Count words
  const textContent = html ? stripHtml(html) : plainText || '';
  analysis.stats.wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

  // Detect quote depth
  analysis.stats.quoteDepth = detectMaxQuoteDepth(textContent);

  // Detect language (basic detection)
  analysis.language = detectLanguage(textContent);

  return analysis;
}

/**
 * Strip HTML tags for text analysis
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect maximum quote depth in text
 */
function detectMaxQuoteDepth(text: string): number {
  const lines = text.split('\n');
  let maxDepth = 0;

  for (const line of lines) {
    const matches = line.match(/^(>+)/);
    if (matches) {
      maxDepth = Math.max(maxDepth, matches[1].length);
    }
  }

  return maxDepth;
}

/**
 * Basic language detection
 */
function detectLanguage(text: string): string {
  // Very basic detection based on common patterns
  const patterns: Record<string, RegExp[]> = {
    'en': [/\b(the|and|of|to|in|is|was|were|are|been)\b/i],
    'es': [/\b(el|la|de|que|y|en|es|por|con|para)\b/i],
    'fr': [/\b(le|la|de|et|est|dans|que|pour|avec|sur)\b/i],
    'de': [/\b(der|die|das|und|ist|von|mit|auf|für|den)\b/i],
    'it': [/\b(il|la|di|e|che|per|con|sono|nella|della)\b/i],
    'pt': [/\b(o|a|de|e|que|em|para|com|por|uma)\b/i],
    'zh': [/[\u4e00-\u9fff]/],
    'ja': [/[\u3040-\u309f\u30a0-\u30ff]/],
    'ko': [/[\uac00-\ud7af]/],
    'ar': [/[\u0600-\u06ff]/],
    'he': [/[\u0590-\u05ff]/],
    'ru': [/[\u0400-\u04ff]/]
  };

  let bestMatch = 'en';
  let bestScore = 0;

  for (const [lang, regexes] of Object.entries(patterns)) {
    let score = 0;
    for (const regex of regexes) {
      const matches = text.match(regex) || [];
      score += matches.length;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = lang;
    }
  }

  return bestMatch;
}

/**
 * Determine if content should be isolated in iframe
 */
export function needsIframeIsolation(analysis: EmailAnalysis): boolean {
  return analysis.hasSuspiciousContent ||
         analysis.complexity > 70 ||
         analysis.type === 'newsletter' ||
         analysis.type === 'marketing';
}