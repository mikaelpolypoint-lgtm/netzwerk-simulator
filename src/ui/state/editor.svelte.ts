import {
  addPortForward,
  removePortForward,
  setInterfaceNat,
  addDhcpScope,
  removeDhcpScope,
  setInterfaceRelay,
  addDevice,
  addDnsRecord,
  addMailbox,
  addStaticRoute,
  removeDnsRecord,
  removeMailbox,
  setMailAccount,
  setMailDomain,
  setMailServerEnabled,
  removeWebFile,
  saveWebFile,
  setDnsServerEnabled,
  setWebServerEnabled,
  configureHost,
  connect,
  emptyTopology,
  freeInterface,
  getCable,
  getDevice,
  moveDevice,
  removeCable,
  removeDevice,
  removeStaticRoute,
  renameDevice,
  replugCable,
  setCableLoss,
  setDhcpServer,
  setInterfaceAddress,
  setInterfaceCount,
  suggestName,
  type DeviceType,
  type DhcpScope,
  type DhcpServerConfig,
  type DnsRecord,
  type HostConfigInput,
  type MailAccount,
  type Mailbox,
  type TaskSet,
  type WebFile,
  type Point,
  type PortForward,
  type Result,
  type StaticRoute,
  type Topology,
  type TopologyError,
} from '../../core';
import { t } from '../../i18n';
import { errorText } from '../labels';

export type Selection = { kind: 'device'; id: string } | { kind: 'cable'; id: string } | null;
export type Tool = 'select' | 'cable';
export type Mode = 'design' | 'action';

export interface View {
  /** Bildschirmposition des Welt-Ursprungs. */
  x: number;
  y: number;
  scale: number;
}

export interface Message {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export const GRID = 10;
const HISTORY_LIMIT = 100;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const FIT_MARGIN = 80;

export const snap = (v: number) => Math.round(v / GRID) * GRID;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/**
 * Zustand des Topologie-Editors. Die Topologie selbst ist unveränderlich,
 * daher besteht Undo/Redo einfach aus Stapeln früherer Topologien.
 */
class Editor {
  topology = $state.raw<Topology>(emptyTopology());
  selection = $state.raw<Selection>(null);
  tool = $state<Tool>('select');
  mode = $state<Mode>('design');
  /** Erstes Gerät, solange im Kabelwerkzeug ein Kabel gezogen wird. */
  cableSource = $state<string | null>(null);
  view = $state.raw<View>({ x: 0, y: 0, scale: 1 });
  message = $state.raw<Message | null>(null);
  /** Steigt, wenn ein anderes Projekt geladen wird; die Simulation beginnt dann neu. */
  generation = $state(0);
  /** Aufgabe zum Projekt (aus einer Aufgabendatei); nicht Teil des Undo-Verlaufs. */
  tasks = $state.raw<TaskSet | null>(null);

  #undo = $state.raw<Topology[]>([]);
  #redo = $state.raw<Topology[]>([]);
  #dragBase: Topology | null = null;
  #size = { width: 0, height: 0 };
  #fitPending = true;
  #messageId = 0;

  get editable() {
    return this.mode === 'design';
  }

  get canUndo() {
    return this.editable && this.#undo.length > 0;
  }

  get canRedo() {
    return this.editable && this.#redo.length > 0;
  }

  get selectedDevice() {
    return this.selection?.kind === 'device' ? getDevice(this.topology, this.selection.id) : undefined;
  }

  get selectedCable() {
    return this.selection?.kind === 'cable' ? getCable(this.topology, this.selection.id) : undefined;
  }

  // --- Meldungen -----------------------------------------------------------

  notify(text: string, kind: Message['kind'] = 'info') {
    this.message = { id: ++this.#messageId, text, kind };
  }

  dismissMessage(id: number) {
    if (this.message?.id === id) this.message = null;
  }

  #check<T>(result: Result<T>): T | undefined {
    if (result.ok) return result.value;
    this.notify(errorText(result.error), 'error');
    return undefined;
  }

  // --- Verlauf -------------------------------------------------------------

  #commit(next: Topology) {
    if (next === this.topology) return;
    this.#pushUndo(this.topology);
    this.topology = next;
  }

