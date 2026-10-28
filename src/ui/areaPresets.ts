import type { DocArea, TagColor } from '../core';
import { t } from '../i18n';

/** Vorlagen für Bereiche im Dokumentationsmodus. */
export interface AreaPreset {
  key: 'subnet' | 'vlan' | 'room' | 'zone' | 'rack';
  color: TagColor;
  width: number;
  height: number;
}

export const AREA_PRESETS: AreaPreset[] = [
  { key: 'subnet', color: 'blue', width: 360, height: 220 },
  { key: 'vlan', color: 'green', width: 360, height: 220 },
  { key: 'room', color: 'gray', width: 420, height: 280 },
  { key: 'zone', color: 'orange', width: 300, height: 200 },
  { key: 'rack', color: 'gray', width: 200, height: 200 },
];

export function presetArea(preset: AreaPreset, center: { x: number; y: number }, n: number, floor?: number): Omit<DocArea, 'id'> {
  return {
    ...(preset.key === 'rack' ? { kind: 'rack' as const } : {}),
    title: t(`areaPreset.${preset.key}.title`, { n }),
    color: preset.color,
    x: Math.round((center.x - preset.width / 2) / 10) * 10,
    y: Math.round((center.y - preset.height / 2) / 10) * 10,
    width: preset.width,
    height: preset.height,
    ...(floor !== undefined ? { floor } : {}),
  };
}
