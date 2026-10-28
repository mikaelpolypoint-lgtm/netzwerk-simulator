import { Simulation, type Topology } from '../../core';

/** Längster Zeitschritt pro Bild, damit ein Tab im Hintergrund nicht Minuten "nachholt". */
const MAX_FRAME_MS = 100;
const CLOCK_REFRESH_MS = 200;

/**
 * Verbindet die Simulation mit der Oberfläche: Im Aktionsmodus läuft die
 * virtuelle Zeit synchron zur echten, im Entwurfsmodus ist sie angehalten.
 * Komponenten lesen `tick`, um bei Änderungen neu zu zeichnen.
 */
class SimStore {
  tick = $state(0);
  #sim: Simulation | null = null;
  #generation = -1;
  #frame = 0;
  #last = 0;
  #lastRefresh = 0;

  get sim(): Simulation | null {
    return this.#sim;
  }

  activate(topology: Topology, generation: number) {
    if (!this.#sim || generation !== this.#generation) {
      this.#sim = new Simulation(topology);
      this.#generation = generation;
    } else {
      this.#sim.updateTopology(topology);
    }
    this.tick++;
    if (!this.#frame) {
      this.#last = performance.now();
      this.#frame = requestAnimationFrame(this.#loop);
    }
  }

  deactivate() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  ping(deviceId: string, target: string) {
    this.#sim?.ping(deviceId, target);
    this.tick++;
  }

  clearPacketLog() {
    this.#sim?.clearPacketLog();
    this.tick++;
  }

  clearConsole(deviceId: string) {
    this.#sim?.clearConsole(deviceId);
    this.tick++;
  }

  #loop = (timestamp: number) => {
    const sim = this.#sim;
    if (!sim) return;
    const elapsed = Math.min(timestamp - this.#last, MAX_FRAME_MS);
    this.#last = timestamp;
    const processed = sim.runUntil(sim.now + elapsed);
    if (processed > 0 || timestamp - this.#lastRefresh > CLOCK_REFRESH_MS) {
      this.#lastRefresh = timestamp;
      this.tick++;
    }
    this.#frame = requestAnimationFrame(this.#loop);
  };
}

export const simStore = new SimStore();
