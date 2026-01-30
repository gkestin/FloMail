/**
 * Email Renderer Type Definitions
 *
 * Professional-grade type system for email rendering
 */

/**
 * Email rendering modes based on content analysis
 */
export enum EmailRenderMode {
  /** Plain text with basic formatting */
  PLAIN_TEXT = 'plain_text',

  /** Light HTML with simple styling */
  LIGHT_HTML = 'light_html',

  /** Rich HTML with images and complex styling */
  RICH_HTML = 'rich_html',

  /** Newsletter/marketing email */
  NEWSLETTER = 'newsletter',

  /** System/automated email */
  SYSTEM = 'system'
}

/**
 * Email content structure after parsing
 */
export interface ParsedEmailStructure {
  /** Main message content */
  mainContent: string;

  /** Quoted reply chains */
  quotedSections: QuotedSection[];

  /** Email signature if detected */
  signature?: string;

  /** Metadata extracted from headers */
  metadata?: EmailMetadata;

  /** Detected render mode */
  renderMode: EmailRenderMode;

  /** Content suitable for TTS */
  ttsContent: string;

  /** Whether content needs special handling */
  flags: {
    hasImages: boolean;
    hasExternalStyles: boolean;
    hasScripts: boolean;
    hasForms: boolean;
    hasTracking: boolean;
    needsIframeIsolation: boolean;
    isRTL: boolean;
  };
}

/**
 * Quoted content section
 */
export interface QuotedSection {
  /** Unique ID for this section */
  id: string;

  /** Attribution line (e.g., "On Jan 1, John wrote:") */
  attribution?: string;

  /** The quoted content */
  content: string;

  /** Nesting level (0 = top level quote) */
  depth: number;

  /** Type of quote */
  type: 'reply' | 'forward';

  /** Sender info if available */
  sender?: {
    name?: string;
    email?: string;
    date?: string;
  };
}

/**
 * Email metadata
 */
export interface EmailMetadata {
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  date?: string;
  messageId?: string;
}

/**
 * Dark mode transformation settings
 */
export interface DarkModeSettings {
  /** Enable dark mode transformations */
  enabled: boolean;

  /** Transformation strategy */
  strategy: 'invert' | 'custom' | 'adaptive';

  /** Brightness adjustment (-100 to 100) */
  brightness: number;

  /** Contrast adjustment (-100 to 100) */
  contrast: number;

  /** Preserve original colors for these elements */
  preserveSelectors?: string[];
}

/**
 * Responsive display settings
 */
export interface ResponsiveSettings {
  /** Base font size in pixels */
  baseFontSize: number;

  /** Line height multiplier */
  lineHeight: number;

  /** Maximum content width */
  maxWidth?: string;

  /** Enable fluid typography */
  fluidTypography: boolean;

  /** Breakpoints for responsive adjustments */
  breakpoints: {
    mobile: number;
    tablet: number;
    desktop: number;
  };
}

/**
 * Email renderer configuration
 */
export interface EmailRendererConfig {
  /** Dark mode settings */
  darkMode: DarkModeSettings;

  /** Responsive display settings */
  responsive: ResponsiveSettings;

  /** Security settings */
  security: {
    /** Remove tracking pixels */
    removeTracking: boolean;

    /** Block external resources */
    blockExternalResources: boolean;

    /** Sanitize HTML aggressively */
    strictSanitization: boolean;

    /** Allowed URL schemes */
    allowedSchemes: string[];
  };

  /** Display preferences */
  display: {
    /** Collapse quoted content by default */
    collapseQuotes: boolean;

    /** Show email metadata */
    showMetadata: boolean;

    /** Enable smooth animations */
    animations: boolean;

    /** Text direction */
    direction: 'ltr' | 'rtl' | 'auto';
  };
}

/**
 * Render result with metrics
 */
export interface RenderResult {
  /** Rendered HTML/JSX */
  content: React.ReactNode;

  /** Performance metrics */
  metrics: {
    parseTime: number;
    renderTime: number;
    sanitizationTime: number;
  };

  /** Any warnings or issues */
  warnings: string[];
}

/**
 * Email content analysis result
 */
export interface EmailAnalysis {
  /** Detected email type */
  type: 'personal' | 'newsletter' | 'transactional' | 'marketing' | 'automated';

  /** Complexity score (0-100) */
  complexity: number;

  /** Detected language */
  language?: string;

  /** Has potentially dangerous content */
  hasSuspiciousContent: boolean;

  /** Recommended render mode */
  recommendedMode: EmailRenderMode;

  /** Content statistics */
  stats: {
    wordCount: number;
    imageCount: number;
    linkCount: number;
    quoteDepth: number;
  };
}