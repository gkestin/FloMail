/**
 * Mail Driver Module
 * 
 * This module provides a unified interface for email providers.
 * Currently supports Gmail, with planned support for Outlook.
 * 
 * Usage:
 * ```typescript
 * import { createMailDriver, GmailDriver } from '@/lib/mail-driver';
 * 
 * // Create a driver
 * const driver = createMailDriver({
 *   provider: 'google',
 *   auth: { accessToken, email }
 * });
 * 
 * // Or use the Gmail driver directly
 * const gmailDriver = getGmailDriver(accessToken, email);
 * 
 * // Use the unified API
 * const threads = await driver.listThreads({ folder: 'inbox' });
 * ```
 */

// Types
export type {
  MailProvider,
  MailDriverConfig,
  MailDriver,
  MailLabel,
  ListParams,
  ListResult,
  ParsedThread,
  ParsedMessage,
  ParsedSender,
  ParsedAttachment,
  ParsedDraft,
  OutgoingMessage,
  OutgoingAttachment,
  DraftData,
  ListUnsubscribeAction,
} from './types';

// Gmail Driver
export { GmailDriver, createMailDriver, getGmailDriver } from './gmail-driver';