  #pushUndo(previous: Topology) {
    this.#undo = [...this.#undo, previous].slice(-HISTORY_LIMIT);
    this.#redo = [];
  }

  undo() {
    const previous = this.#undo.at(-1);
    if (!this.canUndo || !previous) return;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, this.topology];
    this.topology = previous;
    this.#dropStaleReferences();
  }

  redo() {
    const next = this.#redo.at(-1);
    if (!this.canRedo || !next) return;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, this.topology];
    this.topology = next;
    this.#dropStaleReferences();
  }

  #dropStaleReferences() {
    if (this.selection && !this.selectedDevice && !this.selectedCable) this.selection = null;
    if (this.cableSource && !getDevice(this.topology, this.cableSource)) this.cableSource = null;
  }

  /** Ersetzt die ganze Topologie, z.B. beim Laden einer Datei (mit deren Aufgabe, falls vorhanden). */
  replace(next: Topology, { undoable, tasks = null }: { undoable: boolean; tasks?: TaskSet | null }) {
    this.tasks = tasks;
    if (undoable) {
      this.#commit(next);
    } else {
      this.topology = next;
      this.#undo = [];
      this.#redo = [];
    }
    this.selection = null;
    this.cableSource = null;
    this.generation++;
    this.fit();
  }

  setTasks(tasks: TaskSet | null) {
    this.tasks = tasks;
  }

  clear() {
    if (!this.editable || (this.topology.devices.length === 0 && !this.tasks)) return;
    this.replace(emptyTopology(), { undoable: true });
    this.notify(t('status.cleared'));
  }

  // --- Bearbeiten ----------------------------------------------------------

  addDevice(type: DeviceType, position: Point) {
    if (!this.editable) return;
    const name = suggestName(this.topology, t(`defaultName.${type}`));
    const added = this.#check(addDevice(this.topology, type, name, { x: snap(position.x), y: snap(position.y) }));
    if (!added) return;
    this.#commit(added.topology);
    this.selection = { kind: 'device', id: added.id };
  }

  /** Platziert ein Gerät möglichst in der Bildmitte, aber nicht auf einem anderen. */
  addDeviceAtCenter(type: DeviceType) {
    const center = this.screenToWorld(this.#size.width / 2, this.#size.height / 2);
    this.addDevice(type, this.#freeSpotNear(center));
  }

  /** Sucht ringförmig um `p` die erste Stelle ohne Gerät in der Nähe. */
  #freeSpotNear(p: Point): Point {
    const step = 12 * GRID;
    const isFree = (q: Point) =>
      this.topology.devices.every((d) => Math.hypot(d.position.x - q.x, d.position.y - q.y) >= step * 0.75);
    for (let ring = 0; ring < 6; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const q = { x: p.x + dx * step, y: p.y + dy * step };
          if (isFree(q)) return q;
        }
      }
    }
    return p;
  }

  rename(id: string, name: string): boolean {
    if (!this.editable) return false;
    const next = this.#check(renameDevice(this.topology, id, name));
    if (!next) return false;
    this.#commit(next);
    return true;
  }

  /** Für Formulare: Fehler zurückgeben statt melden, damit sie beim betroffenen Feld erscheinen. */
  #applyForm(result: Result<Topology>): TopologyError | null {
    if (!this.editable) return null;
    if (!result.ok) return result.error;
    this.#commit(result.value);
    return null;
  }

  configureHost(id: string, input: HostConfigInput): TopologyError | null {
    return this.#applyForm(configureHost(this.topology, id, input));
  }

  setInterfaceAddress(id: string, index: number, ip: string, mask: string): TopologyError | null {
    return this.#applyForm(setInterfaceAddress(this.topology, id, index, ip, mask));
  }

  setDhcpServer(id: string, config: DhcpServerConfig | null): TopologyError | null {
    return this.#applyForm(setDhcpServer(this.topology, id, config));
  }

  addDhcpScope(id: string, scope: DhcpScope): TopologyError | null {
    return this.#applyForm(addDhcpScope(this.topology, id, scope));
  }

  removeDhcpScope(id: string, index: number) {
    if (!this.editable) return;
    const next = this.#check(removeDhcpScope(this.topology, id, index));
    if (next) this.#commit(next);
  }

  setInterfaceNat(id: string, index: number, nat: boolean) {
    if (!this.editable) return;
    const next = this.#check(setInterfaceNat(this.topology, id, index, nat));
    if (next) this.#commit(next);
  }

  addPortForward(id: string, forward: PortForward): TopologyError | null {
    return this.#applyForm(addPortForward(this.topology, id, forward));
  }

  removePortForward(id: string, index: number) {
    if (!this.editable) return;
    const next = this.#check(removePortForward(this.topology, id, index));
    if (next) this.#commit(next);
  }

  setInterfaceRelay(id: string, index: number, server: string): TopologyError | null {
    return this.#applyForm(setInterfaceRelay(this.topology, id, index, server));
  }

  setDnsServerEnabled(id: string, enabled: boolean) {
    if (!this.editable) return;
    const next = this.#check(setDnsServerEnabled(this.topology, id, enabled));
    if (next) this.#commit(next);
  }

  addDnsRecord(id: string, record: DnsRecord): TopologyError | null {
    return this.#applyForm(addDnsRecord(this.topology, id, record));
  }

  removeDnsRecord(id: string, index: number) {
    if (!this.editable) return;
    const next = this.#check(removeDnsRecord(this.topology, id, index));
    if (next) this.#commit(next);
  }

  setWebServerEnabled(id: string, enabled: boolean, initial: WebFile[]) {
    if (!this.editable) return;
    const next = this.#check(setWebServerEnabled(this.topology, id, enabled, initial));
    if (next) this.#commit(next);
  }

  saveWebFile(id: string, file: WebFile, previousPath?: string): TopologyError | null {
    return this.#applyForm(saveWebFile(this.topology, id, file, previousPath));
  }

  setMailServerEnabled(id: string, enabled: boolean) {
    if (!this.editable) return;
    const next = this.#check(setMailServerEnabled(this.topology, id, enabled));
    if (next) this.#commit(next);
  }

  setMailDomain(id: string, domain: string): TopologyError | null {
    return this.#applyForm(setMailDomain(this.topology, id, domain));
  }

  addMailbox(id: string, mailbox: Mailbox): TopologyError | null {
    return this.#applyForm(addMailbox(this.topology, id, mailbox));
  }

  removeMailbox(id: string, user: string) {
    if (!this.editable) return;
    const next = this.#check(removeMailbox(this.topology, id, user));
    if (next) this.#commit(next);
  }

  setMailAccount(id: string, account: MailAccount | null): TopologyError | null {
    return this.#applyForm(setMailAccount(this.topology, id, account));
  }

  removeWebFile(id: string, path: string) {
    if (!this.editable) return;
    const next = this.#check(removeWebFile(this.topology, id, path));
    if (next) this.#commit(next);
  }

  addStaticRoute(id: string, route: StaticRoute): TopologyError | null {
    return this.#applyForm(addStaticRoute(this.topology, id, route));
  }

  removeStaticRoute(id: string, index: number) {
    if (!this.editable) return;
    const next = this.#check(removeStaticRoute(this.topology, id, index));
    if (next) this.#commit(next);
  }

  setCableLoss(id: string, percent: number) {
    if (!this.editable) return;
    const next = this.#check(setCableLoss(this.topology, id, percent));
    if (next) this.#commit(next);
  }

  replugCable(id: string, end: 'a' | 'b', iface: number) {
    if (!this.editable) return;
    const next = this.#check(replugCable(this.topology, id, end, iface));
    if (next) this.#commit(next);
  }

  setInterfaceCount(id: string, count: number) {
    if (!this.editable) return;
    const next = this.#check(setInterfaceCount(this.topology, id, count));
    if (next) this.#commit(next);
  }

  deleteSelection() {
    const selection = this.selection;
    if (!this.editable || !selection) return;
    const result =
      selection.kind === 'device' ? removeDevice(this.topology, selection.id) : removeCable(this.topology, selection.id);
    const next = this.#check(result);
    if (!next) return;
    this.#commit(next);
    this.selection = null;
    this.#dropStaleReferences();
  }

  moveBy(id: string, dx: number, dy: number) {
    const device = getDevice(this.topology, id);
    if (!this.editable || !device) return;
    const next = this.#check(moveDevice(this.topology, id, { x: device.position.x + dx, y: device.position.y + dy }));
    if (next) this.#commit(next);
  }

  // Ziehen mit der Maus: Zwischenschritte landen nicht im Verlauf, nur das Ergebnis.
  beginDrag() {
    this.#dragBase = this.topology;
  }

  dragTo(id: string, position: Point) {
    if (!this.#dragBase) return;
    const moved = moveDevice(this.topology, id, { x: snap(position.x), y: snap(position.y) });
    if (moved.ok) this.topology = moved.value;
  }

  endDrag() {
    const base = this.#dragBase;
    this.#dragBase = null;
    if (base && base !== this.topology) this.#pushUndo(base);
  }

  // --- Werkzeuge und Modi --------------------------------------------------

  select(selection: Selection) {
    this.selection = selection;
  }

  setTool(tool: Tool) {
    if (tool === 'cable' && !this.editable) return;
    this.tool = tool;
    this.cableSource = null;
  }

  setMode(mode: Mode) {
    this.endDrag();
    this.mode = mode;
    this.tool = 'select';
    this.cableSource = null;
  }

  /** Kabelwerkzeug: Das erste Gerät merken, beim zweiten verbinden. */
  cableClick(id: string) {
    if (!this.editable) return;
    const source = this.cableSource;
    if (!source) {
      const device = getDevice(this.topology, id);
      if (!device) return;
      if (!freeInterface(this.topology, device)) {
        this.notify(errorText({ code: 'noFreeInterface', params: { device: device.name } }), 'error');
        return;
      }
      this.cableSource = id;
      this.selection = { kind: 'device', id };
      return;
    }
    if (source === id) {
      this.cableSource = null;
      return;
    }
    const connected = this.#check(connect(this.topology, source, id));
    if (!connected) return;
    this.#commit(connected.topology);
    this.selection = { kind: 'cable', id: connected.id };
    this.cableSource = null;
  }

  /** Esc: schrittweise zurück zum neutralen Zustand. */
  cancel() {
    if (this.cableSource) this.cableSource = null;
    else if (this.tool !== 'select') this.tool = 'select';
    else this.selection = null;
  }

  // --- Ansicht -------------------------------------------------------------

  /** Bei Grössenänderung (z.B. Paketliste ein-/ausgeblendet) bleibt die Bildmitte, wo sie war. */
  setCanvasSize(width: number, height: number) {
    const previous = this.#size;
    if (previous.width === width && previous.height === height) return;
    this.#size = { width, height };
    if (this.#fitPending && width > 0 && height > 0) {
      this.fit();
    } else if (previous.width > 0 && previous.height > 0) {
      const v = this.view;
      this.view = { ...v, x: v.x + (width - previous.width) / 2, y: v.y + (height - previous.height) / 2 };
    }
  }

  screenToWorld(sx: number, sy: number): Point {
    const v = this.view;
    return { x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale };
  }

  panBy(dx: number, dy: number) {
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
  }

  /** Zoomt so, dass der Punkt unter (sx, sy) an seiner Stelle bleibt. */
  zoomAt(factor: number, sx = this.#size.width / 2, sy = this.#size.height / 2) {
    const v = this.view;
    const scale = clampScale(v.scale * factor);
    const k = scale / v.scale;
    this.view = { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
  }

  fit() {
    const { width, height } = this.#size;
    if (!width || !height) {
      this.#fitPending = true;
      return;
    }
    this.#fitPending = false;
    const devices = this.topology.devices;
    if (devices.length === 0) {
      this.view = { x: width / 2, y: height / 2, scale: 1 };
      return;
    }
    const xs = devices.map((d) => d.position.x);
    const ys = devices.map((d) => d.position.y);
    const minX = Math.min(...xs) - FIT_MARGIN;
    const maxX = Math.max(...xs) + FIT_MARGIN;
    const minY = Math.min(...ys) - FIT_MARGIN;
    const maxY = Math.max(...ys) + FIT_MARGIN;
    const scale = clampScale(Math.min(width / (maxX - minX), height / (maxY - minY), 1.5));
    this.view = {
      scale,
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale,
    };
  }

  centerSelection() {
    const target = this.#selectionCenter();
    if (!target) return;
    const { width, height } = this.#size;
    const s = this.view.scale;
    this.view = { scale: s, x: width / 2 - target.x * s, y: height / 2 - target.y * s };
  }

  #selectionCenter(): Point | undefined {
    const device = this.selectedDevice;
    if (device) return device.position;
    const cable = this.selectedCable;
    if (!cable) return undefined;
    const a = getDevice(this.topology, cable.a.device);
    const b = getDevice(this.topology, cable.b.device);
    if (!a || !b) return undefined;
    return { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
  }
}

export const editor = new Editor();
