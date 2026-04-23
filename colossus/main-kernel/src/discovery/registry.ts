/**
 * Discovery Service – mini-kernel registry backed by PostgreSQL + heartbeat tracking.
 * Mini-kernels register via REST; heartbeat every 30s marks them active.
 */

import { db } from '../lib/db';
import { nats } from '../lib/nats';
import { logger } from '../lib/logger';

export interface KernelRegistration {
  kernelId: string;
  name: string;
  category: string;
  version: string;
  endpointUrl: string;
  manifest: object;
  status: 'pending' | 'active' | 'degraded' | 'offline';
}

export async function registerKernel(reg: Omit<KernelRegistration, 'status'>) {
  await db.query(
    `INSERT INTO mini_kernel_registry (kernel_id, name, category, version, endpoint_url, manifest, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending')
     ON CONFLICT (kernel_id) DO UPDATE SET
       version=EXCLUDED.version, endpoint_url=EXCLUDED.endpoint_url,
       manifest=EXCLUDED.manifest, last_heartbeat=NOW()`,
    [reg.kernelId, reg.name, reg.category, reg.version, reg.endpointUrl, JSON.stringify(reg.manifest)]
  );
  await nats.publish('kernel.registered', { kernelId: reg.kernelId, category: reg.category });
  logger.info({ kernelId: reg.kernelId }, 'Mini-kernel registered');
}

export async function heartbeat(kernelId: string) {
  await db.query(
    `UPDATE mini_kernel_registry SET last_heartbeat=NOW(), status='active' WHERE kernel_id=$1`,
    [kernelId]
  );
}

export async function getRegisteredKernels(): Promise<KernelRegistration[]> {
  const r = await db.query(
    `SELECT kernel_id, name, category, version, endpoint_url, manifest, status
     FROM mini_kernel_registry WHERE status='active'`
  );
  return r.rows.map(row => ({
    kernelId: row.kernel_id,
    name: row.name,
    category: row.category,
    version: row.version,
    endpointUrl: row.endpoint_url,
    manifest: row.manifest,
    status: row.status,
  }));
}

export async function markOffline(kernelId: string) {
  await db.query(
    `UPDATE mini_kernel_registry SET status='offline' WHERE kernel_id=$1`,
    [kernelId]
  );
}

// Background: mark kernels with no heartbeat in 90s as offline
export function startHealthWatcher() {
  setInterval(async () => {
    await db.query(
      `UPDATE mini_kernel_registry SET status='offline'
       WHERE last_heartbeat < NOW() - INTERVAL '90 seconds' AND status='active'`
    );
  }, 30_000);
}
