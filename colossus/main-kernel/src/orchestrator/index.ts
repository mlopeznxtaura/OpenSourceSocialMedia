/**
 * Colossus Orchestrator
 * Watches spawn requests → validates manifest → creates K8s deployment.
 * Uses @kubernetes/client-node for programmatic K8s control.
 */

import Fastify from 'fastify';
import * as k8s from '@kubernetes/client-node';
import { z } from 'zod';
import { db } from '../lib/db';
import { nats } from '../lib/nats';
import { logger } from '../lib/logger';

const PORT = parseInt(process.env.ORCHESTRATOR_PORT ?? '4003');

const ManifestSchema = z.object({
  name: z.string().min(2).max(64),
  version: z.string(),
  category: z.string(),
  dockerImage: z.string().url(),
  resources: z.object({
    cpu: z.string().default('250m'),
    memory: z.string().default('512Mi'),
    minReplicas: z.number().int().min(1).max(20).default(2),
    maxReplicas: z.number().int().min(1).max(50).default(10),
  }),
  graphqlSchema: z.string(),
  eventSubscriptions: z.array(z.string()),
  oauthScopesNeeded: z.array(z.string()).default([]),
  storageBackends: z.array(z.string()).default(['s3']),
  uiModule: z.object({
    webComponent: z.string(),
    mobileComponent: z.string(),
    defaultRoute: z.string(),
  }),
});

type Manifest = z.infer<typeof ManifestSchema>;

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApps = kc.makeApiClient(k8s.AppsV1Api);
const k8sCore = kc.makeApiClient(k8s.CoreV1Api);

function kernelId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

async function spawnKernel(manifest: Manifest): Promise<string> {
  const id = kernelId(manifest.name);
  const namespace = process.env.K8S_NAMESPACE ?? 'colossus';
  const labels = { 'colossus.mini-kernel': id, 'app.kubernetes.io/managed-by': 'colossus-orchestrator' };

  // Create namespace if not exists
  try {
    await k8sCore.createNamespace({ metadata: { name: namespace } });
  } catch {}

  // Deployment
  const deployment: k8s.V1Deployment = {
    metadata: { name: `mk-${id}`, namespace, labels },
    spec: {
      replicas: manifest.resources.minReplicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [{
            name: 'kernel',
            image: manifest.dockerImage,
            ports: [{ containerPort: 5000 }],
            env: [
              { name: 'KERNEL_ID', value: id },
              { name: 'DISCOVERY_URL', value: `http://discovery:${4002}` },
              { name: 'NATS_URL', valueFrom: { secretKeyRef: { name: 'colossus-secrets', key: 'nats-url' } } },
              { name: 'POSTGRES_URL', valueFrom: { secretKeyRef: { name: 'colossus-secrets', key: 'postgres-url' } } },
            ],
            resources: {
              requests: { cpu: manifest.resources.cpu, memory: manifest.resources.memory },
              limits: { cpu: '2', memory: '2Gi' },
            },
            livenessProbe: {
              httpGet: { path: '/health', port: 5000 as any },
              initialDelaySeconds: 10, periodSeconds: 30,
            },
            readinessProbe: {
              httpGet: { path: '/health', port: 5000 as any },
              initialDelaySeconds: 5, periodSeconds: 10,
            },
          }],
        },
      },
    },
  };

  // HPA
  const hpa: k8s.V2HorizontalPodAutoscaler = {
    metadata: { name: `mk-${id}-hpa`, namespace },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: `mk-${id}` },
      minReplicas: manifest.resources.minReplicas,
      maxReplicas: manifest.resources.maxReplicas,
      metrics: [{
        type: 'Resource',
        resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } },
      }],
    },
  };

  // Service
  const service: k8s.V1Service = {
    metadata: { name: `mk-${id}`, namespace, labels },
    spec: {
      selector: labels,
      ports: [{ port: 5000, targetPort: 5000 as any, name: 'http' }],
    },
  };

  await k8sApps.createNamespacedDeployment(namespace, deployment);
  await k8sCore.createNamespacedService(namespace, service);

  await nats.publish('kernel.spawned', { kernelId: id, name: manifest.name });
  logger.info({ kernelId: id }, 'Mini-kernel spawned');
  return id;
}

async function start() {
  const app = Fastify({ logger: false });

  app.post('/spawn', async (request, reply) => {
    const parsed = ManifestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.format() });

    const manifest = parsed.data;
    const id = kernelId(manifest.name);

    // Check if community approval required (new categories need 7-day vote)
    const existing = await db.query('SELECT id FROM mini_kernel_registry WHERE kernel_id=$1', [id]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'Kernel already exists', kernelId: id });
    }

    // Store pending
    await db.query(
      `INSERT INTO mini_kernel_registry (kernel_id, name, category, version, endpoint_url, manifest, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [id, manifest.name, manifest.category, manifest.version,
       `http://mk-${id}:5000`, JSON.stringify(manifest)]
    );

    // Auto-approve known categories; others go to RFC vote
    const KNOWN_CATEGORIES = ['careers','social','photo','messaging','video','music','cad',
      'robotics','gaming','education','health','finance','travel','food','art',
      'writing','ecommerce','news','events','environment','tech','sports','parenting','mental-health'];

    if (KNOWN_CATEGORIES.includes(manifest.category)) {
      await spawnKernel(manifest);
      await db.query(
        `UPDATE mini_kernel_registry SET status='active', approved_at=NOW() WHERE kernel_id=$1`, [id]
      );
      return { status: 'spawned', kernelId: id };
    } else {
      await nats.publish('kernel.rfc.opened', { kernelId: id, manifest });
      return { status: 'pending_rfc', kernelId: id, message: 'New category requires 7-day RFC vote' };
    }
  });

  app.get('/kernels/:id/status', async (request) => {
    const { id } = request.params as any;
    const r = await db.query('SELECT * FROM mini_kernel_registry WHERE kernel_id=$1', [id]);
    return r.rows[0] ?? { error: 'Not found' };
  });

  app.get('/health', async () => ({ status: 'ok', service: 'orchestrator' }));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Orchestrator running on :${PORT}`);
}

start().catch((err) => { logger.error(err); process.exit(1); });
