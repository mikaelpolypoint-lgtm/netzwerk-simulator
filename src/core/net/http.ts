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

/**
 * Antwort als «Binärtext» (ein Zeichen = ein Byte): Texte werden UTF-8-kodiert,
 * Bilder in ihren Bytes übertragen; Content-Length zählt Bytes wie bei echtem HTTP.
 */
export function buildResponse(status: number, body: string, contentType = 'text/html; charset=utf-8'): string {
  const bytes = contentType.startsWith('text/') || contentType.includes('svg') ? encodeUtf8(body) : body;
  return [
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ''}`,
    'Server: Netzwerk-Simulator',
    `Content-Type: ${contentType}`,
    `Content-Length: ${bytes.length}`,
    'Connection: close',
    '',
    bytes,
  ].join(CRLF);
}

export interface HttpResponse {
  status: number;
  reason: string;
  headers: Record<string, string>;
  /** Text der Antwort (bei Bildern leer). */
  body: string;
  /** Bilder: als data:-URL zum Anzeigen. */
  dataUrl?: string;
  /** Grösse des Inhalts in Bytes. */
  size: number;
}

/** Text → UTF-8 als Binärtext. */
export function encodeUtf8(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out += ch;
    else if (c < 0x800) out += String.fromCharCode(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out += String.fromCharCode(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** UTF-8-Binärtext → Text; ungültige Folgen bleiben als einzelne Zeichen stehen. */
export function decodeUtf8(bytes: string): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes.charCodeAt(i);
    const need = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0;
    if (need === 0 || i + need >= bytes.length) {
      out += String.fromCharCode(b);
      continue;
    }
    let c = b & (0x3f >> need);
    let valid = true;
    for (let k = 1; k <= need; k++) {
      const n = bytes.charCodeAt(i + k);
      if ((n & 0xc0) !== 0x80) valid = false;
      c = (c << 6) | (n & 0x3f);
    }
    if (!valid) {
      out += String.fromCharCode(b);
      continue;
    }
    out += String.fromCodePoint(c);
    i += need;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBinary(base64: string): string {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => B64.indexOf(clean[i + k] ?? 'A'));
    const v = (n[0]! << 18) | (n[1]! << 12) | (n[2]! << 6) | n[3]!;
    out += String.fromCharCode((v >> 16) & 255);
    if (clean[i + 2] !== undefined) out += String.fromCharCode((v >> 8) & 255);
    if (clean[i + 3] !== undefined) out += String.fromCharCode(v & 255);
  }
  return out;
}

export function binaryToBase64(binary: string): string {
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const v = (a << 16) | (b << 8) | c;
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + (i + 1 < binary.length ? B64[(v >> 6) & 63]! : '=') + (i + 2 < binary.length ? B64[v & 63]! : '=');
  }
  return out;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Bilder werden als data:-URL gespeichert; alles andere ist Text. */
export function isImageContent(content: string): boolean {
  return /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(content);
}

export function contentTypeOf(path: string, content: string): string {
  const fromData = /^data:([^;,]+)/.exec(content)?.[1];
  if (fromData && isImageContent(content)) return fromData;
  return TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'text/html; charset=utf-8';
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
  const bytes = length === undefined ? head.body : head.body.slice(0, length);
  const type = h['content-type'] ?? 'text/html';
  const image = type.startsWith('image/') && !type.includes('svg');
  return {
    status: Number(statusText),
    reason: reason.join(' '),
    headers: h,
    body: image ? '' : decodeUtf8(bytes),
    size: bytes.length,
    ...(type.startsWith('image/') ? { dataUrl: `data:${type.split(';')[0]};base64,${binaryToBase64(bytes)}` } : {}),
  };
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
export function serve(files: readonly WebFile[], request: HttpRequest): { status: number; body: string; type: string } {
  const html = 'text/html; charset=utf-8';
  if (request.method !== 'GET') return { status: 405, body: '<h1>405 Method Not Allowed</h1>', type: html };
  const path = normalizePath(request.path);
  const file = files.find((f) => f.path === path);
  if (file) {
    const type = contentTypeOf(file.path, file.content);
    // Bilder: Bytes aus der data:-URL (SVG ist Text und wird UTF-8-kodiert).
    if (isImageContent(file.content)) {
      const binary = base64ToBinary(file.content.slice(file.content.indexOf(',') + 1));
      return { status: 200, body: type.includes('svg') ? decodeUtf8(binary) : binary, type };
    }
    return { status: 200, body: file.content, type };
  }
  return { status: 404, body: `<h1>404 Not Found</h1><p>The requested URL ${path} was not found on this server.</p>`, type: html };
}

/** Bilder, die eine Seite einbindet (<img src="…">), als Pfade auf demselben Server. */
export function imagePaths(html: string, base: string): string[] {
  const paths = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const src = m[1]!;
    if (/^[a-z]+:/i.test(src) || src.startsWith('//')) continue;
    const dir = base.slice(0, base.lastIndexOf('/') + 1) || '/';
    const path = src.startsWith('/') ? src : `${dir}${src}`;
    if (isValidPath(path)) paths.add(path);
  }
  return [...paths].slice(0, 4);
}
