import { parseMask } from '../net/ipv4';
import type { HostNode } from './host';

/** Befehle der simulierten Befehlszeile, angelehnt an Windows ("ipconfig", "tracert"). */
export const COMMANDS = ['ping', 'tracert', 'ipconfig', 'arp', 'cls', 'help'] as const;

export function runCommand(host: HostNode, line: string) {
  const ctx = host.ctx;
  const trimmed = line.trim();
  ctx.print('cmd.echo', { line: trimmed });
  if (!trimmed) return;
  const [command = '', ...args] = trimmed.split(/\s+/);
  const arg = args[0]?.toLowerCase();

  switch (command.toLowerCase()) {
    case 'ping':
      if (args[0]) host.ping(args[0]);
      else ctx.print('cmd.usage.ping');
      return;
    case 'tracert':
    case 'traceroute':
      if (args[0]) host.traceroute(args[0]);
      else ctx.print('cmd.usage.tracert');
      return;
    case 'ipconfig':
      if (!arg || arg === '/all') printIpconfig(host);
      else if (arg === '/release') host.releaseDhcp();
      else if (arg === '/renew') host.renewDhcp();
      else ctx.print('cmd.usage.ipconfig');
      return;
    case 'arp':
      if (!arg || arg === '-a') printArp(host);
      else if (arg === '-d') {
        host.clearArp();
        ctx.print('arp.cleared');
      } else ctx.print('cmd.usage.arp');
      return;
    case 'cls':
    case 'clear':
      ctx.clearConsole();
      return;
    case 'help':
    case 'hilfe':
    case '?':
      for (const name of COMMANDS) ctx.print(`help.${name}`);
      return;
    default:
      ctx.print('cmd.unknown', { cmd: command });
  }
}

function printIpconfig(host: HostNode) {
  const ctx = host.ctx;
  const device = ctx.device();
  const address = host.address();
  ctx.print('ipconfig.adapter', { name: device?.name ?? '', mac: device?.interfaces[0]?.mac ?? '' });
  ctx.print(`ipconfig.mode.${address.mode}`);
  if (!address.ip) {
    ctx.print(address.mode === 'dhcp' ? 'ipconfig.noLease' : 'ipconfig.noAddress');
    return;
  }
  ctx.print('ipconfig.ip', { ip: address.ip });
  ctx.print('ipconfig.mask', { mask: address.mask ?? '', prefix: address.mask ? (parseMask(address.mask) ?? '') : '' });
  ctx.print('ipconfig.gateway', { gateway: address.gateway ?? '–' });
  ctx.print('ipconfig.dns', { dns: address.dns ?? '–' });
  if (address.mode === 'dhcp' && address.server && address.expires !== undefined) {
    ctx.print('ipconfig.lease', { server: address.server, remaining: Math.max(0, Math.round((address.expires - ctx.now) / 1000)) });
  }
}

function printArp(host: HostNode) {
  const ctx = host.ctx;
  const entries = host.arpEntries();
  if (entries.length === 0) {
    ctx.print('arp.empty');
    return;
  }
  ctx.print('arp.header');
  for (const entry of entries) ctx.print('arp.entry', { ip: entry.ip, mac: entry.mac });
}
