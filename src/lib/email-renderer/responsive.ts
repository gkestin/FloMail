/**
 * Responsive Typography and Layout System
 *
 * Professional responsive design for email rendering
 */

import { ResponsiveSettings } from './types';

/**
 * Generate responsive CSS for email rendering
 */
export function getResponsiveStyles(settings: ResponsiveSettings): string {
  const { baseFontSize, lineHeight, maxWidth, fluidTypography, breakpoints } = settings;

  // Calculate fluid typography scale
  const minFontSize = Math.round(baseFontSize * 0.875); // 14px for 16px base
  const maxFontSize = Math.round(baseFontSize * 1.125); // 18px for 16px base

  return `
    /* Reset and base styles */
    .email-content {
      margin: 0;
      padding: 0;
      width: 100%;
      max-width: ${maxWidth || '100%'};
      margin-left: auto;
      margin-right: auto;
      word-wrap: break-word;
      word-break: break-word;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }

    /* Base typography */
    .email-content {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
                   'Helvetica Neue', Arial, sans-serif, 'Apple Color Emoji',
                   'Segoe UI Emoji', 'Segoe UI Symbol';
      font-size: ${fluidTypography
        ? `clamp(${minFontSize}px, 2.5vw, ${maxFontSize}px)`
        : `${baseFontSize}px`};
      line-height: ${lineHeight};
      color: inherit;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Responsive padding */
    .email-content-wrapper {
      padding: clamp(12px, 3vw, 24px);
    }

    /* Headings with fluid sizing */
    .email-content h1 {
      font-size: ${fluidTypography
        ? 'clamp(1.5rem, 4vw, 2rem)'
        : '1.875rem'};
      line-height: 1.2;
      margin: 1rem 0;
    }

    .email-content h2 {
      font-size: ${fluidTypography
        ? 'clamp(1.25rem, 3.5vw, 1.625rem)'
        : '1.5rem'};
      line-height: 1.3;
      margin: 0.875rem 0;
    }

    .email-content h3 {
      font-size: ${fluidTypography
        ? 'clamp(1.125rem, 3vw, 1.375rem)'
        : '1.25rem'};
      line-height: 1.4;
      margin: 0.75rem 0;
    }

    .email-content h4, .email-content h5, .email-content h6 {
      font-size: ${fluidTypography
        ? 'clamp(1rem, 2.5vw, 1.125rem)'
        : '1.125rem'};
      line-height: 1.4;
      margin: 0.625rem 0;
    }

    /* Paragraphs and text */
    .email-content p {
      margin: 0.75rem 0;
    }

    .email-content small {
      font-size: 0.875em;
    }

    /* Links */
    .email-content a {
      color: #3b82f6;
      text-decoration: underline;
      word-break: break-word;
    }

    .email-content a:hover {
      color: #2563eb;
      text-decoration: none;
    }

    /* Lists */
    .email-content ul, .email-content ol {
      margin: 0.75rem 0;
      padding-left: clamp(1.25rem, 4vw, 2rem);
    }

    .email-content li {
      margin: 0.25rem 0;
    }

    /* Blockquotes */
    .email-content blockquote {
      margin: 1rem 0;
      padding: 0.5rem 1rem;
      border-left: 3px solid #64748b;
      background: rgba(100, 116, 139, 0.1);
    }

    /* Tables - make responsive */
    .email-content table {
      width: 100%;
      max-width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }

    .email-content-table-wrapper {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 1rem -12px;
      padding: 0 12px;
    }

    .email-content table,
    .email-content th,
    .email-content td {
      border: 1px solid rgba(100, 116, 139, 0.2);
    }

    .email-content th,
    .email-content td {
      padding: clamp(0.375rem, 2vw, 0.75rem);
      text-align: left;
    }

    .email-content th {
      background: rgba(100, 116, 139, 0.05);
      font-weight: 600;
    }

    /* Images - responsive and contained */
    .email-content img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0.75rem 0;
      border-radius: 0.375rem;
    }

    /* Inline images */
    .email-content img[style*="display: inline"],
    .email-content img[style*="display:inline"] {
      display: inline-block;
      margin: 0 0.25rem;
    }

    /* Code blocks */
    .email-content pre {
      margin: 1rem 0;
      padding: 0.75rem;
      background: rgba(100, 116, 139, 0.1);
      border-radius: 0.375rem;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      font-size: 0.875em;
    }

    .email-content code {
      font-family: inherit;
      font-size: 0.875em;
      padding: 0.125rem 0.25rem;
      background: rgba(100, 116, 139, 0.1);
      border-radius: 0.25rem;
    }

    /* Horizontal rules */
    .email-content hr {
      margin: 1.5rem 0;
      border: none;
      border-top: 1px solid rgba(100, 116, 139, 0.2);
    }

    /* Mobile-specific adjustments */
    @media (max-width: ${breakpoints.mobile}px) {
      .email-content {
        font-size: ${minFontSize}px;
      }

      .email-content h1 { font-size: 1.5rem; }
      .email-content h2 { font-size: 1.25rem; }
      .email-content h3 { font-size: 1.125rem; }

      .email-content-table-wrapper {
        margin: 0.75rem -12px;
      }

      /* Stack table cells on narrow screens */
      .email-content .responsive-table thead {
        display: none;
      }

      .email-content .responsive-table tr {
        display: block;
        margin-bottom: 0.5rem;
      }

      .email-content .responsive-table td {
        display: block;
        text-align: right;
        padding-left: 50%;
        position: relative;
      }

      .email-content .responsive-table td:before {
        content: attr(data-label);
        position: absolute;
        left: 0.75rem;
        text-align: left;
        font-weight: 600;
      }
    }

    /* Tablet adjustments */
    @media (min-width: ${breakpoints.mobile + 1}px) and (max-width: ${breakpoints.tablet}px) {
      .email-content {
        font-size: ${baseFontSize}px;
      }
    }

    /* Desktop adjustments */
    @media (min-width: ${breakpoints.desktop}px) {
      .email-content {
        font-size: ${maxFontSize}px;
      }

      .email-content-wrapper {
        padding: 24px;
      }
    }

    /* Dark mode adjustments */
    @media (prefers-color-scheme: dark) {
      .email-content blockquote {
        background: rgba(100, 116, 139, 0.15);
        border-left-color: #475569;
      }

      .email-content th {
        background: rgba(100, 116, 139, 0.1);
      }

      .email-content pre,
      .email-content code {
        background: rgba(100, 116, 139, 0.15);
      }
    }

    /* Print styles */
    @media print {
      .email-content {
        font-size: 12pt;
        line-height: 1.5;
      }

      .email-content a {
        text-decoration: underline;
      }

      .email-content a[href]:after {
        content: " (" attr(href) ")";
        font-size: 0.875em;
        opacity: 0.7;
      }
    }

    /* Accessibility improvements */
    .email-content:focus-within {
      outline: 2px solid #3b82f6;
      outline-offset: 2px;
    }

    .email-content [tabindex]:focus {
      outline: 2px solid #3b82f6;
      outline-offset: 2px;
    }

    /* RTL support */
    .email-content[dir="rtl"] {
      text-align: right;
    }

    .email-content[dir="rtl"] ul,
    .email-content[dir="rtl"] ol {
      padding-right: clamp(1.25rem, 4vw, 2rem);
      padding-left: 0;
    }

    .email-content[dir="rtl"] blockquote {
      border-left: none;
      border-right: 3px solid #64748b;
      padding-right: 1rem;
      padding-left: 0;
    }

    /* Utility classes */
    .email-content .text-muted {
      opacity: 0.7;
    }

    .email-content .text-small {
      font-size: 0.875em;
    }

    .email-content .text-large {
      font-size: 1.125em;
    }

    .email-content .mt-0 { margin-top: 0; }
    .email-content .mb-0 { margin-bottom: 0; }
    .email-content .my-0 { margin-top: 0; margin-bottom: 0; }
  `;
}

