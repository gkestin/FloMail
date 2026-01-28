/**
 * Email Message Styling Configuration
 *
 * Provides consistent, responsive styling for email content
 * across mobile and desktop with proper dark theme support
 */

export const EMAIL_STYLES = {
  // Base text sizes - larger for better readability
  text: {
    // Desktop sizes
    desktop: {
      body: 'text-base',         // 16px - main message content
      preview: 'text-sm',         // 14px - preview text
      metadata: 'text-sm',        // 14px - sender, date, etc.
      quoted: 'text-sm',          // 14px - quoted content
      label: 'text-xs',           // 12px - labels like "Draft", "To:", etc.
    },
    // Mobile sizes - slightly larger for touch screens
    mobile: {
      body: 'text-base sm:text-lg',    // 16px mobile, 18px tablet+
      preview: 'text-sm sm:text-base',  // 14px mobile, 16px tablet+
      metadata: 'text-sm',               // 14px - keep same
      quoted: 'text-sm sm:text-base',   // 14px mobile, 16px tablet+
      label: 'text-xs sm:text-sm',      // 12px mobile, 14px tablet+
    }
  },

  // Line height for readability
  lineHeight: {
    body: 'leading-relaxed',      // 1.625 - comfortable reading
    preview: 'leading-snug',      // 1.375 - compact for previews
    quoted: 'leading-relaxed',    // 1.625 - same as body
  },

  // Dark theme colors using CSS variables
  colors: {
    // Text colors
    text: {
      primary: 'text-slate-100',        // Main content text
      secondary: 'text-slate-300',      // Secondary info
      muted: 'text-slate-400',          // Muted/disabled text
      quoted: 'text-slate-400',         // Quoted text
      link: 'text-blue-400 hover:text-blue-300',
    },
    // Background colors
    background: {
      primary: 'bg-slate-900',          // Main background
      elevated: 'bg-slate-800/50',     // Cards, elevated surfaces
      hover: 'hover:bg-white/5',        // Hover states
      selected: 'bg-white/10',          // Selected items
      quoted: 'bg-slate-800/30',        // Quoted content background
    },
    // Border colors
    border: {
      default: 'border-slate-700/50',
      subtle: 'border-slate-800/30',
      quoted: 'border-slate-600/50',
    }
  },

  // Spacing for different screen sizes
  spacing: {
    mobile: {
      padding: 'p-3',
      gap: 'gap-3',
      margin: 'my-3',
    },
    desktop: {
      padding: 'sm:p-4',
      gap: 'sm:gap-4',
      margin: 'sm:my-4',
    }
  },

  // Container widths for readability
  maxWidth: {
    message: 'max-w-4xl',        // Comfortable reading width
    preview: 'max-w-2xl',        // Preview card width
  }
};

/**
 * Get responsive text class for message body
 */
export function getMessageBodyClass(isMobile: boolean = false): string {
  return `
    ${isMobile ? EMAIL_STYLES.text.mobile.body : EMAIL_STYLES.text.desktop.body}
    ${EMAIL_STYLES.lineHeight.body}
    ${EMAIL_STYLES.colors.text.primary}
    whitespace-pre-wrap
    break-words
  `.trim().replace(/\s+/g, ' ');
}

/**
 * Get responsive text class for quoted content
 */
export function getQuotedContentClass(isMobile: boolean = false): string {
  return `
    ${isMobile ? EMAIL_STYLES.text.mobile.quoted : EMAIL_STYLES.text.desktop.quoted}
    ${EMAIL_STYLES.lineHeight.quoted}
    ${EMAIL_STYLES.colors.text.quoted}
    whitespace-pre-wrap
    break-words
  `.trim().replace(/\s+/g, ' ');
}

/**
 * Get responsive text class for metadata (sender, date, etc.)
 */
export function getMetadataClass(isMobile: boolean = false): string {
  return `
    ${isMobile ? EMAIL_STYLES.text.mobile.metadata : EMAIL_STYLES.text.desktop.metadata}
    ${EMAIL_STYLES.colors.text.secondary}
  `.trim().replace(/\s+/g, ' ');
}

/**
 * Get responsive container padding
 */
export function getContainerPadding(): string {
  return `${EMAIL_STYLES.spacing.mobile.padding} ${EMAIL_STYLES.spacing.desktop.padding}`;
}

/**
 * Message container styles for consistent dark theme
 */
export const messageContainerStyles = {
  wrapper: `
    rounded-lg
    ${EMAIL_STYLES.colors.background.elevated}
    ${EMAIL_STYLES.colors.border.default}
    border
    backdrop-blur-sm
  `.trim().replace(/\s+/g, ' '),

  quotedSection: `
    rounded-lg
    ${EMAIL_STYLES.colors.background.quoted}
    ${EMAIL_STYLES.colors.border.quoted}
    border-l-2
    pl-3
    ${EMAIL_STYLES.spacing.mobile.padding}
    ${EMAIL_STYLES.spacing.desktop.padding}
  `.trim().replace(/\s+/g, ' '),
};