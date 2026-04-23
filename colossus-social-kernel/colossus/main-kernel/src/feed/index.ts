/**
 * Colossus Unified Feed Aggregator
 * Aggregates content from all active mini-kernels the user follows.
 * Supports: chronological, popularity, user-written JS/WASM algorithms,
 * and third-party algorithm mini-kernels.
 */

import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { Client as ESClient } from '@elastic/elasticsearch';
import { db } from '../lib/db';
import { nats } from '../lib/nats';
import { logger } from '../lib/logger';
import { getRegisteredKernels } from '../discovery/registry';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import { VM } from 'vm2';  // sandboxed user algorithm execution

const PORT = parseInt(process.env.FEED_PORT ?? '4004');
const es = new ESClient({ node: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200' });

type Algorithm = 'chronological' | 'popularity' | 'custom';

interface FeedOptions {
  userId: string;
  limit: number;
  cursor?: string;
  kernels?: string[];
  algorithm?: Algorithm;
  customAlgorithmId?: string;
}

async function getFolloweeIds(userId: string): Promise<string[]> {
  const r = await db.query('SELECT followee_id FROM follows WHERE follower_id=$1', [userId]);
  return r.rows.map(row => row.followee_id);
}

async function fetchFromKernel(kernelUrl: string, userIds: string[], limit: number, cursor?: string) {
  try {
    const res = await fetch(`${kernelUrl}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds, limit, cursor }),
      signal: AbortSignal.timeout(3000),
    });
    return res.json();
  } catch {
    return { items: [] };
  }
}

async function buildFeed(opts: FeedOptions) {
  const { userId, limit, cursor, kernels: filterKernels, algorithm = 'chronological' } = opts;

  // Get who user follows
  const followeeIds = await getFolloweeIds(userId);
  if (followeeIds.length === 0) return { items: [], pageInfo: { hasNextPage: false } };

  // Get active kernels
  const activeKernels = await getRegisteredKernels();
  const targetKernels = filterKernels
    ? activeKernels.filter(k => filterKernels.includes(k.kernelId))
    : activeKernels;

  // Fan out to all mini-kernels in parallel (fail-safe)
  const results = await Promise.allSettled(
    targetKernels.map(k => fetchFromKernel(k.endpointUrl, followeeIds, limit, cursor))
  );

  let allItems: any[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const items = (r.value.items ?? []).map((item: any) => ({
        ...item,
        sourceKernel: targetKernels[i]!.kernelId,
      }));
      allItems.push(...items);
    }
  });

  // Apply algorithm
  if (algorithm === 'chronological') {
    allItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (algorithm === 'popularity') {
    allItems.sort((a, b) => ((b.likes ?? 0) + (b.comments ?? 0)) - ((a.likes ?? 0) + (a.comments ?? 0)));
  } else if (algorithm === 'custom' && opts.customAlgorithmId) {
    allItems = await runCustomAlgorithm(userId, opts.customAlgorithmId, allItems);
  }

  const page = allItems.slice(0, limit);
  return {
    items: page,
    pageInfo: {
      hasNextPage: allItems.length > limit,
      endCursor: page[page.length - 1]?.id,
    },
  };
}

async function runCustomAlgorithm(userId: string, algorithmId: string, items: any[]): Promise<any[]> {
  const r = await db.query(
    'SELECT code, runtime FROM user_algorithms WHERE id=$1 AND user_id=$2 AND is_active=TRUE',
    [algorithmId, userId]
  );
  if (!r.rows[0]) return items;
  const { code, runtime } = r.rows[0];

  if (runtime === 'js') {
    // Sandboxed execution via vm2
    const vm = new VM({ timeout: 500, sandbox: {} });
    const fn = vm.run(`(items) => { ${code} }`);
    return fn(items);
  }
  return items;
}

// GraphQL subgraph
const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])

  type FeedConnection {
    items: [FeedItem!]!
    pageInfo: PageInfo!
  }

  type FeedItem {
    id: ID!
    sourceKernel: String!
    authorId: ID!
    payload: JSON
    createdAt: String!
    cursor: String
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  scalar JSON

  type Query {
    feed(limit: Int, cursor: String, kernels: [String!], algorithm: String, customAlgorithmId: ID): FeedConnection!
    userAlgorithms: [UserAlgorithm!]!
  }

  type UserAlgorithm {
    id: ID!
    name: String!
    runtime: String!
    isActive: Boolean!
    createdAt: String!
  }

  type Mutation {
    saveAlgorithm(name: String!, runtime: String!, code: String!): UserAlgorithm!
    setActiveAlgorithm(algorithmId: ID!): Boolean!
    indexContent(kernelId: String!, item: JSON!): Boolean!
  }
`;

const resolvers = {
  Query: {
    feed: async (_: any, args: any, ctx: any) => {
      return buildFeed({ userId: ctx.userId, limit: args.limit ?? 20, ...args });
    },
    userAlgorithms: async (_: any, __: any, ctx: any) => {
      const r = await db.query(
        'SELECT id, name, runtime, is_active, created_at FROM user_algorithms WHERE user_id=$1',
        [ctx.userId]
      );
      return r.rows;
    },
  },
  Mutation: {
    saveAlgorithm: async (_: any, args: any, ctx: any) => {
      const r = await db.query(
        'INSERT INTO user_algorithms (user_id, name, runtime, code) VALUES ($1,$2,$3,$4) RETURNING *',
        [ctx.userId, args.name, args.runtime, args.code]
      );
      return r.rows[0];
    },
    setActiveAlgorithm: async (_: any, { algorithmId }: any, ctx: any) => {
      await db.query('UPDATE user_algorithms SET is_active=FALSE WHERE user_id=$1', [ctx.userId]);
      await db.query('UPDATE user_algorithms SET is_active=TRUE WHERE id=$1 AND user_id=$2', [algorithmId, ctx.userId]);
      return true;
    },
    indexContent: async (_: any, { kernelId, item }: any) => {
      await es.index({ index: `kernel-${kernelId}`, document: item });
      return true;
    },
  },
};

async function start() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, {
    secret: { public: process.env.JWT_PUBLIC_KEY! },
    verify: { algorithms: ['RS256'] },
  });

  const schema = buildSubgraphSchema({ typeDefs, resolvers });
  const server = new ApolloServer({ schema, plugins: [fastifyApolloDrainPlugin(app)] });
  await server.start();
  await app.register(fastifyApollo(server), {
    context: async (request: any) => ({ userId: (request as any).user?.sub }),
  });

  app.get('/health', async () => ({ status: 'ok', service: 'feed' }));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Feed service running on :${PORT}`);
}

start().catch((err) => { logger.error(err); process.exit(1); });
