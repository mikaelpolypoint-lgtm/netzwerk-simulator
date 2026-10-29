import { decodeIface, sviId, sviMac } from '../net/routing';
import type { EthernetFrame, Ipv4Packet } from './frames';
import { RouterNode } from './ip';
import type { IfaceAddress } from '../net/routing';
import type { NodeContext } from './simulation';
import { SwitchNode } from './switch';

/** IP-Teil eines Layer-3-Switches: seine «Anschlüsse» sind die VLAN-Interfaces (SVIs). */
class SviRouter extends RouterNode {
  constructor(
    ctx: NodeContext,
    private readonly owner: L3SwitchNode,
  ) {
    super(ctx);
  }

  protected override sendFrame(index: number, frame: EthernetFrame): boolean {
    const ref = decodeIface(index);
    if (ref.kind !== 'svi') return false;
    this.owner.injectLocal(ref.vlan, frame);
    return true;
  }

  /** «no ip routing»: Der Switch ist nur über seine SVIs erreichbar, leitet aber nicht weiter. */
  protected override outbound(inIface: IfaceAddress, outIface: IfaceAddress, packet: Ipv4Packet): Ipv4Packet | null {
    if (this.ctx.device()?.ipRouting === false) return null;
    return super.outbound(inIface, outIface, packet);
  }
}

/**
 * Layer-3-Switch: ein lernender Switch mit VLANs und Spanning Tree, der
 * zusätzlich über VLAN-Interfaces (SVIs) zwischen den VLANs routet.
 */
export class L3SwitchNode extends SwitchNode {
  readonly router: SviRouter;

  constructor(ctx: NodeContext) {
    super(ctx);
    const router = new SviRouter(ctx, this);
    this.router = router;
    this.local = {
      get mac() {
        const device = ctx.device();
        return device ? sviMac(device) : '';
      },
      has: (vlan) => !!ctx.device()?.svis?.some((s) => s.vlan === vlan),
      deliver: (vlan, frame) => router.receiveOn(sviId(vlan), frame),
    };
  }

  override boot() {
    super.boot();
    this.router.boot();
  }

  override state(): object {
    return { ...super.state(), ...this.router.state() };
  }
}
