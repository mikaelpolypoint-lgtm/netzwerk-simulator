// HTTP/1.1 als echter Text, damit Lernende Anfrage und Antwort in der
// Paketansicht lesen können. Vereinfachung: Content-Length zählt Zeichen.

import type { WebFile } from '../model/types';
import { isValidName, normalizeName } from './dns';
import { parseIp } from './ipv4';

export interface Url {
  host: string;
  port: number;
  path: string;
}

export type UrlError = 'invalidUrl' | 'httpsUnsupported';

/** Versteht "http://webserver1/index.html", "webserver1/seite.html" und "192.168.0.10". */
export function parseUrl(text: string): Url | UrlError {
  let rest = text.trim();
  const scheme = /^([a-z]+):\/\//i.exec(rest);
  if (scheme) {
    if (scheme[1]!.toLowerCase() === 'https') return 'httpsUnsupported';
    if (scheme[1]!.toLowerCase() !== 'http') return 'invalidUrl';
    rest = rest.slice(scheme[0].length);
  }
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? '/' : rest.slice(slash);
  const [hostText = '', portText] = authority.split(':');
  const host = normalizeName(hostText);
  if (!host || (parseIp(host) === null && !isValidName(host))) return 'invalidUrl';
  const port = portText === undefined ? 80 : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'invalidUrl';
  if (!/^\/[\x21-\x7e]*$/.test(path)) return 'invalidUrl';
  return { host, port, path };
}

export function formatUrl(url: Url): string {
  return `http://${url.host}${url.port === 80 ? '' : `:${url.port}`}${url.path}`;
}

/** Relativer Link (z.B. aus einer Seite) zur absoluten URL, ausgehend von `base`. */
export function resolveLink(base: Url, href: string): Url | UrlError {
  if (/^[a-z]+:\/\//i.test(href)) return parseUrl(href);
  if (href.startsWith('/')) return { ...base, path: href };
  const dir = base.path.slice(0, base.path.lastIndexOf('/') + 1);
  return { ...base, path: dir + href };
}

const CRLF = '\r\n';

export function buildRequest(url: Url): string {
  return [`GET ${url.path} HTTP/1.1`, `Host: ${url.host}`, 'User-Agent: Netzwerk-Simulator', 'Connection: close', '', ''].join(CRLF);
}

export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
}

function splitHead(text: string): { lines: string[]; body: string } | null {
  const end = text.indexOf(CRLF + CRLF);
  if (end < 0) return null;
  return { lines: text.slice(0, end).split(CRLF), body: text.slice(end + 4) };
}

function headers(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0) result[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return result;
}

/** Liefert die Anfrage, sobald sie vollständig empfangen ist, sonst null. */
export function parseRequest(text: string): HttpRequest | null {
  const head = splitHead(text);
  if (!head) return null;
  const [method = '', path = '/'] = (head.lines[0] ?? '').split(' ');
  return { method, path, headers: headers(head.lines.slice(1)) };
}

export const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
};

export function buildResponse(status: number, body: string): string {
  return [
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ''}`,
    'Server: Netzwerk-Simulator',
    'Content-Type: text/html; charset=utf-8',
    `Content-Length: ${body.length}`,
    'Connection: close',
    '',
    body,
  ].join(CRLF);
}

export interface HttpResponse {
  status: number;
  reason: string;
  headers: Record<string, string>;
  body: string;
}

/** Liefert die Antwort, sobald Kopf und (laut Content-Length) der ganze Inhalt da sind. */
export function parseResponse(text: string, complete = false): HttpResponse | null {
  const head = splitHead(text);
  if (!head) return null;
  const [, statusText = '0', ...reason] = (head.lines[0] ?? '').split(' ');
  const h = headers(head.lines.slice(1));
  const length = h['content-length'] !== undefined ? Number(h['content-length']) : undefined;
  if (length !== undefined && head.body.length < length && !complete) return null;
  if (length === undefined && !complete) return null;
  return { status: Number(statusText), reason: reason.join(' '), headers: h, body: length === undefined ? head.body : head.body.slice(0, length) };
}

/** "/" bedeutet die Startseite "/index.html". */
export function normalizePath(path: string): string {
  const clean = path.split('?')[0] ?? '/';
  return clean === '/' || clean === '' ? '/index.html' : clean;
}

export function isValidPath(path: string): boolean {
  return /^\/[A-Za-z0-9._\-/]*$/.test(path) && !path.includes('//') && path.length <= 200;
}

/** Antwort des Webservers auf eine Anfrage; Fehlerseiten wie bei echten Servern auf Englisch. */
export function serve(files: readonly WebFile[], request: HttpRequest): { status: number; body: string } {
  if (request.method !== 'GET') return { status: 405, body: '<h1>405 Method Not Allowed</h1>' };
  const path = normalizePath(request.path);
  const file = files.find((f) => f.path === path);
  if (file) return { status: 200, body: file.content };
  return { status: 404, body: `<h1>404 Not Found</h1><p>The requested URL ${path} was not found on this server.</p>` };
}
