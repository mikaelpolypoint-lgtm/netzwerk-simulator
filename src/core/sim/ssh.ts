/**
 * Vereinfachtes SSH über den simulierten TCP-Stack (Port 22).
 *
 * Wie beim echten Protokoll tauschen beide Seiten zuerst ihre Version im
 * Klartext aus; danach ist alles «verschlüsselt». Hier genügt eine einfache
 * Verschleierung, damit in der Paketliste wie bei echtem SSH keine
 * Passwörter oder Befehle lesbar sind. Die Befehle selbst führt die
 * Oberfläche mit der Befehlszeile des Zielgeräts aus; über das Netz gehen
 * die (verschlüsselten) Daten mit echten TCP-Segmenten.
 */
import type { IpNode } from './ip';
import type { NodeContext } from './simulation';
import type { TcpConnection, TcpStack } from './tcp';

export const SSH_PORT = 22;
const VERSION_SERVER = 'SSH-2.0-NetzSim_Server';
const VERSION_CLIENT = 'SSH-2.0-NetzSim_Client';

/** Zeichenweise Verschleierung mit wechselndem Schlüssel, als Hex-Text (4 Stellen pro Zeichen). */
export function seal(text: string): string {
  let key = 0x5a3c;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += ((text.charCodeAt(i) ^ key) & 0xffff).toString(16).padStart(4, '0');
    key = (key * 31 + 7) & 0xffff;
  }
  return out;
}

export function unseal(hex: string): string | null {
  if (!/^(?:[0-9a-f]{4})*$/.test(hex)) return null;
  let key = 0x5a3c;
  let out = '';
  for (let i = 0; i < hex.length; i += 4) {
    out += String.fromCharCode((parseInt(hex.slice(i, i + 4), 16) ^ key) & 0xffff);
    key = (key * 31 + 7) & 0xffff;
  }
  return out;
}

/** Zerlegt eingehende Daten in Zeilen (Segmente können Zeilen teilen). */
class LineReader {
  #buffer = '';
  push(data: string): string[] {
    this.#buffer += data;
    const parts = this.#buffer.split('\r\n');
    this.#buffer = parts.pop() ?? '';
    return parts;
  }
}

/** SSH-Dienst auf Routern und Layer-3-Switches. */
export function startSshServer(node: IpNode & { tcp: TcpStack }, ctx: NodeContext) {
  node.tcp.listen(SSH_PORT, () => {
    const device = ctx.device();
    if (!device?.cli?.ssh) return null;
    const reader = new LineReader();
    let authed = false;
    return {
      onOpen: (conn) => conn.write(`${VERSION_SERVER}\r\n`),
      onData: (conn, data) => {
        for (const line of reader.push(data)) {
          if (line.startsWith('SSH-')) continue;
          const message = unseal(line);
          if (message === null) continue;
          const [kind, ...rest] = message.split(' ');
          if (kind === 'AUTH') {
            const [user = '', ...pw] = rest;
            const current = ctx.device();
            const valid = current?.cli?.ssh && current.cli.users?.some((u) => u.name === user && u.password === pw.join(' '));
            authed = !!valid;
            ctx.print(valid ? 'ssh.server.login' : 'ssh.server.denied', { user, from: conn.remote.ip });
            conn.write(seal(valid ? `OK ${current!.id}` : 'DENIED') + '\r\n');
            if (!valid) conn.close();
          } else if (kind === 'CMD' && authed) {
            conn.write(seal('ACK') + '\r\n');
          } else if (kind === 'BYE') {
            conn.close();
          }
        }
      },
      onEnd: (conn) => conn.close(),
    };
  });
}

/** SSH-Client eines Endgeräts; höchstens eine Sitzung gleichzeitig. */
export class SshClient {
  #conn: TcpConnection | null = null;
  #open = false;

  constructor(
    private readonly tcp: TcpStack,
    private readonly ctx: NodeContext,
  ) {}

  get active(): boolean {
    return this.#conn !== null;
  }

  connect(target: string, user: string, password: string) {
    if (this.#conn) this.close();
    this.ctx.print('ssh.connecting', { target, user });
    const reader = new LineReader();
    const conn = this.tcp.connect(target, SSH_PORT, {
      onOpen: (c) => {
        c.write(`${VERSION_CLIENT}\r\n`);
        c.write(seal(`AUTH ${user} ${password}`) + '\r\n');
      },
      onData: (_c, data) => {
        for (const line of reader.push(data)) {
          if (line.startsWith('SSH-')) continue;
          const message = unseal(line);
          if (message?.startsWith('OK ')) {
            this.#open = true;
            this.ctx.print('ssh.open', { device: message.slice(3), target, user });
          } else if (message === 'DENIED') {
            this.ctx.print('ssh.denied', { target });
          }
        }
      },
      onClose: () => {
        if (this.#open) this.ctx.print('ssh.closed', { target });
        this.#reset();
      },
      onError: (_c, error) => {
        this.ctx.print(error === 'refused' || error === 'reset' ? 'ssh.refused' : error === 'timeout' ? 'ssh.timeout' : 'ssh.noRoute', { target });
        this.#reset();
      },
    });
    if (!conn) {
      this.ctx.print('ssh.noRoute', { target });
      return;
    }
    this.#conn = conn;
  }

  /** Befehlszeile verschlüsselt übertragen (die Ausführung übernimmt die Oberfläche). */
  send(line: string) {
    if (this.#open) this.#conn?.write(seal(`CMD ${line}`) + '\r\n');
  }

  close() {
    const conn = this.#conn;
    if (!conn) return;
    if (this.#open) conn.write(seal('BYE') + '\r\n');
    conn.close();
  }

  #reset() {
    this.#conn = null;
    this.#open = false;
  }
}
