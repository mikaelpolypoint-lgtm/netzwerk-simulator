import { describe, expect, it } from 'vitest';
import { broadcastOf, checkHostConfig, formatIp, networkOf, parseIp, parseMask, sameSubnet } from './ipv4';

describe('IPv4-Adressen', () => {
  it('liest und schreibt Punktschreibweise', () => {
    expect(parseIp('192.168.0.1')).toBe(0xc0a80001);
    expect(formatIp(0xc0a80001)).toBe('192.168.0.1');
    expect(formatIp(parseIp('255.255.255.255')!)).toBe('255.255.255.255');
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', 'a.b.c.d', '1..2.3']) {
      expect(parseIp(bad)).toBeNull();
    }
  });

  it('versteht Masken als Punktschreibweise und als Präfix', () => {
    expect(parseMask('255.255.255.0')).toBe(24);
    expect(parseMask('/16')).toBe(16);
    expect(parseMask('8')).toBe(8);
    expect(parseMask('0.0.0.0')).toBe(0);
    expect(parseMask('255.255.255.255')).toBe(32);
    expect(parseMask('255.0.255.0')).toBeNull();
    expect(parseMask('/33')).toBeNull();
  });

  it('berechnet Netz und Broadcast', () => {
    const ip = parseIp('10.1.2.200')!;
    expect(formatIp(networkOf(ip, 25))).toBe('10.1.2.128');
    expect(formatIp(broadcastOf(ip, 25))).toBe('10.1.2.255');
    expect(sameSubnet(ip, parseIp('10.1.2.129')!, 25)).toBe(true);
    expect(sameSubnet(ip, parseIp('10.1.2.1')!, 25)).toBe(false);
  });
});

describe('Konfiguration prüfen', () => {
  const codes = (r: ReturnType<typeof checkHostConfig>) => ({
    errors: r.errors.map((e) => `${e.field}:${e.code}`),
    warnings: r.warnings.map((w) => `${w.field}:${w.code}`),
  });

  it('akzeptiert eine korrekte Konfiguration', () => {
    expect(codes(checkHostConfig({ ip: '192.168.1.10', mask: '/24', gateway: '192.168.1.1' }))).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('lehnt unlesbare Eingaben ab', () => {
    expect(codes(checkHostConfig({ ip: '192.168.1.300', mask: '24' })).errors).toEqual(['ip:invalidIp']);
    expect(codes(checkHostConfig({ ip: '192.168.1.3', mask: '' })).errors).toEqual(['mask:maskRequired']);
    expect(codes(checkHostConfig({ ip: '', mask: '', gateway: '10.0.0.1' })).errors).toEqual([
      'gateway:gatewayWithoutAddress',
    ]);
  });

  it('warnt bei fachlich fragwürdigen Adressen, ohne sie zu verbieten', () => {
    expect(codes(checkHostConfig({ ip: '192.168.1.0', mask: '24' })).warnings).toEqual(['ip:networkAddress']);
    expect(codes(checkHostConfig({ ip: '192.168.1.255', mask: '24' })).warnings).toEqual(['ip:broadcastAddress']);
    expect(codes(checkHostConfig({ ip: '127.0.0.5', mask: '8' })).warnings).toContain('ip:reservedAddress');
    expect(codes(checkHostConfig({ ip: '192.168.1.5', mask: '24', gateway: '192.168.2.1' })).warnings).toEqual([
      'gateway:gatewayOutsideSubnet',
    ]);
    expect(codes(checkHostConfig({ ip: '10.0.0.0', mask: '31' })).warnings).toEqual([]);
  });
});
