#!/usr/bin/env node
/**
 * colossus CLI
 * Usage:
 *   colossus deploy --cloud aws --env production
 *   colossus spawn --manifest ./my-kernel/manifest.json
 *   colossus kernels list
 *   colossus kernels status <kernel-id>
 */
import { readFileSync } from 'fs';

const [,, command, ...args] = process.argv;
const GATEWAY = process.env.COLOSSUS_URL ?? 'http://localhost:4000';

async function main() {
  switch (command) {
    case 'spawn': {
      const manifestPath = args[args.indexOf('--manifest') + 1];
      if (!manifestPath) { console.error('--manifest required'); process.exit(1); }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const res = await fetch(`${GATEWAY}/v1/mini-kernels/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.COLOSSUS_TOKEN}` },
        body: JSON.stringify(manifest),
      });
      console.log(await res.json());
      break;
    }
    case 'kernels': {
      const sub = args[0];
      if (sub === 'list') {
        const res = await fetch(`http://localhost:4002/kernels`);
        const { kernels } = await res.json() as any;
        kernels.forEach((k: any) => console.log(`[${k.status}] ${k.kernelId} – ${k.name}`));
      } else if (sub === 'status') {
        const id = args[1];
        const res = await fetch(`http://localhost:4003/kernels/${id}/status`);
        console.log(await res.json());
      }
      break;
    }
    default:
      console.log(`colossus <command>\n  spawn --manifest <path>\n  kernels list\n  kernels status <id>`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
