/**
 * Dark Mode Transformation System
 *
 * Intelligent dark mode handling for various email types
 */

import { DarkModeSettings } from './types';

/**
 * Transform HTML for dark mode viewing
 */
export function transformForDarkMode(
  html: string,
  settings: DarkModeSettings
): string {
  if (!settings.enabled) return html;

  switch (settings.strategy) {
    case 'invert':
      return applyInvertStrategy(html, settings);
    case 'adaptive':
      return applyAdaptiveStrategy(html, settings);
    case 'custom':
    default:
      return applyCustomStrategy(html, settings);
  }
}

/**
 * CSS filter for dark mode
 */
export function getDarkModeFilter(settings: DarkModeSettings): string {
  const filters: string[] = [];

  if (settings.strategy === 'invert') {
    filters.push('invert(1)');
    filters.push('hue-rotate(180deg)');
  }

  // Brightness adjustment
  if (settings.brightness !== 0) {
    const brightness = 100 + settings.brightness;
    filters.push(`brightness(${brightness}%)`);
  }

  // Contrast adjustment
  if (settings.contrast !== 0) {
    const contrast = 100 + settings.contrast;
    filters.push(`contrast(${contrast}%)`);
  }

  return filters.join(' ');
}

/**
 * Apply invert strategy (like Gmail iOS)
 */
function applyInvertStrategy(html: string, settings: DarkModeSettings): string {
  // Preserve images from inversion
  html = html.replace(
    /<img([^>]*)>/gi,
    '<img$1 data-darkmode-preserve="true">'
  );

  // Add dark mode classes
  return wrapWithDarkMode(html, 'invert', settings);
}

/**
 * Apply adaptive strategy (intelligent transformation)
 */
function applyAdaptiveStrategy(html: string, settings: DarkModeSettings): string {
  // Parse colors and transform them
  html = transformColors(html);

  // Handle backgrounds
  html = transformBackgrounds(html);

  // Preserve specific elements
  if (settings.preserveSelectors) {
    html = preserveElements(html, settings.preserveSelectors);
  }

  return wrapWithDarkMode(html, 'adaptive', settings);
}

/**
 * Apply custom strategy (manual color mapping)
 */
function applyCustomStrategy(html: string, settings: DarkModeSettings): string {
  // Color transformation map
  const colorMap: Record<string, string> = {
    // Backgrounds
    '#ffffff': '#0f172a',
    '#fff': '#0f172a',
    'white': '#0f172a',
    '#f0f0f0': '#1e293b',
    '#f5f5f5': '#1e293b',
    '#fafafa': '#1e293b',
    '#e0e0e0': '#334155',
    '#eeeeee': '#334155',

    // Text colors
    '#000000': '#e2e8f0',
    '#000': '#e2e8f0',
    'black': '#e2e8f0',
    '#333333': '#cbd5e1',
    '#333': '#cbd5e1',
    '#666666': '#94a3b8',
    '#666': '#94a3b8',
    '#999999': '#64748b',
    '#999': '#64748b',

    // Links
    '#0000ff': '#60a5fa',
    'blue': '#60a5fa',
    '#1a73e8': '#3b82f6',
    '#007bff': '#3b82f6',
  };

  // Replace colors
  for (const [oldColor, newColor] of Object.entries(colorMap)) {
    const regex = new RegExp(
      `((?:color|background-color|background|border-color)\\s*:\\s*)(${escapeRegExp(oldColor)})(;|"|'|})`,
      'gi'
    );
    html = html.replace(regex, `$1${newColor}$3`);
  }

  return wrapWithDarkMode(html, 'custom', settings);
}

/**
 * Transform colors intelligently
 */
