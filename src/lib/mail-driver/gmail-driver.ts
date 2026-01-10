/**
 * Gmail Driver Implementation
 * 
 * Implements the MailDriver interface for Gmail/Google Workspace.
 * Wraps the existing gmail.ts functions to provide a unified API.
 * 
 * This abstraction enables future multi-provider support (e.g., Outlook).
 */

import {
  MailDriver,
  MailDriverConfig,
  MailProvider,
  MailLabel,
  ListParams,
  ListResult,
  OutgoingMessage,
  DraftData,
  ParsedDraft,
  ParsedThread,
  ParsedMessage,
  ParsedSender,
} from './types';
import {
  fetchInbox,
  fetchThread,
  sendEmail,
  archiveThread,
  moveToInbox,
  starThread,
  unstarThread,
  markAsRead,
  trashThread,
  createGmailDraft,
  updateGmailDraft,
  deleteGmailDraft,
  listGmailDrafts,
  getDraftForThread,
  getAttachment,
} from '../gmail';
import { EmailDraft, EmailThread, EmailMessage } from '@/types';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Gmail implementation of the MailDriver interface.
 */
export class GmailDriver implements MailDriver {
  readonly provider: MailProvider = 'google';
  readonly config: MailDriverConfig;
  private accessToken: string;

  constructor(config: MailDriverConfig) {
    this.config = config;
    this.accessToken = config.auth.accessToken;
  }

  // ============================================================================
  // THREAD OPERATIONS
  // ============================================================================

  async getThread(threadId: string): Promise<ParsedThread> {
    const thread = await fetchThread(this.accessToken, threadId);
    return this.convertThread(thread);
  }

  async listThreads(params: ListParams): Promise<ListResult> {
    // Map folder names to Gmail label IDs
    const folderToLabels: Record<string, string[]> = {
      inbox: ['INBOX'],
      sent: ['SENT'],
      starred: ['STARRED'],
      drafts: ['DRAFT'],
      trash: ['TRASH'],
      spam: ['SPAM'],
      all: [], // No filter for all mail
    };

    const labelIds = folderToLabels[params.folder] || [];
    
    const result = await fetchInbox(this.accessToken, {
      maxResults: params.maxResults || 20,
      pageToken: params.pageToken,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
      query: params.query,
    });

    return {
      threads: result.threads.map(t => ({ id: t.id, historyId: null })),
      nextPageToken: result.nextPageToken || null,
    };
  }

  async searchThreads(query: string, maxResults: number = 20): Promise<ListResult> {
    const result = await fetchInbox(this.accessToken, {
      maxResults,
      query,
    });

    return {
      threads: result.threads.map(t => ({ id: t.id, historyId: null })),
      nextPageToken: result.nextPageToken || null,
    };
  }

  // ============================================================================
  // MESSAGE OPERATIONS
  // ============================================================================

  async sendMessage(message: OutgoingMessage): Promise<{ id: string }> {
    const draft: EmailDraft = {
      to: message.to.map(r => r.email),
      cc: message.cc?.map(r => r.email),
      bcc: message.bcc?.map(r => r.email),
      subject: message.subject,
      body: message.body,
      type: message.threadId ? 'reply' : 'new',
      threadId: message.threadId,
      inReplyTo: message.inReplyTo,
      references: message.references,
    };

    await sendEmail(this.accessToken, draft);
    return { id: '' }; // Gmail doesn't return the new message ID from send
  }

  async markAsRead(threadIds: string[]): Promise<void> {
    await Promise.all(threadIds.map(id => markAsRead(this.accessToken, id)));
  }

  async markAsUnread(threadIds: string[]): Promise<void> {
    // Gmail API: add UNREAD label
    await Promise.all(threadIds.map(id => 
      this.modifyLabels([id], { addLabels: ['UNREAD'], removeLabels: [] })
    ));
  }

  async archiveThreads(threadIds: string[]): Promise<void> {
    await Promise.all(threadIds.map(id => archiveThread(this.accessToken, id)));
  }

