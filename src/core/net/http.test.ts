import { describe, expect, it } from 'vitest';
import { imagePaths, buildRequest, buildResponse, formatUrl, parseRequest, parseResponse, parseUrl, resolveLink, serve } from './http';
import { isValidName, normalizeName } from './dns';

describe('URLs', () => {
  it('versteht verschiedene Schreibweisen', () => {
    expect(parseUrl('http://Webserver1/index.html')).toEqual({ host: 'webserver1', port: 80, path: '/index.html' });
    expect(parseUrl('webserver1')).toEqual({ host: 'webserver1', port: 80, path: '/' });
    expect(parseUrl('192.168.0.3:8080/a/b.html')).toEqual({ host: '192.168.0.3', port: 8080, path: '/a/b.html' });
    expect(parseUrl('https://x/')).toBe('httpsUnsupported');
    expect(parseUrl('ftp://x/')).toBe('invalidUrl');
    expect(parseUrl('http://a b/')).toBe('invalidUrl');
    expect(formatUrl({ host: 'w', port: 80, path: '/' })).toBe('http://w/');
  });

  it('löst relative Links auf', () => {
    const base = { host: 'w', port: 80, path: '/docs/seite.html' };
    expect(resolveLink(base, 'andere.html')).toEqual({ ...base, path: '/docs/andere.html' });
    expect(resolveLink(base, '/index.html')).toEqual({ ...base, path: '/index.html' });
    expect(resolveLink(base, 'http://x/y.html')).toEqual({ host: 'x', port: 80, path: '/y.html' });
  });
});

describe('HTTP-Nachrichten', () => {
  it('erzeugt und liest Anfrage und Antwort als Text', () => {
    const request = buildRequest({ host: 'w', port: 80, path: '/a.html' });
    expect(request.startsWith('GET /a.html HTTP/1.1\r\nHost: w\r\n')).toBe(true);
    expect(parseRequest(request)).toMatchObject({ method: 'GET', path: '/a.html', headers: { host: 'w' } });
    expect(parseRequest('GET / HTTP/1.1\r\n')).toBeNull();

    const response = buildResponse(200, '<p>ä</p>');
    expect(parseResponse(response)).toMatchObject({ status: 200, reason: 'OK', body: '<p>ä</p>' });
    expect(parseResponse(response.slice(0, -3))).toBeNull();
  });

  it('liefert Seiten und Fehlerseiten aus', () => {
    const files = [{ path: '/index.html', content: 'start' }];
    expect(serve(files, { method: 'GET', path: '/', headers: {} })).toEqual({ status: 200, body: 'start', type: 'text/html; charset=utf-8' });
    expect(serve(files, { method: 'GET', path: '/x', headers: {} }).status).toBe(404);
    expect(serve(files, { method: 'POST', path: '/', headers: {} }).status).toBe(405);
  });

  it('Bilder: Bytes aus der data:-URL, Content-Length in Bytes, zurück als data:-URL', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const files = [{ path: '/logo.png', content: png }];
    const served = serve(files, { method: 'GET', path: '/logo.png', headers: {} });
    expect(served.type).toBe('image/png');
    expect(served.body.length).toBe(8);
    const response = parseResponse(buildResponse(200, served.body, served.type))!;
    expect(response.headers['content-length']).toBe('8');
    expect(response.dataUrl).toBe(png);
    // UTF-8: «ä» sind zwei Bytes.
    expect(parseResponse(buildResponse(200, 'ä'))!.headers['content-length']).toBe('2');
  });

  it('findet eingebundene Bilder', () => {
    expect(imagePaths('<img src="bild.jpg"><img alt="x" src="/a/logo.png"><img src="http://x/y.png">', '/index.html')).toEqual(['/bild.jpg', '/a/logo.png']);
  });
});

describe('DNS-Namen', () => {
  it('prüft und vereinheitlicht Hostnamen', () => {
    expect(normalizeName(' WWW.Schule.CH. ')).toBe('www.schule.ch');
    expect(isValidName('webserver-1.schule.ch')).toBe(true);
    expect(isValidName('-web')).toBe(false);
    expect(isValidName('web server')).toBe(false);
    expect(isValidName('')).toBe(false);
  });
});
