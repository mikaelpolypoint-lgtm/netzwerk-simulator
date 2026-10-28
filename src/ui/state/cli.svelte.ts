/** Welche Befehlszeile (Konsole am Gerät) gerade offen ist. */
export const cliWindow = $state<{ deviceId: string | null; generation: number }>({ deviceId: null, generation: 0 });

export function openCli(deviceId: string) {
  cliWindow.deviceId = deviceId;
  // Neue Sitzung auch beim erneuten Öffnen desselben Geräts.
  cliWindow.generation++;
}

export function closeCli() {
  cliWindow.deviceId = null;
}
