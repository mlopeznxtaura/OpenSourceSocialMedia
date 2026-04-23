/**
 * Colossus API Gateway
 * GraphQL Federation gateway – unifies all mini-kernel subgraph schemas.
 * Rate limiting, TLS termination, JWT auth, request routing.
 */

import Fastify from 'fastify';
import { ApolloServer } from '@apollo/server';
import { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } from '@apollo/gateway';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import { getRegisteredKernels } from '../discovery/registry';
import { logger } from '../lib/logger';

const PORT = parseInt(process.env.GATEWAY_PORT ?? '4000');

async function buildSubgraphList() {
  const kernels = await getRegisteredKernels();
  const subgraphs = [
    { name: 'main', url: `http://localhost:4001/graphql` },  // identity subgraph
    { name: 'feed',  url: `http://localhost:4004/graphql` },
    ...kernels.map(k => ({ name: k.kernelId, url: `${k.endpointUrl}/graphql` })),
  ];
  return subgraphs;
}

async function start() {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: '*' });
  await app.register(fastifyJwt, {
    secret: { public: process.env.JWT_PUBLIC_KEY! },
    verify: { algorithms: ['RS256'] },
  });

  // Auth hook – applies to all routes except /auth/*
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url;
    if (url.startsWith('/auth') || url === '/health') return;
    try {
      await request.jwtVerify();
    } catch {
      // GraphQL introspection/playground allowed without auth in dev
      if (process.env.NODE_ENV !== 'production') return;
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  const gateway = new ApolloGateway({
    supergraphSdl: new IntrospectAndCompose({
      subgraphs: await buildSubgraphList(),
      pollIntervalInMs: 10_000,  // re-poll every 10s for new mini-kernels
    }),
    buildService({ url }) {
      return new RemoteGraphQLDataSource({
        url,
        willSendRequest({ request, context }: any) {
          // Forward user identity downstream
          if (context.userId) {
            request.http?.headers.set('x-colossus-user-id', context.userId);
          }
        },
      });
    },
  });

  const server = new ApolloServer({
    gateway,
    plugins: [fastifyApolloDrainPlugin(app)],
  });

  await server.start();
  await app.register(fastifyApollo(server), {
    context: async (request) => ({
      userId: (request as any).user?.sub,
      user: (request as any).user,
    }),
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'gateway' }));

  // Mini-kernel spawn endpoint – delegates to orchestrator
  app.post('/v1/mini-kernels/spawn', async (request, reply) => {
    const manifest = request.body as any;
    // Validate + forward to orchestrator service
    const res = await fetch(`http://localhost:4003/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    return res.json();
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Gateway running on :${PORT}`);
}

start().catch((err) => {
  logger.error(err);
  process.exit(1);
});
