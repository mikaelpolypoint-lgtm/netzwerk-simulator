// E-Mail: SMTP zum Versenden (auch zwischen Servern über MX-Einträge),
// POP3 und IMAP zum Abholen. Alle Protokolle laufen als echter Text über
// TCP, damit der Dialog in der Paketliste mitgelesen werden kann.

import { parseIp } from '../net/ipv4';
import { dotStuff, dotUnstuff, formatAddress, formatMessage, parseAddress, parseMessage, type MailMessage } from '../net/mail';
import type { DnsResolver } from './dns';
import { IMAP_PORT, POP3_PORT, SMTP_PORT } from './frames';
import type { NodeContext } from './simulation';
import type { TcpConnection, TcpStack } from './tcp';

const CRLF = '\r\n';

export interface StoredMail {
  id: number;
  raw: string;
  received: number;
}

export interface ReceivedMail extends MailMessage {
  id: string;
  received: number;
}

export interface MailStep {
  time: number;
  code: string;
  params?: Record<string, string | number>;
}

export interface MailClientState {
  steps: MailStep[];
  inbox: ReceivedMail[];
  sent: (MailMessage & { time: number; ok: boolean })[];
  busy: boolean;
}

export interface MailHost {
  readonly ctx: NodeContext;
  readonly tcp: TcpStack;
  readonly resolver: DnsResolver;
}

type Report = (code: string, params?: MailStep['params']) => void;

/** Sammelt TCP-Daten und liefert vollständige Zeilen. */
class Lines {
  #buffer = '';

  push(data: string): string[] {
    this.#buffer += data;
    const lines: string[] = [];
    for (let end = this.#buffer.indexOf(CRLF); end >= 0; end = this.#buffer.indexOf(CRLF)) {
      lines.push(this.#buffer.slice(0, end));
      this.#buffer = this.#buffer.slice(end + 2);
    }
    return lines;
  }
}

/** Name oder IP des Servers auflösen; bei Fehlern meldet `report`, und `next` wird nicht aufgerufen. */
function resolveHost(host: MailHost, name: string, report: Report, next: (ip: string) => void, fail: () => void) {
  if (parseIp(name) !== null) return next(name);
  report('mail.resolve', { host: name });
  host.resolver.resolve(name, 'A', (result) => {
    if (!result.ok) {
      report(`mail.dns.${result.error}`, { host: name, server: result.server });
      return fail();
    }
    const ip = result.records[0]!.value;
    report('mail.resolved', { host: name, ip });
    next(ip);
  });
}

// --- SMTP-Client ------------------------------------------------------------

interface Envelope {
  helo: string;
  from: string;
  to: string[];
  raw: string;
}

/**
 * Sendet eine Nachricht per SMTP: HELO, MAIL FROM, RCPT TO, DATA, QUIT.
 * `done` erhält die angenommenen Empfänger (leer = nichts zugestellt).
 */
export function smtpSend(host: MailHost, ip: string, envelope: Envelope, report: Report, done: (accepted: string[]) => void) {
  const lines = new Lines();
  const accepted: string[] = [];
  let pending = [...envelope.to];
  let stage: 'greeting' | 'helo' | 'from' | 'rcpt' | 'data' | 'body' | 'quit' | 'done' = 'greeting';
  let finished = false;
  const finish = (result: string[]) => {
    if (finished) return;
    finished = true;
    done(result);
  };
  const send = (conn: TcpConnection, line: string) => {
    report('mail.dialog', { dir: 'C', line });
    conn.write(line + CRLF);
  };

  report('mail.connect', { ip, port: SMTP_PORT, protocol: 'SMTP' });
  const conn = host.tcp.connect(ip, SMTP_PORT, {
    onData: (c, data) => {
      for (const line of lines.push(data)) {
        report('mail.dialog', { dir: 'S', line });
        const code = Number(line.slice(0, 3));
        if (line[3] === '-') continue; // mehrzeilige Antwort, weiter lesen
        if (stage === 'greeting' && code === 220) {
          stage = 'helo';
          send(c, `HELO ${envelope.helo}`);
        } else if (stage === 'helo' && code === 250) {
          stage = 'from';
          send(c, `MAIL FROM:<${envelope.from}>`);
        } else if (stage === 'from' && code === 250) {
          stage = 'rcpt';
          send(c, `RCPT TO:<${pending[0]}>`);
        } else if (stage === 'rcpt') {
          const current = pending.shift()!;
          if (code === 250) accepted.push(current);
          if (pending.length) send(c, `RCPT TO:<${pending[0]}>`);
          else if (accepted.length) {
            stage = 'data';
            send(c, 'DATA');
          } else {
            stage = 'quit';
            send(c, 'QUIT');
          }
        } else if (stage === 'data' && code === 354) {
          stage = 'body';
          report('mail.dialog', { dir: 'C', line: `(${envelope.raw.length} Zeichen Nachricht)` });
          c.write(dotStuff(envelope.raw) + CRLF + '.' + CRLF);
        } else if (stage === 'body') {
          if (code !== 250) accepted.length = 0;
          stage = 'quit';
          send(c, 'QUIT');
        } else if (stage === 'quit') {
          stage = 'done';
          c.close();
          finish(accepted);
        } else {
          // Unerwartete Antwort: abbrechen.
          stage = 'quit';
          accepted.length = 0;
          pending = [];
          send(c, 'QUIT');
        }
      }
    },
    onEnd: (c) => {
      c.close();
      finish(stage === 'done' ? accepted : []);
    },
    onError: (_c, error) => {
      report(`mail.tcp.${error}`, { ip, port: SMTP_PORT });
      finish([]);
    },
  });
  if (!conn) {
    report('mail.noAddress');
    finish([]);
  }
}

// --- Mailserver ---------------------------------------------------------------

/** Mailserver-Dienst: SMTP (25), POP3 (110) und IMAP (143) mit Postfächern im Arbeitsspeicher. */
export class MailServer {
  #boxes = new Map<string, StoredMail[]>();
  #nextId = 1;