function transformColors(html: string): string {
  // Transform hex colors
  html = html.replace(
    /color\s*:\s*#([0-9a-f]{3,6})/gi,
    (match, hex) => {
      const lightness = getHexLightness(hex);
      if (lightness < 40) {
        // Dark text -> Light text
        return `color: ${lightenHex(hex, 70)}`;
      }
      return match;
    }
  );

  // Transform backgrounds
  html = html.replace(
    /background(?:-color)?\s*:\s*#([0-9a-f]{3,6})/gi,
    (match, hex) => {
      const lightness = getHexLightness(hex);
      if (lightness > 60) {
        // Light background -> Dark background
        return match.replace(hex, darkenHex(hex, 70));
      }
      return match;
    }
  );

  return html;
}

/**
 * Transform background colors and images
 */
function transformBackgrounds(html: string): string {
  // Remove white backgrounds
  html = html.replace(
    /background(?:-color)?\s*:\s*(?:white|#fff(?:fff)?|rgb\(255,\s*255,\s*255\))/gi,
    'background-color: transparent'
  );

  // Darken light backgrounds
  html = html.replace(
    /background(?:-color)?\s*:\s*(#[0-9a-f]{3,6}|rgb\([^)]+\))/gi,
    (match, color) => {
      if (isLightColor(color)) {
        return match.replace(color, darkenColor(color));
      }
      return match;
    }
  );

  return html;
}

/**
 * Preserve specific elements from transformation
 */
function preserveElements(html: string, selectors: string[]): string {
  for (const selector of selectors) {
    const regex = new RegExp(`<${selector}([^>]*)>`, 'gi');
    html = html.replace(regex, `<${selector}$1 data-darkmode-preserve="true">`);
  }
  return html;
}

/**
 * Wrap content with dark mode container
 */
function wrapWithDarkMode(html: string, strategy: string, settings: DarkModeSettings): string {
  const filter = getDarkModeFilter(settings);

  return `
    <div class="email-darkmode-wrapper" data-strategy="${strategy}">
      <style>
        .email-darkmode-wrapper {
          ${filter ? `filter: ${filter};` : ''}
        }

        /* Preserve specific elements */
        .email-darkmode-wrapper [data-darkmode-preserve="true"] {
          filter: ${strategy === 'invert' ? 'invert(1) hue-rotate(180deg)' : 'none'};
        }

        /* Fix images in invert mode */
        .email-darkmode-wrapper[data-strategy="invert"] img {
          filter: invert(1) hue-rotate(180deg);
        }

        /* Ensure links remain visible */
        .email-darkmode-wrapper a {
          color: #60a5fa !important;
        }
      </style>
      ${html}
    </div>
  `;
}

/**
 * Helper: Get lightness of hex color (0-100)
 */
function getHexLightness(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 50;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  return ((max + min) / 2) * 100;
}

/**
 * Helper: Convert hex to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Expand shorthand hex
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Helper: Lighten hex color
 */
function lightenHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `#${hex}`;

  const factor = percent / 100;
  const r = Math.round(rgb.r + (255 - rgb.r) * factor);
  const g = Math.round(rgb.g + (255 - rgb.g) * factor);
  const b = Math.round(rgb.b + (255 - rgb.b) * factor);

  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Helper: Darken hex color
 */
function darkenHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `#${hex}`;

  const factor = 1 - (percent / 100);
  const r = Math.round(rgb.r * factor);
  const g = Math.round(rgb.g * factor);
  const b = Math.round(rgb.b * factor);

  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Helper: Check if color is light
 */
function isLightColor(color: string): boolean {
  if (color.startsWith('#')) {
    return getHexLightness(color.substring(1)) > 60;
  }

  // Handle rgb() format
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
    return lightness > 0.6;
  }

  return false;
}

/**
 * Helper: Darken any color format
 */
function darkenColor(color: string): string {
  if (color.startsWith('#')) {
    return darkenHex(color.substring(1), 70);
  }

  // Handle rgb() format
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    const factor = 0.3;
    return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
  }

  return color;
}

/**
 * Helper: Escape regex special characters
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}