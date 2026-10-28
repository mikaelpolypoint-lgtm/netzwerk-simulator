import type { TagColor } from '../core';

/** Farben der Farbtags; kräftig genug für Beamer, unterscheidbar auch mit Formen/Namen. */
export const TAG_HEX: Record<TagColor, string> = {
  red: '#d92d20',
  orange: '#ef6c00',
  yellow: '#eab308',
  green: '#16a34a',
  teal: '#0d9488',
  blue: '#2563eb',
  purple: '#7c3aed',
  pink: '#db2777',
  gray: '#6b7280',
};

export const TAG_ORDER: TagColor[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];
