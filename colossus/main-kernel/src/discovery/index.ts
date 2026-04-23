import Fastify from 'fastify';
import { registerKernel, heartbeat, getRegisteredKernels, startHealthWatcher } from './registry';
import { logger } from '../lib/logger';

const PORT = parseInt(process.env.DISCOVERY_PORT ?? '4002');

async function start() {
  const app = Fastify({ logger: false });

  app.post('/kernels/register', async (request, reply) => {
    const body = request.body as any;
    await registerKernel(body);
    return { registered: true, kernelId: body.kernelId };
  });

  app.post('/kernels/:kernelId/heartbeat', async (request) => {
    const { kernelId } = request.params as any;
    await heartbeat(kernelId);
    return { ok: true };
  });

  app.get('/kernels', async () => {
    const kernels = await getRegisteredKernels();
    return { kernels };
  });

  app.get('/health', async () => ({ status: 'ok', service: 'discovery' }));

  startHealthWatcher();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Discovery service running on :${PORT}`);
}

start().catch((err) => { logger.error(err); process.exit(1); });
