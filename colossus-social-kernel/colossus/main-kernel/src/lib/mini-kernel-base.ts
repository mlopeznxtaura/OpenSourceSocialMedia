/**
 * Base class for all Colossus mini-kernels.
 * Implements: registration, heartbeat, feed endpoint, event processing, GraphQL subgraph.
 * Every mini-kernel extends this and implements category-specific logic.
 */

import Fastify, { FastifyInstance } from 'fastify';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import { DocumentNode } from 'graphql';
import { logger } from './logger';
import { nats } from './nats';

const DISCOVERY_URL = process.env.DISCOVERY_URL ?? 'http://localhost:4002';
const KERNEL_ID = process.env.KERNEL_ID ?? 'unknown';
const PORT = parseInt(process.env.PORT ?? '5000');

export abstract class MiniKernelBase {
  protected app: FastifyInstance;
  abstract readonly kernelId: string;
  abstract readonly kernelName: string;
  abstract readonly category: string;
  abstract readonly version: string;
  abstract readonly eventSubscriptions: string[];

  abstract getTypeDefs(): DocumentNode;
  abstract getResolvers(): Record<string, any>;
  abstract processFeed(userIds: string[], limit: number, cursor?: string): Promise<any[]>;
  abstract processEvent(event: any): Promise<void>;

  constructor() {
    this.app = Fastify({ logger: false });
  }

  async start() {
    // REST: feed endpoint (called by main kernel feed aggregator)
    this.app.post('/feed', async (request) => {
      const { userIds, limit = 20, cursor } = request.body as any;
      const items = await this.processFeed(userIds, limit, cursor);
      return { items };
    });

    // REST: event ingestion
    this.app.post('/events', async (request) => {
      const event = request.body as any;
      await this.processEvent(event);
      return { accepted: true };
    });

    // Capabilities
    this.app.get('/capabilities', async () => ({
      kernelId: this.kernelId,
      kernelName: this.kernelName,
      category: this.category,
      version: this.version,
      eventSubscriptions: this.eventSubscriptions,
    }));

    this.app.get('/health', async () => ({ status: 'ok', kernelId: this.kernelId }));

    // GraphQL subgraph
    const schema = buildSubgraphSchema({
      typeDefs: this.getTypeDefs(),
      resolvers: this.getResolvers(),
    });
    const server = new ApolloServer({ schema, plugins: [fastifyApolloDrainPlugin(this.app)] });
    await server.start();
    await this.app.register(fastifyApollo(server), {
      context: async (req: any) => ({
        userId: req.headers['x-colossus-user-id'],
      }),
    });

    await this.app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info({ kernelId: this.kernelId, port: PORT }, 'Mini-kernel online');

    await this.register();
    this.startHeartbeat();
    await this.subscribeToEvents();
  }

  private async register() {
    try {
      await fetch(`${DISCOVERY_URL}/kernels/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kernelId: this.kernelId,
          name: this.kernelName,
          category: this.category,
          version: this.version,
          endpointUrl: `http://${KERNEL_ID}:${PORT}`,
          manifest: {},
        }),
      });
    } catch (err) {
      logger.warn({ err }, 'Registration failed – will retry');
    }
  }

  private startHeartbeat() {
    setInterval(async () => {
      try {
        await fetch(`${DISCOVERY_URL}/kernels/${this.kernelId}/heartbeat`, { method: 'POST' });
      } catch {}
    }, 30_000);
  }

  private async subscribeToEvents() {
    for (const subject of this.eventSubscriptions) {
      await nats.subscribe(subject, async (event: any) => {
        try { await this.processEvent(event); } catch (err) {
          logger.error({ err, subject }, 'Event processing error');
        }
      });
    }
  }
}
