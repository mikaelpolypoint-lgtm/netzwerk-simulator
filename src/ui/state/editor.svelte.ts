import {
  setPortTrunk,
  setPortVlan,
  setStp,
  setStpPriority,
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
  freeInterfaceFor,
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
  addArea,
  addFloor,
  removeArea,
  removeFloor,
  removeSubinterface,
  removeSvi,
  renameFloor,
  setCableMedium,
  setCliConfig,
  setDeviceFloor,
  setInterfaceColor,
  setInterfaceDescription,
  setInterfaceShutdown,
  setIpRouting,
  setSubinterface,
  setSvi,
  setVlanName,
  setWifiClient,
  setWlan,
  updateArea,
  insertSfpModule,
  isRackable,
  rackAt,
  setDeviceRack,
  setSfpModule,
  MAX_SNAPSHOTS,
  type SfpModule,
  type CliConfig,
  type DocArea,
  type Medium,
  type Snapshot,
  type TagColor,
  type WifiClient,
  type WlanConfig,
  addStaticNat,
  applyRoaming,
  removeStaticNat,
  removeVlanDef,
  roamingTarget,
  setBgp,
  setCgnat,
  setCgnatAddress,
  setEncapsulation,
  setGroupSize,
  setModemKind,
  setOspf,
  setOspfCost,
  setPortSerial,
  setRip,
  setVlanDef,
  wouldLoopWithoutStp,
  noPortError,
  duplicateDevice,
  type BgpConfig,
  type DeviceOptions,
  type ModemKind,
  type OspfConfig,
  type RipConfig,
  type SerialEncapsulation,
  type StaticNat,
  type VlanDef,
} from '../../core';
import { simStore } from './sim.svelte';
import { t } from '../../i18n';
import { errorText, interfaceLabel } from '../labels';

