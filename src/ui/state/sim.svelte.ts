import { Simulation, type Topology } from '../../core';

/** Längster Zeitschritt pro Bild, damit ein Tab im Hintergrund nicht Minuten "nachholt". */
const MAX_FRAME_MS = 100;
const CLOCK_REFRESH_MS = 200;
/** In der Zeitlupe: kurze Pause zwischen zwei Übertragungen, bevor die Uhr zum nächsten Ereignis springt. */
const IDLE_PAUSE_MS = 250;
/** Längere Wartezeiten (z.B. DHCP-Erneuerung nach 30 Minuten) werden nicht übersprungen, sondern laufen in Echtzeit. */
const MAX_SKIP_MS = 2000;

export type Speed = 'realtime' | 'slow' | 'slower';

/** Echte Millisekunden pro virtueller Millisekunde, solange Rahmen unterwegs sind. */
const SLOWDOWN: Record<Speed, number> = { realtime: 1, slow: 300, slower: 1000 };

/**
 * Verbindet die Simulation mit der Oberfläche: Im Aktionsmodus läuft die
 * virtuelle Zeit, im Entwurfsmodus ist sie angehalten. In der Zeitlupe
 * laufen Übertragungen verlangsamt, Wartezeiten dazwischen werden
 * übersprungen, damit man jedem Rahmen folgen kann.
 * Komponenten lesen `tick`, um bei Änderungen neu zu zeichnen.
 */
class SimStore {
  tick = $state(0);
  speed = $state<Speed>('realtime');
  paused = $state(false);
  #sim: Simulation | null = null;
  #generation = -1;
  #frame = 0;
  #last = 0;
  #lastRefresh = 0;
  #idleSince = 0;

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

  togglePause() {
    this.paused = !this.paused;
  }

  /** Genau ein Ereignis verarbeiten; die Simulation bleibt danach angehalten. */
  step() {
    this.paused = true;
    this.#sim?.step();
    this.tick++;
  }

  runCommand(deviceId: string, line: string) {
    this.#sim?.runCommand(deviceId, line);
    this.tick++;
  }

  browse(deviceId: string, url: string) {
    this.#sim?.browse(deviceId, url);
    this.tick++;
  }

  sendMail(deviceId: string, message: { to: string[]; subject: string; body: string }) {
    this.#sim?.sendMail(deviceId, message);
    this.tick++;
  }

  fetchMail(deviceId: string) {
    this.#sim?.fetchMail(deviceId);
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

  #advance(sim: Simulation, elapsed: number, timestamp: number): number {
    if (this.speed === 'realtime') return sim.runUntil(sim.now + elapsed);
    if (sim.getInFlight().length > 0) {
      this.#idleSince = timestamp;
      return sim.runUntil(sim.now + elapsed / SLOWDOWN[this.speed]);
    }
    const next = sim.nextEventTime();
    if (next === undefined || next - sim.now > MAX_SKIP_MS) return sim.runUntil(sim.now + elapsed);
    if (timestamp - this.#idleSince < IDLE_PAUSE_MS) return 0;
    this.#idleSince = timestamp;
    return sim.runUntil(next);
  }

  #loop = (timestamp: number) => {
    const sim = this.#sim;
    if (!sim) return;
    const elapsed = Math.min(timestamp - this.#last, MAX_FRAME_MS);
    this.#last = timestamp;
    const processed = this.paused ? 0 : this.#advance(sim, elapsed, timestamp);
    // In der Zeitlupe bewegen sich Rahmen auch ohne neue Ereignisse: jedes Bild zeichnen.
    const animating = this.speed !== 'realtime' && sim.getInFlight().length > 0 && !this.paused;
    if (processed > 0 || animating || timestamp - this.#lastRefresh > CLOCK_REFRESH_MS) {
      this.#lastRefresh = timestamp;
      this.tick++;
    }
    this.#frame = requestAnimationFrame(this.#loop);
  };
}

export const simStore = new SimStore();
