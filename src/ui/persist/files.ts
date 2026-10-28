/** Bietet Text als Datei zum Herunterladen an, ohne Server. */
export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function projectFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `netzwerk-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
