import { parseProject, type Snapshot, type TaskSet, type Topology } from '../../core';

/**
 * Online-Sessions der Webversion: Der Projektstand liegt unter einem
 * Zufallscode auf dem Server und wird automatisch gelöscht. Keine Namen,
 * keine Konten; der Code steht nur im Browser (technisch notwendig) und bei
 * der Person selbst.
 */

const CODE_KEY = 'netzwerk-simulator.session';
const CLASS_KEY = 'netzwerk-simulator.class';

export interface ServerConfig {
  policy: { modes: { design: boolean; action: boolean; doc: boolean }; pro: boolean; sessionHours: number };
  feedbackEnabled: boolean;
  feedbackDays: number;
  admin: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error');
  return data;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ohne Speicher gilt der Code bis zum Neuladen
  }
}

export interface LoadedProject {
  topology: Topology;
  tasks?: TaskSet;
  snapshots?: Snapshot[];
}

class SessionStore {
  code = $state<string | null>(read(CODE_KEY));
  classCode = $state<string | null>(read(CLASS_KEY));
  classLabel = $state<string | null>(null);
  expires = $state<number | null>(null);
  status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  config = $state.raw<ServerConfig | null>(null);
  #pending: string | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #busy = false;

  async loadConfig(): Promise<ServerConfig | null> {
    try {
      this.config = await api<ServerConfig>('GET', 'config');
    } catch {
      this.config = null;
    }
    return this.config;
  }

  /** Beim Start: gespeicherte Session laden (falls noch vorhanden). */
  async restore(): Promise<LoadedProject | null> {
    if (!this.code) return null;
    try {
      return await this.open(this.code);
    } catch {
      this.#forget();
      return null;
    }
  }

  async open(code: string): Promise<LoadedProject> {
    const data = await api<{ code: string; expires: number; classCode: string | null; project: unknown }>('GET', `sessions/${encodeURIComponent(code)}`);
    const parsed = parseProject(JSON.stringify(data.project));
    if (!parsed.ok) throw new ApiError(400, 'invalidProject');
    this.code = data.code;
    this.expires = data.expires;
    this.classCode = data.classCode;
    write(CODE_KEY, data.code);
    write(CLASS_KEY, data.classCode);
    return parsed;
  }

  /** Neuer Code für den aktuellen Stand, optional einer Klasse zugeordnet. */
  async create(projectJson: string, classCode: string | null = this.classCode): Promise<string> {
    const data = await api<{ code: string; expires: number; classCode: string | null }>('POST', 'sessions', {
      project: JSON.parse(projectJson),
      ...(classCode ? { classCode } : {}),
    });
    this.code = data.code;
    this.expires = data.expires;
    this.classCode = data.classCode;
    write(CODE_KEY, data.code);
    write(CLASS_KEY, data.classCode);
    this.status = 'saved';
    return data.code;
  }

  async joinClass(classCode: string, projectJson: string): Promise<void> {
    const data = await api<{ classCode: string; label: string }>('POST', 'classes/join', { classCode });
    this.classLabel = data.label;
    await this.create(projectJson, data.classCode);
  }

  /** Änderungen gesammelt nach kurzer Pause hochladen; leere Projekte legen keine Session an. */
  schedule(projectJson: string, hasContent: boolean) {
    if (!this.code && !hasContent) return;
    this.#pending = projectJson;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), 1500);
  }

  async flush() {
    const json = this.#pending;
    if (!json || this.#busy) return;
    this.#pending = null;
    this.#busy = true;
    this.status = 'saving';
    try {
      if (this.code) {
        const data = await api<{ expires: number }>('PUT', `sessions/${this.code}`, { project: JSON.parse(json) });
        this.expires = data.expires;
      } else {
        await this.create(json);
      }
      this.status = 'saved';
    } catch (error) {
      // Abgelaufene Session: mit neuem Code weiterarbeiten.
      if (error instanceof ApiError && error.status === 404 && this.code) {
        this.#forget();
        this.#pending = json;
      } else {
        this.status = 'error';
      }
    } finally {
      this.#busy = false;
      if (this.#pending) void this.flush();
    }
  }

  /** Eigene Session auf dem Server löschen (Recht auf Löschung). */
  async remove() {
    const code = this.code;
    if (!code) return;
    await api('DELETE', `sessions/${code}`).catch(() => undefined);
    this.#forget();
  }

  /** Neue, leere Session beginnen; die alte bleibt bis zum Ablauf unter ihrem Code erreichbar. */
  detach() {
    this.#forget();
  }

  #forget() {
    this.code = null;
    this.expires = null;
    this.classCode = null;
    this.classLabel = null;
    this.status = 'idle';
    write(CODE_KEY, null);
    write(CLASS_KEY, null);
  }
}

export const session = new SessionStore();
