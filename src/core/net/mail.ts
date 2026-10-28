import type { MailAccount, MailServerConfig, Mailbox } from '../model/types';
import { isValidName, normalizeName } from './dns';
import { parseIp } from './ipv4';

export interface MailAddress {
  user: string;
  domain: string;
}

/** "Anna@Schule.CH" → { user: "anna", domain: "schule.ch" }. */
export function parseAddress(text: string): MailAddress | null {
  const match = /^([A-Za-z0-9._-]+)@([^@\s]+)$/.exec(text.trim());
  if (!match || !isValidName(match[2]!)) return null;
  return { user: match[1]!.toLowerCase(), domain: normalizeName(match[2]!) };
}

export const formatAddress = (a: MailAddress) => `${a.user}@${a.domain}`;

const isHost = (text: string) => parseIp(text.trim()) !== null || isValidName(text);

export interface MailIssue {
  code: string;
  field: string;
  params?: Record<string, string | number>;
}

export function checkMailbox(config: MailServerConfig, mailbox: Mailbox): MailIssue | null {
  if (!/^[a-z0-9._-]{1,32}$/.test(mailbox.user.trim().toLowerCase())) {
    return { code: 'invalidMailUser', field: 'user', params: { value: mailbox.user } };
  }
  if (!mailbox.password) return { code: 'passwordRequired', field: 'password' };
  if (config.mailboxes.some((m) => m.user === mailbox.user.trim().toLowerCase())) {
    return { code: 'duplicateMailbox', field: 'user', params: { user: mailbox.user.trim().toLowerCase() } };
  }
  return null;
}

export function checkMailAccount(account: MailAccount): MailIssue | null {
  if (!parseAddress(account.address)) return { code: 'invalidMailAddress', field: 'address', params: { value: account.address } };
  if (!account.password) return { code: 'passwordRequired', field: 'password' };
  if (!isHost(account.smtpServer)) return { code: 'invalidHost', field: 'smtpServer', params: { value: account.smtpServer } };
  if (!isHost(account.incomingServer)) {
    return { code: 'invalidHost', field: 'incomingServer', params: { value: account.incomingServer } };
  }
  return null;
}

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  body: string;
}

const CRLF = '\r\n';

/** Nachricht im Internet-Format: Kopfzeilen, Leerzeile, Text. */
export function formatMessage(message: MailMessage): string {
  return [`From: ${message.from}`, `To: ${message.to.join(', ')}`, `Subject: ${message.subject}`, '', message.body].join(CRLF);
}

export function parseMessage(raw: string): MailMessage {
  const end = raw.indexOf(CRLF + CRLF);
  const head = end < 0 ? raw : raw.slice(0, end);
  const body = end < 0 ? '' : raw.slice(end + 4);
  const header = (name: string) =>
    head
      .split(CRLF)
      .find((l) => l.toLowerCase().startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim() ?? '';
  return { from: header('from'), to: header('to').split(',').map((s) => s.trim()).filter(Boolean), subject: header('subject'), body };
}

/** SMTP/POP3: Zeilen, die mit "." beginnen, werden verdoppelt, damit "." allein das Ende markiert. */
export function dotStuff(raw: string): string {
  return raw
    .split(CRLF)
    .map((l) => (l.startsWith('.') ? `.${l}` : l))
    .join(CRLF);
}

export function dotUnstuff(lines: string[]): string {
  return lines.map((l) => (l.startsWith('..') ? l.slice(1) : l)).join(CRLF);
}
