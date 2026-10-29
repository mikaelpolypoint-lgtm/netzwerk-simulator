import { deviceSeq } from '../model/topology';
import type { Device } from '../model/types';
import { BROADCAST_MAC, type EthernetFrame } from './frames';
import { HostNode } from './host';
import type { NodeContext, SimNode } from './simulation';

/** Abstand, in dem die Rechner einer Gruppe starten (sonst fragen alle im selben Moment nach DHCP). */
export const GROUP_BOOT_SPACING = 20;

export interface GroupMemberState {
  member: number;
  mac: string;
  ip?: string;
  dhcpState?: string;
}

/** MAC-Adressen der Gruppenmitglieder: Präfix 02:01 (lokal verwaltet), dann Gerätenummer und Mitglied. */
export function memberMac(seq: number, member: number): string {
  const bytes = [0x02, 0x01, (seq >> 8) & 0xff, seq & 0xff, (member >> 8) & 0xff, member & 0xff];
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

/**
 * Client-Gruppe: viele gleichartige Rechner (z.B. ein Büro mit 50 PCs), die
 * sich einen Anschluss teilen – als hingen sie an einem eigenen kleinen Switch.
 * Jedes Mitglied ist ein vollständiges Endgerät mit eigener MAC-Adresse und
 * bezieht seine Adresse per DHCP.
 */
export class ClientGroupNode implements SimNode {
  #members: HostNode[] = [];

  constructor(private readonly ctx: NodeContext) {}

  #device(): Device | undefined {
    return this.ctx.device();
  }

  #size(): number {
    return this.#device()?.groupSize ?? 0;
  }

  /** Mitglieder anlegen bzw. an eine geänderte Gruppengrösse anpassen. */
  #sync() {
    const size = this.#size();
    while (this.#members.length > size) this.#members.pop();
    while (this.#members.length < size) this.#members.push(this.#createMember(this.#members.length + 1));
  }

  #createMember(member: number): HostNode {
    const outer = this.ctx;
    const seq = deviceSeq(outer.device()?.id ?? 'd0');
    const mac = memberMac(seq, member);
    const ctx: NodeContext = {
      get now() {
        return outer.now;
      },
      device: () => {
        const device = outer.device();
        if (!device) return undefined;
        const { groupSize: _g, ...rest } = device;
        return { ...rest, id: `d${seq * 1000 + member}`, name: `${device.name} #${member}`, dhcp: true, interfaces: [{ index: 0, mac }] };
      },
      topology: () => outer.topology(),
      schedule: (delay, run) => outer.schedule(delay, run),
      transmit: (_iface, frame) => outer.transmit(0, frame),
      isConnected: () => outer.isConnected(0),
      print: (code, params) => outer.print(code, { ...params, member }),
      clearConsole: () => outer.clearConsole(),
    };
    return new HostNode(ctx);
  }

  members(): HostNode[] {
    this.#sync();
    return this.#members;
  }

  member(n: number): HostNode | undefined {
    return this.members()[n - 1];
  }

  boot() {
    this.members().forEach((host, i) => this.ctx.schedule(i * GROUP_BOOT_SPACING, () => host.ensureDhcp()));
  }

  receive(iface: number, frame: EthernetFrame) {
    const members = this.members();
    if (frame.dst === BROADCAST_MAC || frame.dst.startsWith('01:')) {
      for (const host of members) host.receive(iface, frame);
      return;
    }
    members.find((h) => h.macOf(0) === frame.dst)?.receive(iface, frame);
  }

  state() {
    const group: GroupMemberState[] = this.members().map((host, i) => {
      const address = host.address();
      return {
        member: i + 1,
        mac: host.macOf(0) ?? '',
        ...(address.ip ? { ip: address.ip } : {}),
        ...(address.dhcpState ? { dhcpState: address.dhcpState } : {}),
      };
    });
    return { group };
  }
}
