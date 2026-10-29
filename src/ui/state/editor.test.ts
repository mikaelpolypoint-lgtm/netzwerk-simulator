import { beforeEach, describe, expect, it } from 'vitest';
import { emptyTopology } from '../../core';
import { editor } from './editor.svelte';

beforeEach(() => {
  editor.setMode('design');
  editor.setTool('select');
  editor.replace(emptyTopology(), { undoable: false });
  editor.setCanvasSize(800, 600);
  editor.fit();
});

describe('Editor', () => {
  it('verbindet im Kabelwerkzeug zwei Geräte und wählt das Kabel aus', () => {
    editor.addDevice('pc', { x: 0, y: 0 });
    editor.addDevice('switch', { x: 200, y: 0 });
    editor.setTool('cable');
    editor.cableClick('d1');
    expect(editor.cableSource).toBe('d1');
    editor.cableClick('d2');
    expect(editor.topology.cables).toHaveLength(1);
    expect(editor.selection).toEqual({ kind: 'cable', id: 'c3' });
    expect(editor.cableSource).toBeNull();
  });

  it('meldet einen vollen Startanschluss sofort', () => {
    editor.addDevice('pc', { x: 0, y: 0 });
    editor.addDevice('pc', { x: 200, y: 0 });
    editor.addDevice('pc', { x: 400, y: 0 });
    editor.setTool('cable');
    editor.cableClick('d1');
    editor.cableClick('d2');
    editor.cableClick('d1');
    expect(editor.cableSource).toBeNull();
    expect(editor.message).toMatchObject({ kind: 'error' });
  });

  it('legt ein Ziehen als einen einzigen Undo-Schritt ab', () => {
    editor.addDevice('pc', { x: 0, y: 0 });
    editor.beginDrag();
    editor.dragTo('d1', { x: 13, y: 0 });
    editor.dragTo('d1', { x: 57, y: 21 });
    editor.endDrag();
    expect(editor.topology.devices[0]!.position).toEqual({ x: 60, y: 20 });
    editor.undo();
    expect(editor.topology.devices[0]!.position).toEqual({ x: 0, y: 0 });
    editor.redo();
    expect(editor.topology.devices[0]!.position).toEqual({ x: 60, y: 20 });
  });

  it('sperrt Änderungen im Aktionsmodus', () => {
    editor.addDevice('pc', { x: 0, y: 0 });
    editor.setMode('simulation');
    editor.select({ kind: 'device', id: 'd1' });
    editor.deleteSelection();
    editor.addDevice('pc', { x: 100, y: 0 });
    expect(editor.topology.devices).toHaveLength(1);
    expect(editor.canUndo).toBe(false);
  });

  it('meldet Konfigurationsfehler mit Feld zurück', () => {
    editor.addDevice('pc', { x: 0, y: 0 });
    expect(editor.configureHost('d1', { ip: '10.0.0.1', mask: 'x' })).toMatchObject({ code: 'invalidMask', field: 'mask' });
    expect(editor.configureHost('d1', { ip: '10.0.0.1', mask: '8' })).toBeNull();
    expect(editor.topology.devices[0]!.interfaces[0]).toMatchObject({ ip: '10.0.0.1', mask: '255.0.0.0' });
  });

  it('hält die Bildmitte fest, wenn die Zeichenfläche kleiner wird', () => {
    expect(editor.view).toEqual({ x: 400, y: 300, scale: 1 });
    editor.setCanvasSize(800, 400);
    expect(editor.view).toEqual({ x: 400, y: 200, scale: 1 });
    // Gleiche Grösse nochmals: keine weitere Verschiebung.
    editor.setCanvasSize(800, 400);
    expect(editor.view).toEqual({ x: 400, y: 200, scale: 1 });
  });

  it('startet mit jedem geladenen Projekt eine neue Simulation', () => {
    const before = editor.generation;
    editor.replace(emptyTopology(), { undoable: true });
    expect(editor.generation).toBe(before + 1);
  });
});