export type Selection = { kind: 'device'; id: string } | { kind: 'cable'; id: string } | { kind: 'area'; id: string } | null;
export type Tool = 'select' | 'cable' | 'area';
export type Mode = 'design' | 'simulation';

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
  /** Gespeicherte Zwischenstände; reisen mit der Projektdatei. */
  snapshots = $state.raw<Snapshot[]>([]);
  /** Medium für das Verbindungswerkzeug (TP-Kabel, Glasfaser, Funk). */
  medium = $state<Medium>('tp');

  #undo = $state.raw<Topology[]>([]);
  #redo = $state.raw<Topology[]>([]);
  #dragBase: Topology | null = null;
  #size = { width: 0, height: 0 };
  #fitPending = true;
  #messageId = 0;

  get editable() {
    return this.mode === 'design';
  }

  /** Simulation läuft. */
  get acting() {
    return this.mode === 'simulation';
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

  get selectedArea(): DocArea | undefined {
    const selection = this.selection;
    return selection?.kind === 'area' ? this.topology.areas?.find((a) => a.id === selection.id) : undefined;
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
    if (this.selection && !this.selectedDevice && !this.selectedCable && !this.selectedArea) this.selection = null;
    if (this.cableSource && !getDevice(this.topology, this.cableSource)) this.cableSource = null;
  }

  /** Ersetzt die ganze Topologie, z.B. beim Laden einer Datei (mit deren Aufgabe, falls vorhanden). */
  replace(next: Topology, { undoable, tasks = null, snapshots }: { undoable: boolean; tasks?: TaskSet | null; snapshots?: Snapshot[] }) {
    this.tasks = tasks;
    if (snapshots !== undefined) this.snapshots = snapshots;
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
    if (this.topology.devices.length === 0 && !this.tasks && !(this.topology.areas?.length)) return;
    if (this.mode !== 'design') this.setMode('design');
    this.replace(emptyTopology(), { undoable: true, snapshots: [] });
    this.notify(t('status.cleared'));
  }

  // --- Bearbeiten ----------------------------------------------------------

  /**
   * Neues Gerät; ist ein Stockwerk gewählt, landet es dort. `prepare` richtet
   * es nach der Shop-Variante ein (z.B. Dienste eines Servers).
   */
  addDevice(type: DeviceType, position: Point, floor = 0, options: DeviceOptions = {}, prepare?: (t: Topology, id: string) => Topology, baseName?: string) {
    if (!this.editable) return;
    const name = suggestName(this.topology, baseName ?? t(`defaultName.${type}`));
    const added = this.#check(addDevice(this.topology, type, name, { x: snap(position.x), y: snap(position.y) }, options));
    if (!added) return;
    const placed = floor > 0 ? setDeviceFloor(added.topology, added.id, floor) : null;
    let next = placed?.ok ? placed.value : added.topology;
    if (prepare) next = prepare(next, added.id);
    this.#commit(next);
    this.selection = { kind: 'device', id: added.id };
  }

  /** Weltkoordinaten der Bildmitte (z.B. für neue Bereiche). */
  viewCenter(): Point {
    return this.screenToWorld(this.#size.width / 2, this.#size.height / 2);
  }

  /** Platziert ein Gerät möglichst in der Bildmitte, aber nicht auf einem anderen. */
  addDeviceAtCenter(type: DeviceType, floor = 0, options: DeviceOptions = {}, prepare?: (t: Topology, id: string) => Topology, baseName?: string) {
    const center = this.screenToWorld(this.#size.width / 2, this.#size.height / 2);
    this.addDevice(type, this.#freeSpotNear(center), floor, options, prepare, baseName);
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

  setPortVlan(id: string, index: number, vlan: number) {
    if (!this.editable) return;
    const next = this.#check(setPortVlan(this.topology, id, index, vlan));
    if (next) this.#commit(next);
  }

  setPortTrunk(id: string, index: number, trunk: boolean) {
    if (!this.editable) return;
    const next = this.#check(setPortTrunk(this.topology, id, index, trunk));
    if (next) this.#commit(next);
  }

  /** Auch in der Simulation: Spanning Tree einschalten beendet einen laufenden Broadcast-Sturm. */
  setStp(id: string, enabled: boolean) {
    const next = this.#check(setStp(this.topology, id, enabled));
    if (next) this.#commit(next);
  }

  setStpPriority(id: string, priority: number) {
    if (!this.editable) return;
    const next = this.#check(setStpPriority(this.topology, id, priority));
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
    if (selection?.kind === 'area' && this.editable) {
      const next = this.#check(removeArea(this.topology, selection.id));
      if (next) this.#commit(next);
      this.selection = null;
      return;
    }
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
    if (!device) return;
    const next = this.#check(moveDevice(this.topology, id, { x: device.position.x + dx, y: device.position.y + dy }));
    if (!next) return;
    this.#commit(next);
    if (this.acting) this.#roam(id);
  }

  /** Simulation: WLAN-Client verschoben – wechselt er zu einem näheren Access Point? */
  #roam(id: string) {
    const decision = roamingTarget(this.topology, id);
    if (!decision) return;
    const next = this.#check(applyRoaming(this.topology, decision));
    if (!next) return;
    this.topology = next;
    const device = getDevice(next, id);
    const ap = getDevice(next, decision.to);
    simStore.roam(next, id);
    this.notify(t('wlan.roamed', { device: device?.name ?? '', ap: ap?.name ?? '', signal: decision.signal }));
  }

  // Ziehen mit der Maus: Zwischenschritte landen nicht im Verlauf, nur das Ergebnis.
  beginDrag() {
    this.#dragBase = this.topology;
  }

  /** Läuft gerade ein Ziehvorgang? */
  get dragging() {
    return this.#dragBase !== null;
  }

  dragTo(id: string, position: Point) {
    // In der Simulation darf man Geräte verschieben (WLAN-Roaming), sonst nichts verändern.
    if (!this.#dragBase) return;
    const moved = moveDevice(this.topology, id, { x: snap(position.x), y: snap(position.y) });
    if (moved.ok) this.topology = moved.value;
  }

  endDrag() {
    const base = this.#dragBase;
    this.#dragBase = null;
    if (base && base !== this.topology) this.#pushUndo(base);
  }

  /**
   * Ende des Ziehens eines Geräts: Über einem Rack abgelegt wird es eingebaut,
   * aus seinem Rack herausgezogen wird es ausgebaut. Ein Schritt im Verlauf.
   */
  endDeviceDrag(id: string) {
    const base = this.#dragBase;
    const device = getDevice(this.topology, id);
    if (this.acting) {
      this.endDrag();
      if (base && base !== this.topology) this.#roam(id);
      return;
    }
    if (base && device && base !== this.topology && isRackable(device.type)) {
      const floor = device.floor ?? 0;
      const target = rackAt(this.topology, device.position.x, device.position.y, floor);
      const next = target ? setDeviceRack(this.topology, id, target.id, true) : device.rack ? setDeviceRack(this.topology, id, null) : null;
      if (next?.ok) this.topology = next.value;
    }
    this.endDrag();
  }

  // --- SFP-Module und Racks ---------------------------------------------------

  /** Modul aus der Palette in das gewählte (oder angegebene) Gerät stecken. */
  insertSfp(module: SfpModule, deviceId = this.selectedDevice?.id) {
    if (!this.editable) return;
    if (!deviceId) {
      this.notify(t('sfp.selectDevice'), 'error');
      return;
    }
    const inserted = this.#check(insertSfpModule(this.topology, deviceId, module));
    if (!inserted) return;
    this.#commit(inserted.topology);
    const device = getDevice(this.topology, deviceId);
    this.notify(t('sfp.inserted', { module, device: device?.name ?? '', slot: device ? interfaceLabel(device, inserted.index) : '' }));
  }

  setSfpModule(id: string, index: number, module: SfpModule | null) {
    this.#edit(setSfpModule(this.topology, id, index, module));
  }

  setDeviceRack(id: string, rack: string | null) {
    if (!this.editable) return;
    const next = this.#check(setDeviceRack(this.topology, id, rack));
    if (next) this.#commit(next);
  }

  // --- Bereiche kopieren und einfügen -------------------------------------------

  #clipboard: Omit<DocArea, 'id'> | null = null;

  get canPaste() {
    return this.#clipboard !== null && this.editable;
  }

  copyArea(): boolean {
    const area = this.selectedArea;
    if (!area) return false;
    const { id: _id, ...rest } = area;
    this.#clipboard = rest;
    this.notify(t('area.copied', { title: area.title }));
    return true;
  }

  /** Fügt die kopierte Fläche versetzt ein (mehrfach einfügen: jedes Mal weiter versetzt). */
  pasteArea(): boolean {
    const copy = this.#clipboard;
    if (!copy || !this.editable) return false;
    const offset = 40;
    this.addArea({ ...copy, x: copy.x + offset, y: copy.y + offset, title: t('area.copyTitle', { title: copy.title }) });
    this.#clipboard = { ...copy, x: copy.x + offset, y: copy.y + offset };
    return true;
  }

  duplicateArea() {
    if (this.copyArea()) this.pasteArea();
  }

  /** Strg+D: gewähltes Gerät (ohne Adressen und Kabel) oder gewählten Bereich verdoppeln. */
  duplicateSelection() {
    if (!this.editable) return;
    if (this.selection?.kind === 'area') return this.duplicateArea();
    const device = this.selectedDevice;
    if (!device) return;
    const base = device.name.replace(/\s*\d+$/, '') || t(`defaultName.${device.type}`);
    const copy = this.#check(duplicateDevice(this.topology, device.id, suggestName(this.topology, base)));
    if (!copy) return;
    this.#commit(copy.topology);
    this.selection = { kind: 'device', id: copy.id };
  }

  // --- Neue Einstellungen (Ports, WLAN, Pro-Funktionen) ----------------------

  /** Allgemeiner Weg für einfache Änderungen im Entwurfsmodus: Fehler als Meldung. */
  #edit(result: Result<Topology>) {
    if (!this.editable) return;
    const next = this.#check(result);
    if (next) this.#commit(next);
  }

  setCableMedium(id: string, medium: Medium) {
    this.#edit(setCableMedium(this.topology, id, medium));
  }

  /** Auch während der Simulation: Anschlüsse ab- und einschalten, um Routing oder Spanning Tree zu beobachten. */
  #live(result: Result<Topology>) {
    const next = this.#check(result);
    if (next) this.#commit(next);
  }

  setInterfaceShutdown(id: string, index: number, shutdown: boolean) {
    this.#live(setInterfaceShutdown(this.topology, id, index, shutdown));
  }

  setInterfaceColor(id: string, index: number, color: TagColor | null) {
    this.#edit(setInterfaceColor(this.topology, id, index, color));
  }

  setInterfaceDescription(id: string, index: number, description: string) {
    this.#edit(setInterfaceDescription(this.topology, id, index, description));
  }

  setPortSerial(id: string, index: number, serial: boolean) {
    this.#edit(setPortSerial(this.topology, id, index, serial));
  }

  setEncapsulation(id: string, index: number, encapsulation: SerialEncapsulation) {
    this.#edit(setEncapsulation(this.topology, id, index, encapsulation));
  }

  setOspfCost(id: string, index: number, cost: number | null) {
    this.#edit(setOspfCost(this.topology, id, index, cost));
  }

  setGroupSize(id: string, size: number) {
    this.#edit(setGroupSize(this.topology, id, size));
  }

  setModemKind(id: string, kind: ModemKind | null) {
    this.#edit(setModemKind(this.topology, id, kind));
  }

  addStaticNat(id: string, rule: StaticNat): TopologyError | null {
    return this.#applyForm(addStaticNat(this.topology, id, rule));
  }

  removeStaticNat(id: string, index: number) {
    this.#edit(removeStaticNat(this.topology, id, index));
  }

  setCgnat(id: string, index: number, enabled: boolean) {
    this.#edit(setCgnat(this.topology, id, index, enabled));
  }

  setCgnatAddress(id: string, address: string): TopologyError | null {
    return this.#applyForm(setCgnatAddress(this.topology, id, address));
  }

  setOspf(id: string, config: OspfConfig | null): TopologyError | null {
    return this.#applyForm(setOspf(this.topology, id, config));
  }

  setBgp(id: string, config: BgpConfig | null): TopologyError | null {
    return this.#applyForm(setBgp(this.topology, id, config));
  }

  setRip(id: string, config: RipConfig | null): TopologyError | null {
    return this.#applyForm(setRip(this.topology, id, config));
  }

  setVlanDef(vlan: VlanDef): TopologyError | null {
    return this.#applyForm(setVlanDef(this.topology, vlan));
  }

  removeVlanDef(id: number) {
    this.#edit(removeVlanDef(this.topology, id));
  }

  /** Beliebige geprüfte Änderung, z.B. Vorbelegung einer Shop-Variante. */
  apply(result: Result<Topology>) {
    this.#edit(result);
  }

  setWlan(id: string, config: WlanConfig | null): TopologyError | null {
    return this.#applyForm(setWlan(this.topology, id, config));
  }

  setWifiClient(id: string, client: WifiClient | null): TopologyError | null {
    return this.#applyForm(setWifiClient(this.topology, id, client));
  }

  setSubinterface(id: string, parent: number, vlan: number, ip: string, mask: string): TopologyError | null {
    return this.#applyForm(setSubinterface(this.topology, id, parent, vlan, ip, mask));
  }

  removeSubinterface(id: string, parent: number, vlan: number) {
    this.#edit(removeSubinterface(this.topology, id, parent, vlan));
  }

  setSvi(id: string, vlan: number, ip: string, mask: string): TopologyError | null {
    return this.#applyForm(setSvi(this.topology, id, vlan, ip, mask));
  }

  removeSvi(id: string, vlan: number) {
    this.#edit(removeSvi(this.topology, id, vlan));
  }

  setIpRouting(id: string, enabled: boolean) {
    this.#edit(setIpRouting(this.topology, id, enabled));
  }

  setVlanName(id: string, vlan: number, name: string): TopologyError | null {
    return this.#applyForm(setVlanName(this.topology, id, vlan, name));
  }

  setCliConfig(id: string, cli: CliConfig): TopologyError | null {
    return this.#applyForm(setCliConfig(this.topology, id, cli));
  }

  /**
   * Änderungen aus der Befehlszeile: auch im Aktionsmodus erlaubt, denn
   * echte Geräte konfiguriert man im laufenden Betrieb. Rückgängig machen
   * geht danach im Entwurfsmodus.
   */
  applyConfig(next: Topology) {
    if (next === this.topology) return;
    this.#commit(next);
    this.#dropStaleReferences();
  }

  // --- Stockwerke ------------------------------------------------------------

  addFloor(name: string) {
    if (!this.editable) return;
    const next = this.#check(addFloor(this.topology, name));
    if (next) this.#commit(next);
  }

  renameFloor(index: number, name: string) {
    if (!this.editable) return;
    const next = this.#check(renameFloor(this.topology, index, name));
    if (next) this.#commit(next);
  }

  removeFloor(index: number) {
    if (!this.editable) return;
    const next = this.#check(removeFloor(this.topology, index));
    if (next) this.#commit(next);
  }

  setDeviceFloor(id: string, floor: number) {
    this.#edit(setDeviceFloor(this.topology, id, floor));
  }

  // --- Dokumentationsmodus: Bereiche -------------------------------------------

  addArea(area: Omit<DocArea, 'id'>) {
    if (!this.editable) return;
    const added = this.#check(addArea(this.topology, area));
    if (!added) return;
    this.#commit(added.topology);
    this.selection = { kind: 'area', id: added.id };
  }

  updateArea(id: string, change: Partial<Omit<DocArea, 'id'>>) {
    if (!this.editable) return;
    let next = this.#check(updateArea(this.topology, id, change));
    if (!next) return;
    // VLAN-Bereiche dokumentieren das VLAN mit ihrer Farbe: Switch-Ports erscheinen in dieser Farbe.
    const area = next.areas?.find((a) => a.id === id);
    if (area?.vlan && area.kind !== 'rack' && ('vlan' in change || 'color' in change || 'title' in change)) {
      const documented = setVlanDef(next, { id: area.vlan, color: area.color, name: next.vlans?.find((v) => v.id === area.vlan)?.name ?? area.title });
      if (documented.ok) next = documented.value;
    }
    this.#commit(next);
  }

  /** Bereich ziehen oder in der Grösse ändern: nur das Endergebnis landet im Verlauf. */
  dragArea(id: string, change: Partial<Omit<DocArea, 'id'>>) {
    if (!this.#dragBase) return;
    const moved = updateArea(this.topology, id, change);
    if (moved.ok) this.topology = moved.value;
  }

  // --- Snapshots ---------------------------------------------------------------

  createSnapshot(name: string, auto = false) {
    const last = this.snapshots.at(-1);
    // Automatische Snapshots nur, wenn sich seit dem letzten etwas geändert hat.
    if (auto && last && last.topology === this.topology) return;
    const snapshot: Snapshot = {
      id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      name: name.trim() || new Date().toLocaleString(),
      created: new Date().toISOString(),
      ...(auto ? { auto: true } : {}),
      topology: this.topology,
    };
    // Automatische Snapshots verdrängen zuerst ältere automatische.
    let list = [...this.snapshots, snapshot];
    while (list.length > MAX_SNAPSHOTS) {
      const oldestAuto = list.findIndex((s) => s.auto);
      list.splice(oldestAuto >= 0 ? oldestAuto : 0, 1);
    }
    this.snapshots = list;
    if (!auto) this.notify(t('snapshot.created', { name: snapshot.name }));
  }

  restoreSnapshot(id: string) {
    const snapshot = this.snapshots.find((s) => s.id === id);
    if (!snapshot || this.acting) return;
    this.#commit(snapshot.topology);
    this.selection = null;
    this.#dropStaleReferences();
    this.notify(t('snapshot.restored', { name: snapshot.name }));
  }

  renameSnapshot(id: string, name: string) {
    const value = name.trim();
    if (!value) return;
    this.snapshots = this.snapshots.map((s) => (s.id === id ? { ...s, name: value.slice(0, 80) } : s));
  }

  deleteSnapshot(id: string) {
    this.snapshots = this.snapshots.filter((s) => s.id !== id);
  }

  // --- Werkzeuge und Modi --------------------------------------------------

  select(selection: Selection) {
    this.selection = selection;
  }

  setTool(tool: Tool) {
    if ((tool === 'cable' || tool === 'area') && !this.editable) return;
    this.tool = tool;
    this.cableSource = null;
  }

  setMode(mode: Mode) {
    this.endDrag();
    // Vor dem Start der Simulation den Stand festhalten, damit man zurückkehren kann.
    if (mode === 'simulation' && this.mode !== 'simulation' && this.topology.devices.length > 0) {
      this.createSnapshot(t('snapshot.autoAction'), true);
    }
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
      if (!freeInterfaceFor(this.topology, device, this.medium)) {
        this.notify(errorText({ code: noPortError(this.topology, device, this.medium), params: { device: device.name, medium: t(`medium.${this.medium}`) } }), 'error');
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
    const loop = wouldLoopWithoutStp(this.topology, source, id);
    const connected = this.#check(connect(this.topology, source, id, this.medium));
    if (!connected) return;
    this.#commit(connected.topology);
    if (loop) this.notify(t('stp.loopWarning'), 'error');
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
    const areas = this.topology.areas ?? [];
    if (devices.length === 0 && areas.length === 0) {
      this.view = { x: width / 2, y: height / 2, scale: 1 };
      return;
    }
    // Bereiche zählen mit, damit ihr Titel nicht abgeschnitten wird.
    const xs = [...devices.map((d) => d.position.x), ...areas.flatMap((a) => [a.x + FIT_MARGIN, a.x + a.width - FIT_MARGIN])];
    const ys = [...devices.map((d) => d.position.y), ...areas.flatMap((a) => [a.y + FIT_MARGIN - 10, a.y + a.height - FIT_MARGIN])];
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