  constructor(private readonly host: MailHost) {
    host.tcp.listen(SMTP_PORT, () => (this.#config ? this.#smtpSession() : null));
    host.tcp.listen(POP3_PORT, () => (this.#config ? this.#pop3Session() : null));
    host.tcp.listen(IMAP_PORT, () => (this.#config ? this.#imapSession() : null));
  }

  get #config() {
    return this.host.ctx.device()?.mailServer;
  }

  get #ctx() {
    return this.host.ctx;
  }

  /** Anzahl Nachrichten je Postfach, für die Server-Ansicht. */
  mailboxes(): { user: string; count: number }[] {
    return (this.#config?.mailboxes ?? []).map((m) => ({ user: m.user, count: this.#boxes.get(m.user)?.length ?? 0 }));
  }

  #store(user: string, raw: string) {
    const box = this.#boxes.get(user) ?? [];
    box.push({ id: this.#nextId++, raw, received: this.#ctx.now });
    this.#boxes.set(user, box);
  }

  #authenticate(user: string, password: string): boolean {
    return !!this.#config?.mailboxes.some((m) => m.user === user.toLowerCase() && m.password === password);
  }

  #smtpSession() {
    const lines = new Lines();
    let from = '';
    let recipients: string[] = [];
    let data: string[] | null = null;
    const domain = () => this.#config?.domain ?? '';
    const reply = (conn: TcpConnection, line: string) => conn.write(line + CRLF);

    return {
      onOpen: (conn: TcpConnection) => reply(conn, `220 ${domain()} ESMTP leyoNET`),
      onData: (conn: TcpConnection, chunk: string) => {
        for (const line of lines.push(chunk)) {
          if (data) {
            if (line !== '.') {
              data.push(line);
              continue;
            }
            const raw = dotUnstuff(data);
            data = null;
            this.#accept(from, recipients, raw, conn.remote.ip);
            reply(conn, '250 OK: Nachricht angenommen');
            continue;
          }
          const command = line.slice(0, 4).toUpperCase();
          const argument = /<([^>]*)>/.exec(line)?.[1] ?? '';
          if (command === 'HELO' || command === 'EHLO') reply(conn, `250 ${domain()}`);
          else if (command === 'MAIL') {
            from = argument.toLowerCase();
            recipients = [];
            reply(conn, '250 OK');
          } else if (command === 'RCPT') {
            const address = parseAddress(argument);
            if (!address) reply(conn, '501 Ungültige Adresse');
            else if (address.domain === domain() && !this.#config?.mailboxes.some((m) => m.user === address.user)) {
              this.#ctx.print('smtp.unknownMailbox', { to: formatAddress(address) });
              reply(conn, '550 Postfach unbekannt');
            } else {
              recipients.push(formatAddress(address));
              reply(conn, address.domain === domain() ? '250 OK' : '250 OK: wird weitergeleitet');
            }
          } else if (command === 'DATA') {
            if (!recipients.length) reply(conn, '503 Zuerst RCPT TO');
            else {
              data = [];
              reply(conn, '354 Nachricht senden, Ende mit <CRLF>.<CRLF>');
            }
          } else if (command === 'QUIT') {
            reply(conn, '221 Auf Wiedersehen');
            conn.close();
          } else if (command === 'RSET') {
            from = '';
            recipients = [];
            reply(conn, '250 OK');
          } else if (command === 'NOOP') reply(conn, '250 OK');
          else reply(conn, '500 Befehl unbekannt');
        }
      },
      onEnd: (conn: TcpConnection) => conn.close(),
    };
  }

  /** Eigene Domain: ins Postfach; fremde Domain: per MX-Eintrag an deren Server weiterleiten. */
  #accept(from: string, recipients: string[], raw: string, client: string) {
    const own = this.#config?.domain;
    const foreign = new Map<string, string[]>();
    for (const rcpt of recipients) {
      const address = parseAddress(rcpt)!;
      if (address.domain === own) {
        this.#store(address.user, raw);
        this.#ctx.print('smtp.stored', { to: rcpt, from, client });
      } else foreign.set(address.domain, [...(foreign.get(address.domain) ?? []), rcpt]);
    }
    for (const [domain, to] of foreign) this.#relay(domain, from, to, raw);
  }

  #relay(domain: string, from: string, to: string[], raw: string) {
    // Der Server protokolliert nur den Verbindungsaufbau; Fehler landen in der Rückmeldung an den Absender.
    const report: Report = (code, params) => {
      if (code === 'mail.connect') this.#ctx.print('smtp.relayConnect', params);
    };
    const bounce = (reason: string) => {
      this.#ctx.print('smtp.relayFailed', { domain, to: to.join(', ') });
      const sender = parseAddress(from);
      if (!sender || sender.domain !== this.#config?.domain) return;
      const message = formatMessage({
        from: `MAILER-DAEMON@${this.#config?.domain}`,
        to: [from],
        subject: `Undelivered Mail: ${parseMessage(raw).subject}`,
        body: `Your message to ${to.join(', ')} could not be delivered.\r\nReason: ${reason}`,
      });
      this.#store(sender.user, message);
    };
    this.#ctx.print('smtp.relayStart', { domain, to: to.join(', ') });
    this.host.resolver.resolve(domain, 'MX', (mx) => {
      if (!mx.ok) return bounce(`no MX record for ${domain}`);
      const mailHost = mx.records[0]!.value;
      resolveHost(
        this.host,
        mailHost,
        report,
        (ip) =>
          smtpSend(this.host, ip, { helo: this.#config?.domain ?? 'localhost', from, to, raw }, report, (accepted) => {
            if (accepted.length) this.#ctx.print('smtp.relayed', { to: accepted.join(', '), server: mailHost });
            else bounce(`${mailHost} did not accept the message`);
          }),
        () => bounce(`cannot resolve ${mailHost}`),
      );
    });
  }

  #pop3Session() {
    const lines = new Lines();
    let user = '';
    let box: StoredMail[] | null = null;
    const deleted = new Set<number>();
    const reply = (conn: TcpConnection, line: string) => conn.write(line + CRLF);
    const message = (n: string) => (box ? box[Number(n) - 1] : undefined);

    return {
      onOpen: (conn: TcpConnection) => reply(conn, `+OK POP3 ${this.#config?.domain ?? ''} bereit`),
      onData: (conn: TcpConnection, chunk: string) => {
        for (const line of lines.push(chunk)) {
          const [command = '', arg = ''] = line.split(' ');
          const cmd = command.toUpperCase();
          if (cmd === 'USER') {
            user = arg.toLowerCase();
            reply(conn, '+OK');
          } else if (cmd === 'PASS') {
            if (!this.#authenticate(user, line.slice(5))) {
              this.#ctx.print('pop3.loginFailed', { user, client: conn.remote.ip });
              reply(conn, '-ERR Anmeldung fehlgeschlagen');
              continue;
            }
            box = this.#boxes.get(user) ?? [];
            this.#ctx.print('pop3.login', { user, client: conn.remote.ip, count: box.length });
            reply(conn, `+OK ${box.length} Nachrichten`);
          } else if (!box && cmd !== 'QUIT') {
            reply(conn, '-ERR Zuerst anmelden');
          } else if (cmd === 'STAT') {
            const live = box!.filter((m) => !deleted.has(m.id));
            reply(conn, `+OK ${live.length} ${live.reduce((n, m) => n + m.raw.length, 0)}`);
          } else if (cmd === 'RETR') {
            const mail = message(arg);
            if (!mail || deleted.has(mail.id)) reply(conn, '-ERR Keine solche Nachricht');
            else conn.write(`+OK ${mail.raw.length} Zeichen${CRLF}${dotStuff(mail.raw)}${CRLF}.${CRLF}`);
          } else if (cmd === 'DELE') {
            const mail = message(arg);
            if (!mail) reply(conn, '-ERR Keine solche Nachricht');
            else {
              deleted.add(mail.id);
              reply(conn, '+OK gelöscht');
            }
          } else if (cmd === 'QUIT') {
            // Erst beim Abmelden wird endgültig gelöscht (POP3 "Update"-Phase).
            if (box && deleted.size) this.#boxes.set(user, box.filter((m) => !deleted.has(m.id)));
            reply(conn, '+OK Auf Wiedersehen');
            conn.close();
          } else reply(conn, '-ERR Befehl unbekannt');
        }
      },
      onEnd: (conn: TcpConnection) => conn.close(),
    };
  }

  #imapSession() {
    const lines = new Lines();
    let user = '';
    let selected = false;
    const reply = (conn: TcpConnection, line: string) => conn.write(line + CRLF);

    return {
      onOpen: (conn: TcpConnection) => reply(conn, `* OK IMAP4 ${this.#config?.domain ?? ''} bereit`),
      onData: (conn: TcpConnection, chunk: string) => {
        for (const line of lines.push(chunk)) {
          const [tag = '*', command = '', ...args] = line.split(' ');
          const cmd = command.toUpperCase();
          if (cmd === 'LOGIN') {
            if (this.#authenticate(args[0] ?? '', args[1] ?? '')) {
              user = (args[0] ?? '').toLowerCase();
              this.#ctx.print('imap.login', { user, client: conn.remote.ip });
              reply(conn, `${tag} OK Angemeldet`);
            } else {
              this.#ctx.print('imap.loginFailed', { user: args[0] ?? '', client: conn.remote.ip });
              reply(conn, `${tag} NO Anmeldung fehlgeschlagen`);
            }
          } else if (!user && cmd !== 'LOGOUT') {
            reply(conn, `${tag} NO Zuerst anmelden`);
          } else if (cmd === 'SELECT') {
            selected = true;
            reply(conn, `* ${this.#boxes.get(user)?.length ?? 0} EXISTS`);
            reply(conn, `${tag} OK [READ-WRITE] SELECT abgeschlossen`);
          } else if (cmd === 'FETCH' && selected) {
            // Bei IMAP bleiben die Nachrichten auf dem Server; Literale {n} kündigen n Zeichen an.
            (this.#boxes.get(user) ?? []).forEach((mail, i) => {
              conn.write(`* ${i + 1} FETCH (BODY[] {${mail.raw.length}}${CRLF}${mail.raw})${CRLF}`);
            });
            reply(conn, `${tag} OK FETCH abgeschlossen`);
          } else if (cmd === 'LOGOUT') {
            reply(conn, '* BYE');
            reply(conn, `${tag} OK LOGOUT abgeschlossen`);
            conn.close();
          } else reply(conn, `${tag} BAD Befehl unbekannt`);
        }
      },
      onEnd: (conn: TcpConnection) => conn.close(),
    };
  }
}

// --- E-Mail-Programm ----------------------------------------------------------

/** Anwendung "E-Mail" auf einem Endgerät: Senden per SMTP, Abholen per POP3 oder IMAP. */
export class MailClient {
  state: MailClientState = { steps: [], inbox: [], sent: [], busy: false };

