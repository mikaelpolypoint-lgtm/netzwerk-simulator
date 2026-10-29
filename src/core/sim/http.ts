import { parseIp } from '../net/ipv4';
import { buildRequest, buildResponse, decodeUtf8, formatUrl, imagePaths, parseRequest, parseResponse, parseUrl, serve, type HttpResponse, type Url as ParsedUrl } from '../net/http';
import type { DnsResolver } from './dns';
import { HTTP_PORT } from './frames';
import type { NodeContext } from './simulation';
import type { TcpStack } from './tcp';

/** Ein Schritt beim Laden einer Seite; die Oberfläche übersetzt Code und Parameter. */
export interface BrowserStep {
  time: number;
  code: string;
  params?: Record<string, string | number>;
}

export interface BrowserState {
  url: string;
  status: 'loading' | 'done' | 'error';
  steps: BrowserStep[];
  response?: HttpResponse;
  /** Vollständige Antwort als Text, für die Quelltext-Ansicht. */
  raw?: string;
  /** Nachgeladene Bilder der Seite: Pfad → data:-URL. */
  images?: Record<string, string>;
}

interface HttpHost {
  readonly ctx: NodeContext;
  readonly resolver: DnsResolver;
  readonly tcp: TcpStack;
}

/**
 * Webbrowser: Name per DNS auflösen, TCP-Verbindung zu Port 80 aufbauen,
 * GET senden, Antwort lesen, bis der Server die Verbindung schliesst.
 */
export class HttpClient {
  state: BrowserState | null = null;
  #run = 0;

  constructor(private readonly host: HttpHost) {}

  #step(code: string, params?: BrowserStep['params']) {
    this.state?.steps.push({ time: this.host.ctx.now, code, ...(params ? { params } : {}) });
  }

  #fail(code: string, params?: BrowserStep['params']) {
    this.#step(code, params);
    if (this.state) this.state.status = 'error';
  }

  #loadImages(ip: string, url: ParsedUrl, paths: string[], run: number) {
    loadImagesImpl(this, this.host, ip, url, paths, () => run === this.#run);
  }

  get(urlText: string) {
    const run = ++this.#run;
    const url = parseUrl(urlText);
    if (typeof url === 'string') {
      this.state = { url: urlText.trim(), status: 'error', steps: [] };
      this.#fail(`browser.${url}`, { url: urlText.trim() });
      return;
    }
    this.state = { url: formatUrl(url), status: 'loading', steps: [] };
    const current = () => run === this.#run;

    const connect = (ip: string) => {
      this.#step('browser.connect', { ip, port: url.port });
      let buffer = '';
      let complete = false;
      const finishWith = (response: HttpResponse) => {
        complete = true;
        if (!current() || !this.state) return;
        this.state.response = response;
        // Quelltext lesbar: Kopf und Text dekodiert, Bilder nur mit Grösse.
        this.state.raw = response.dataUrl ? `${buffer.slice(0, buffer.indexOf('\r\n\r\n'))}\r\n\r\n[${response.size} Bytes]` : decodeUtf8(buffer);
        this.#step('browser.response', { status: response.status, reason: response.reason, size: response.size });
        // Eingebundene Bilder wie ein echter Browser mit eigenen Anfragen nachladen.
        const images = response.status === 200 && !response.dataUrl ? imagePaths(response.body, url.path) : [];
        if (images.length) this.#loadImages(ip, url, images, run);
        else this.state.status = 'done';
      };
      const conn = this.host.tcp.connect(ip, url.port, {
        onOpen: (c) => {
          if (!current()) return c.close();
          this.#step('browser.connected', { ip, port: url.port, localPort: c.local.port });
          this.#step('browser.request', { path: url.path, host: url.host });
          c.write(buildRequest(url));
        },
        onData: (_c, data) => {
          buffer += data;
          const response = parseResponse(buffer);
          if (response && !complete) finishWith(response);
        },
        onEnd: (c) => {
          if (!complete) {
            const response = parseResponse(buffer, true);
            if (response) finishWith(response);
            else if (current()) this.#fail('browser.incomplete');
          }
          c.close();
        },
        onClose: () => {
          if (current()) this.#step('browser.closed');
        },
        onError: (_c, error) => {
          if (current() && !complete) this.#fail(`browser.tcp.${error}`, { ip, port: url.port });
        },
      });
      if (!conn) this.#fail('browser.noAddress');
    };

    if (parseIp(url.host) !== null) return connect(url.host);
    this.#step('browser.resolve', { host: url.host });
    this.host.resolver.resolve(url.host, 'A', (result) => {
      if (!current()) return;
      if (!result.ok) return this.#fail(`browser.dns.${result.error}`, { host: url.host, server: result.server });
      const ip = result.records[0]!.value;
      this.#step(result.cached ? 'browser.resolvedCached' : 'browser.resolved', { host: url.host, ip, server: result.server });
      connect(ip);
    });
  }
}

/** Bilder einer Seite nacheinander laden, je mit eigener TCP-Verbindung (HTTP/1.1 mit «Connection: close»). */
function loadImagesImpl(client: HttpClient, host: HttpHost, ip: string, url: ParsedUrl, paths: string[], isCurrent: () => boolean) {
  const state = client.state;
  if (!state) return;
  state.images = {};
  const next = (i: number) => {
    if (!isCurrent()) return;
    const path = paths[i];
    if (path === undefined) {
      state.status = 'done';
      return;
    }
    let buffer = '';
    let done = false;
    const finish = (response: HttpResponse | null) => {
      if (done) return;
      done = true;
      if (response?.dataUrl && state.images) state.images[path] = response.dataUrl;
      state.steps.push({ time: host.ctx.now, code: 'browser.image', params: { path, status: response?.status ?? 0, size: response?.size ?? 0 } });
      next(i + 1);
    };
    const conn = host.tcp.connect(ip, url.port, {
      onOpen: (c) => c.write(buildRequest({ ...url, path })),
      onData: (_c, data) => {
        buffer += data;
        const response = parseResponse(buffer);
        if (response) finish(response);
      },
      onEnd: (c) => {
        finish(parseResponse(buffer, true));
        c.close();
      },
      onError: () => finish(null),
    });
    if (!conn) finish(null);
  };
  next(0);
}

/** Webserver-Dienst auf Port 80; liefert die konfigurierten Seiten aus. */
export class HttpServer {
  constructor(private readonly host: HttpHost) {
    host.tcp.listen(HTTP_PORT, () => {
      if (!this.host.ctx.device()?.webServer) return null;
      let buffer = '';
      let answered = false;
      return {
        onData: (conn, data) => {
          buffer += data;
          const request = parseRequest(buffer);
          const files = this.host.ctx.device()?.webServer?.files;
          if (!request || answered || !files) return;
          answered = true;
          const { status, body, type } = serve(files, request);
          this.host.ctx.print('http.request', { method: request.method, path: request.path, status, client: conn.remote.ip });
          conn.write(buildResponse(status, body, type));
          conn.close();
        },
        onEnd: (conn) => conn.close(),
      };
    });
  }
}
