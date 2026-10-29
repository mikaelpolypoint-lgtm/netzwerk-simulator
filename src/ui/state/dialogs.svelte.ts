/**
 * Welche Dialoge und Seitenbereiche offen sind. Als gemeinsamer Zustand, damit
 * Menüs, Tastenkürzel und die Befehlssuche sie gleichermassen öffnen können.
 */
export type DialogName =
  | 'about'
  | 'snapshots'
  | 'rack'
  | 'privacy'
  | 'feedback'
  | 'admin'
  | 'session'
  | 'catalog'
  | 'review'
  | 'taskEditor'
  | 'features'
  | 'shortcuts'
  | 'palette'
  | 'ipcalc'
  | 'vlans'
  | 'costs';

/** Werte, die der IP-Rechner übernehmen kann (z.B. in das Formular eines Rechners). */
export interface IpCalcTarget {
  ip?: string;
  mask?: string;
  /** Wird mit den gewählten Werten aufgerufen. */
  apply?: (values: { ip: string; mask: string; gateway: string; network: string }) => void;
}

class Dialogs {
  open = $state<DialogName | null>(null);
  ipcalc = $state.raw<IpCalcTarget>({});
  /** Hilfe-Seitenleiste mit dem gewählten Thema. */
  help = $state<string | null>(null);

  show(name: DialogName) {
    this.open = name;
  }

  close() {
    this.open = null;
  }

  ipCalculator(target: IpCalcTarget = {}) {
    this.ipcalc = target;
    this.open = 'ipcalc';
  }

  showHelp(topic = 'overview') {
    this.help = topic;
  }

  closeHelp() {
    this.help = null;
  }
}

export const dialogs = new Dialogs();
