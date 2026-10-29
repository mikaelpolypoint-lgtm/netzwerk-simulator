import { describe, expect, it } from 'vitest';
import { parseAddressInput, prefixForHosts, splitByHosts, splitEqual, subnetInfo } from './calc';
import { parseIp } from './ipv4';

describe('IP-Rechner', () => {
  it('berechnet Netz, Broadcast, Hosts, Wildcard und Binärdarstellung', () => {
    const { ip, prefix } = parseAddressInput('192.168.1.130/26')!;
    expect(subnetInfo(ip, prefix)).toMatchObject({
      network: '192.168.1.128',
      broadcast: '192.168.1.191',
      first: '192.168.1.129',
      last: '192.168.1.190',
      hosts: 62,
      mask: '255.255.255.192',
      wildcard: '0.0.0.63',
      maskBinary: '11111111.11111111.11111111.11000000',
      scope: 'private',
      addressClass: 'C',
    });
    expect(subnetInfo(parseIp('100.64.1.1')!, 10).scope).toBe('cgnat');
    expect(subnetInfo(parseIp('8.8.8.8')!, 24).scope).toBe('public');
    expect(parseAddressInput('10.0.0.1 255.0.0.0')).toEqual({ ip: parseIp('10.0.0.1'), prefix: 8 });
  });

  it('teilt gleichmässig und nach Bedarf (VLSM)', () => {
    const net = parseIp('192.168.10.0')!;
    expect(splitEqual(net, 24, 4)!.map((s) => `${s.network}/${s.prefix}`)).toEqual(['192.168.10.0/26', '192.168.10.64/26', '192.168.10.128/26', '192.168.10.192/26']);
    expect(prefixForHosts(50)).toBe(26);
    const vlsm = splitByHosts(net, 24, [20, 100, 2])!;
    expect(vlsm.map((v) => `${v.subnet.network}/${v.subnet.prefix}`)).toEqual(['192.168.10.128/27', '192.168.10.0/25', '192.168.10.160/30']);
    expect(splitByHosts(net, 24, [200, 200])).toBeNull();
  });
});