/**
 * Apply responsive transformations to HTML
 */
export function makeHtmlResponsive(html: string): string {
  // Add responsive wrapper
  html = `<div class="email-content-wrapper"><div class="email-content">${html}</div></div>`;

  // Make tables responsive
  html = html.replace(
    /<table([^>]*)>/gi,
    '<div class="email-content-table-wrapper"><table$1 class="responsive-table">'
  );
  html = html.replace(/<\/table>/gi, '</table></div>');

  // Add data-labels to table cells for mobile view
  html = processTableCells(html);

  // Ensure images are responsive
  html = html.replace(
    /<img([^>]*?)(?:\s+style="[^"]*")?([^>]*)>/gi,
    (match, before, after) => {
      // Check if it's an inline image
      if (match.includes('display:inline') || match.includes('display: inline')) {
        return `<img${before} style="display:inline-block;max-width:100%;height:auto"${after}>`;
      }
      return `<img${before} style="max-width:100%;height:auto"${after}>`;
    }
  );

  return html;
}

/**
 * Process table cells to add data-labels for mobile view
 */
function processTableCells(html: string): string {
  // This is a simplified version - in production you'd want more robust parsing
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;

  return html.replace(tableRegex, (tableMatch) => {
    // Extract headers
    const headerMatch = tableMatch.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    if (!headerMatch) return tableMatch;

    const headers: string[] = [];
    const headerCells = headerMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];

    headerCells.forEach(cell => {
      const text = cell.replace(/<[^>]+>/g, '').trim();
      headers.push(text);
    });

    // Add data-labels to body cells
    let processedTable = tableMatch;
    const rows = tableMatch.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

    rows.forEach(row => {
      if (row.includes('<th')) return; // Skip header rows

      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      cells.forEach((cell, index) => {
        if (headers[index]) {
          const newCell = cell.replace('<td', `<td data-label="${headers[index]}"`);
          processedTable = processedTable.replace(cell, newCell);
        }
      });
    });

    return processedTable;
  });
}

/**
 * Calculate optimal font size based on viewport
 */
export function calculateOptimalFontSize(viewportWidth: number): number {
  // Mobile: 14-16px
  if (viewportWidth < 480) {
    return Math.max(14, Math.min(16, viewportWidth * 0.04));
  }

  // Tablet: 16-18px
  if (viewportWidth < 1024) {
    return Math.max(16, Math.min(18, viewportWidth * 0.025));
  }

  // Desktop: 16-18px
  return 16;
}