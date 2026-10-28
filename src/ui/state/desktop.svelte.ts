/** Welcher simulierte Desktop gerade offen ist (nur im Aktionsmodus). */
export const desktop = $state<{ deviceId: string | null; app: string }>({ deviceId: null, app: 'terminal' });

export function openDesktop(deviceId: string, app = 'terminal') {
  desktop.deviceId = deviceId;
  desktop.app = app;
}

export function closeDesktop() {
  desktop.deviceId = null;
}
