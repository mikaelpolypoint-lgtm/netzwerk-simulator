import type { EthernetFrame } from './frames';
import type { NodeContext, SimNode } from './simulation';

/** Switch ohne Lerntabelle: leitet jeden Rahmen an alle anderen belegten Ports weiter. */
export class SwitchNode implements SimNode {
  constructor(private readonly ctx: NodeContext) {}

  receive(inPort: number, frame: EthernetFrame) {
    const device = this.ctx.device();
    if (!device) return;
    for (const port of device.interfaces) {
      if (port.index !== inPort) this.ctx.transmit(port.index, frame);
    }
  }

  state() {
    return {};
  }
}