  async trashThreads(threadIds: string[]): Promise<void> {
    await Promise.all(threadIds.map(id => trashThread(this.accessToken, id)));
  }

  async modifyLabels(threadIds: string[], options: {
    addLabels: string[];
    removeLabels: string[];
  }): Promise<void> {
    const requests = threadIds.map(threadId =>
      fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          addLabelIds: options.addLabels,
          removeLabelIds: options.removeLabels,
        }),
      })
    );

    await Promise.all(requests);
  }

  // ============================================================================
  // DRAFT OPERATIONS
  // ============================================================================

  async createDraft(data: DraftData): Promise<{ id: string }> {
    const draft: EmailDraft = {
      to: data.to.split(',').map(e => e.trim()),
      cc: data.cc?.split(',').map(e => e.trim()),
      bcc: data.bcc?.split(',').map(e => e.trim()),
      subject: data.subject,
      body: data.body,
      type: data.threadId ? 'reply' : 'new',
      threadId: data.threadId,
    };

    const id = await createGmailDraft(this.accessToken, draft);
    return { id };
  }

  async updateDraft(draftId: string, data: DraftData): Promise<{ id: string }> {
    const draft: EmailDraft = {
      to: data.to.split(',').map(e => e.trim()),
      cc: data.cc?.split(',').map(e => e.trim()),
      bcc: data.bcc?.split(',').map(e => e.trim()),
      subject: data.subject,
      body: data.body,
      type: data.threadId ? 'reply' : 'new',
      threadId: data.threadId,
    };

    const id = await updateGmailDraft(this.accessToken, draftId, draft);
    return { id };
  }

  async getDraft(draftId: string): Promise<ParsedDraft> {
    // Note: getDraftForThread expects a threadId, not draftId
    // For now, return minimal info from the drafts list
    const drafts = await listGmailDrafts(this.accessToken);
    const draft = drafts.find(d => d.id === draftId);
    
    if (!draft) {
      throw new Error(`Draft not found: ${draftId}`);
    }

    return {
      id: draft.id,
      threadId: draft.threadId,
      to: draft.to,
      subject: draft.subject,
    };
  }

  async listDrafts(maxResults: number = 50): Promise<ParsedDraft[]> {
    const drafts = await listGmailDrafts(this.accessToken);
    return drafts.slice(0, maxResults).map(d => ({
      id: d.id,
      threadId: d.threadId,
      to: d.to,
      subject: d.subject,
      createdAt: d.date,
    }));
  }

  async sendDraft(draftId: string, _message?: OutgoingMessage): Promise<{ id: string }> {
    // Use the drafts.send endpoint which sends and deletes the draft
    const response = await fetch(`${GMAIL_API_BASE}/drafts/${draftId}/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to send draft');
    }

    return { id: draftId };
  }

  async deleteDraft(draftId: string): Promise<void> {
    await deleteGmailDraft(this.accessToken, draftId);
  }

  // ============================================================================
  // ATTACHMENT OPERATIONS
  // ============================================================================

  async getAttachment(messageId: string, attachmentId: string): Promise<string> {
    return getAttachment(this.accessToken, messageId, attachmentId);
  }

  // ============================================================================
  // LABEL OPERATIONS
  // ============================================================================

  async getLabels(): Promise<MailLabel[]> {
    const response = await fetch(`${GMAIL_API_BASE}/labels`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch labels');
    }

    const data = await response.json();
    return (data.labels || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      type: l.type === 'system' ? 'system' : 'user',
      color: l.color ? {
        backgroundColor: l.color.backgroundColor,
        textColor: l.color.textColor,
      } : undefined,
      messageCount: l.messagesTotal,
    }));
  }

  async getLabel(labelId: string): Promise<MailLabel> {
    const response = await fetch(`${GMAIL_API_BASE}/labels/${labelId}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch label');
    }

    const l = await response.json();
    return {
      id: l.id,
      name: l.name,
      type: l.type === 'system' ? 'system' : 'user',
      color: l.color ? {
        backgroundColor: l.color.backgroundColor,
        textColor: l.color.textColor,
      } : undefined,
      messageCount: l.messagesTotal,
    };
  }

  async createLabel(name: string, color?: { backgroundColor: string; textColor: string }): Promise<MailLabel> {
    const response = await fetch(`${GMAIL_API_BASE}/labels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
        color,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create label');
    }

    const l = await response.json();
    return {
      id: l.id,
      name: l.name,
      type: 'user',
      color: l.color,
    };
  }

  async updateLabel(labelId: string, updates: { name?: string; color?: { backgroundColor: string; textColor: string } }): Promise<MailLabel> {
    const response = await fetch(`${GMAIL_API_BASE}/labels/${labelId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error('Failed to update label');
    }

    const l = await response.json();
    return {
      id: l.id,
      name: l.name,
      type: l.type === 'system' ? 'system' : 'user',
      color: l.color,
    };
  }

  async deleteLabel(labelId: string): Promise<void> {
    const response = await fetch(`${GMAIL_API_BASE}/labels/${labelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to delete label');
    }
  }

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  async getEmailAliases(): Promise<{ email: string; name?: string; primary?: boolean }[]> {
    // Gmail API: Get send-as aliases
    const response = await fetch(`${GMAIL_API_BASE}/settings/sendAs`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      // If we can't get aliases, return the primary email
      return [{ email: this.config.auth.email, primary: true }];
    }

    const data = await response.json();
    return (data.sendAs || []).map((alias: any) => ({
      email: alias.sendAsEmail,
      name: alias.displayName,
      primary: alias.isPrimary,
    }));
  }

  async getUnreadCount(): Promise<number> {
    const response = await fetch(`${GMAIL_API_BASE}/labels/INBOX`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to get unread count');
    }

    const data = await response.json();
    return data.messagesUnread || 0;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert EmailThread to ParsedThread format.
   */
  private convertThread(thread: EmailThread): ParsedThread {
    const messages: ParsedMessage[] = thread.messages.map(msg => this.convertMessage(msg));
    
    return {
      id: thread.id,
      messages,
      latest: messages[messages.length - 1],
      hasUnread: !thread.isRead,
      totalReplies: messages.length - 1,
      labels: thread.labels.map(id => ({ id, name: id })),
    };
  }

  /**
   * Convert EmailMessage to ParsedMessage format.
   */
  private convertMessage(msg: EmailMessage): ParsedMessage {
    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: msg.subject,
      sender: {
        name: msg.from.name || '',
        email: msg.from.email,
      },
      to: msg.to.map(t => ({
        name: t.name || '',
        email: t.email,
      })),
      cc: msg.cc?.map(c => ({
        name: c.name || '',
        email: c.email,
      })) || null,
      bcc: msg.bcc?.map(b => ({
        name: b.name || '',
        email: b.email,
      })) || null,
      receivedOn: msg.date,
      unread: !msg.isRead,
      body: msg.body,
      bodyHtml: msg.bodyHtml || '',
      snippet: msg.snippet,
      labels: msg.labels,
      messageId: msg.messageId,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      replyTo: msg.replyTo,
      listUnsubscribe: msg.listUnsubscribe,
      listUnsubscribePost: msg.listUnsubscribePost,
      tls: msg.tls ?? false,
      attachments: msg.attachments?.map(a => ({
        attachmentId: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
      isDraft: msg.labels.includes('DRAFT'),
    };
  }
}

/**
 * Factory function to create a mail driver based on provider.
 */
export function createMailDriver(config: MailDriverConfig): MailDriver {
  switch (config.provider) {
    case 'google':
      return new GmailDriver(config);
    case 'microsoft':
      throw new Error('Microsoft/Outlook driver not yet implemented');
    default:
      throw new Error(`Unknown mail provider: ${config.provider}`);
  }
}

/**
 * Helper to get a Gmail driver with just an access token.
 */
export function getGmailDriver(accessToken: string, email: string = ''): GmailDriver {
  return new GmailDriver({
    provider: 'google',
    auth: {
      accessToken,
      email,
    },
  });
}