  constructor(private readonly host: MailHost) {}

  get #ctx() {
    return this.host.ctx;
  }

  #report: Report = (code, params) => {
    this.state.steps.push({ time: this.#ctx.now, code, ...(params ? { params } : {}) });
    if (this.state.steps.length > 300) this.state.steps.splice(0, this.state.steps.length - 300);
  };

  #done() {
    this.state.busy = false;
  }

  send(message: Omit<MailMessage, 'from'>) {
    const account = this.#ctx.device()?.mailAccount;
    if (!account) return this.#report('mail.noAccount');
    const to = message.to.map((t) => parseAddress(t));
    if (!to.length || to.some((t) => !t)) return this.#report('mail.invalidRecipient', { to: message.to.join(', ') });
    const full: MailMessage = { ...message, from: account.address, to: to.map((t) => formatAddress(t!)) };
    this.state.busy = true;
    this.#report('mail.sendStart', { to: full.to.join(', ') });
    resolveHost(
      this.host,
      account.smtpServer,
      this.#report,
      (ip) =>
        smtpSend(
          this.host,
          ip,
          { helo: this.#ctx.device()?.name.replace(/\s+/g, '-').toLowerCase() ?? 'client', from: full.from, to: full.to, raw: formatMessage(full) },
          this.#report,
          (accepted) => {
            const ok = accepted.length > 0;
            this.state.sent.push({ ...full, time: this.#ctx.now, ok });
            this.#report(ok ? 'mail.sent' : 'mail.notSent', { to: (ok ? accepted : full.to).join(', ') });
            this.#done();
          },
        ),
      () => this.#done(),
    );
  }

  fetch() {
    const account = this.#ctx.device()?.mailAccount;
    if (!account) return this.#report('mail.noAccount');
    const user = parseAddress(account.address)?.user ?? '';
    this.state.busy = true;
    this.#report('mail.fetchStart', { protocol: account.protocol.toUpperCase() });
    resolveHost(
      this.host,
      account.incomingServer,
      this.#report,
      (ip) => (account.protocol === 'imap' ? this.#imap(ip, user, account.password) : this.#pop3(ip, user, account.password)),
      () => this.#done(),
    );
  }

  #receive(raw: string, prefix: string) {
    const message = parseMessage(raw);
    this.state.inbox.push({ ...message, id: `${prefix}-${this.state.inbox.length + 1}`, received: this.#ctx.now });
  }

  #pop3(ip: string, user: string, password: string) {
    const lines = new Lines();
    let stage: 'greeting' | 'user' | 'pass' | 'stat' | 'retr' | 'dele' | 'quit' = 'greeting';
    let count = 0;
    let current = 0;
    let body: string[] | null = null;
    let received = 0;
    const send = (conn: TcpConnection, line: string, shown = line) => {
      this.#report('mail.dialog', { dir: 'C', line: shown });
      conn.write(line + CRLF);
    };
    const next = (conn: TcpConnection) => {
      current++;
      if (current <= count) {
        stage = 'retr';
        send(conn, `RETR ${current}`);
      } else {
        stage = 'quit';
        send(conn, 'QUIT');
      }
    };

    this.#report('mail.connect', { ip, port: POP3_PORT, protocol: 'POP3' });
    const conn = this.host.tcp.connect(ip, POP3_PORT, {
      onData: (c, data) => {
        for (const line of lines.push(data)) {
          if (body) {
            if (line === '.') {
              this.#receive(dotUnstuff(body), 'pop3');
              received++;
              body = null;
              stage = 'dele';
              send(c, `DELE ${current}`);
            } else body.push(line);
            continue;
          }
          this.#report('mail.dialog', { dir: 'S', line });
          const ok = line.startsWith('+OK');
          if (!ok) {
            this.#report('mail.serverError', { line });
            stage = 'quit';
            send(c, 'QUIT');
            continue;
          }
          if (stage === 'greeting') {
            stage = 'user';
            send(c, `USER ${user}`);
          } else if (stage === 'user') {
            stage = 'pass';
            send(c, `PASS ${password}`, 'PASS ********');
          } else if (stage === 'pass') {
            stage = 'stat';
            send(c, 'STAT');
          } else if (stage === 'stat') {
            count = Number(line.split(' ')[1] ?? 0);
            next(c);
          } else if (stage === 'retr') {
            body = [];
          } else if (stage === 'dele') {
            next(c);
          } else if (stage === 'quit') {
            c.close();
          }
        }
      },
      onEnd: (c) => {
        c.close();
        this.#report('mail.fetched', { count: received });
        this.#done();
      },
      onError: (_c, error) => {
        this.#report(`mail.tcp.${error}`, { ip, port: POP3_PORT });
        this.#done();
      },
    });
    if (!conn) {
      this.#report('mail.noAddress');
      this.#done();
    }
  }

  #imap(ip: string, user: string, password: string) {
    let buffer = '';
    let stage: 'greeting' | 'login' | 'select' | 'fetch' | 'logout' = 'greeting';
    let exists = 0;
    const send = (conn: TcpConnection, line: string, shown = line) => {
      this.#report('mail.dialog', { dir: 'C', line: shown });
      conn.write(line + CRLF);
    };
    /** Entfernt eine vollständige Antwort bis zur Zeile, die mit `marker` beginnt. */
    const take = (marker: string): string | null => {
      const start = buffer.startsWith(marker) ? 0 : buffer.indexOf(CRLF + marker);
      if (start < 0) return null;
      const end = buffer.indexOf(CRLF, start + (start === 0 ? 0 : 2));
      if (end < 0) return null;
      const text = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return text;
    };
    const status = (text: string, tag: string) => text.split(CRLF).find((l) => l.startsWith(`${tag} `)) ?? '';

    this.#report('mail.connect', { ip, port: IMAP_PORT, protocol: 'IMAP' });
    const conn = this.host.tcp.connect(ip, IMAP_PORT, {
      onData: (c, data) => {
        buffer += data;
        for (let progressed = true; progressed; ) {
          progressed = false;
          if (stage === 'greeting') {
            const text = take('* OK');
            if (text === null) break;
            this.#report('mail.dialog', { dir: 'S', line: text });
            stage = 'login';
            send(c, `a1 LOGIN ${user} ${password}`, `a1 LOGIN ${user} ********`);
            progressed = true;
          } else if (stage === 'login') {
            const text = take('a1 ');
            if (text === null) break;
            this.#report('mail.dialog', { dir: 'S', line: status(text, 'a1') });
            if (!status(text, 'a1').startsWith('a1 OK')) {
              this.#report('mail.serverError', { line: status(text, 'a1') });
              stage = 'logout';
              send(c, 'a4 LOGOUT');
            } else {
              stage = 'select';
              send(c, 'a2 SELECT INBOX');
            }
            progressed = true;
          } else if (stage === 'select') {
            const text = take('a2 ');
            if (text === null) break;
            exists = Number(/\* (\d+) EXISTS/.exec(text)?.[1] ?? 0);
            for (const line of text.split(CRLF)) this.#report('mail.dialog', { dir: 'S', line });
            if (exists > 0) {
              stage = 'fetch';
              send(c, `a3 FETCH 1:${exists} BODY[]`);
            } else {
              stage = 'logout';
              send(c, 'a4 LOGOUT');
            }
            progressed = true;
          } else if (stage === 'fetch') {
            const text = take('a3 ');
            if (text === null) break;
            // Literale lesen: "* n FETCH (BODY[] {Länge}" gefolgt von genau so vielen Zeichen.
            this.state.inbox = this.state.inbox.filter((m) => !m.id.startsWith('imap-'));
            const literal = /\* (\d+) FETCH \(BODY\[\] \{(\d+)\}\r\n/g;
            for (let match = literal.exec(text); match; match = literal.exec(text)) {
              const start = match.index + match[0].length;
              const raw = text.slice(start, start + Number(match[2]));
              this.#report('mail.dialog', { dir: 'S', line: `* ${match[1]} FETCH (BODY[] {${match[2]}} …)` });
              this.#receive(raw, 'imap');
            }
            this.#report('mail.dialog', { dir: 'S', line: status(text, 'a3') });
            stage = 'logout';
            send(c, 'a4 LOGOUT');
            progressed = true;
          } else {
            const text = take('a4 ');
            if (text === null) break;
            for (const line of text.split(CRLF)) this.#report('mail.dialog', { dir: 'S', line });
            c.close();
            progressed = true;
          }
        }
      },
      onEnd: (c) => {
        c.close();
        this.#report('mail.fetched', { count: this.state.inbox.filter((m) => m.id.startsWith('imap-')).length });
        this.#done();
      },
      onError: (_c, error) => {
        this.#report(`mail.tcp.${error}`, { ip, port: IMAP_PORT });
        this.#done();
      },
    });
    if (!conn) {
      this.#report('mail.noAddress');
      this.#done();
    }
  }
}
