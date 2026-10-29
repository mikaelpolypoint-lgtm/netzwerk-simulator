import { describe, expect, it } from 'vitest';
import { ui } from './ui.svelte';

describe('Funktionsdatei', () => {
  it('sperrt die Auswahl und gibt sie nur mit derselben Datei wieder frei', () => {
    ui.setProfile(2);
    ui.setFeature('net.vlan', true);
    const locked = ui.exportFile({ lock: true, title: 'INF 1' });
    expect(ui.applyFile(locked)?.lock).toBe(true);
    expect(ui.locked).toBe(true);
    expect(ui.has('net.vlan')).toBe(true);

    // Andere Datei (anderer Titel) entsperrt nicht.
    const other = locked.replace('INF 1', 'INF 2');
    expect(ui.unlockWith(other)).toBe(false);
    expect(ui.locked).toBe(true);
    // Eine ungesperrte Datei auch nicht.
    expect(ui.unlockWith(locked.replace('"lock": true', '"lock": false'))).toBe(false);

    expect(ui.unlockWith(locked)).toBe(true);
    expect(ui.locked).toBe(false);
    expect(ui.has('net.vlan')).toBe(true);
  });

  it('weist fremde Dateien ab', () => {
    expect(ui.applyFile('{"format":"etwas anderes"}')).toBeNull();
    expect(ui.applyFile('kein json')).toBeNull();
  });
});
