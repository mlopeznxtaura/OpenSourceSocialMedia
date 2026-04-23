import { buildSubgraphSchema } from '@apollo/subgraph';
import { gql } from 'graphql-tag';
import { db } from '../lib/db';

const typeDefs = gql`
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@external"])

  type User @key(fields: "id") {
    id: ID!
    colossusId: String
    externalIdentities: [ExternalIdentity!]!
    createdAt: String!
  }

  type ExternalIdentity {
    provider: String!
    providerUserId: String!
    createdAt: String!
  }

  type AuthPayload {
    token: String!
    userId: ID!
  }

  type Query {
    me: User
    user(id: ID!): User
  }

  type Mutation {
    followUser(userId: ID!): Boolean!
    unfollowUser(userId: ID!): Boolean!
    blockUser(userId: ID!): Boolean!
    deleteAccount: Boolean!
  }
`;

const resolvers = {
  Query: {
    me: async (_: any, __: any, ctx: any) => {
      if (!ctx.userId) return null;
      const r = await db.query('SELECT * FROM users WHERE id=$1', [ctx.userId]);
      return r.rows[0];
    },
    user: async (_: any, { id }: any) => {
      const r = await db.query('SELECT id, colossus_id, created_at FROM users WHERE id=$1', [id]);
      return r.rows[0];
    },
  },
  User: {
    __resolveReference: async (ref: any) => {
      const r = await db.query('SELECT * FROM users WHERE id=$1', [ref.id]);
      return r.rows[0];
    },
    externalIdentities: async (user: any) => {
      const r = await db.query(
        'SELECT provider, provider_user_id, created_at FROM external_identities WHERE user_id=$1',
        [user.id]
      );
      return r.rows;
    },
  },
  Mutation: {
    followUser: async (_: any, { userId }: any, ctx: any) => {
      await db.query(
        'INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [ctx.userId, userId]
      );
      return true;
    },
    unfollowUser: async (_: any, { userId }: any, ctx: any) => {
      await db.query('DELETE FROM follows WHERE follower_id=$1 AND followee_id=$2', [ctx.userId, userId]);
      return true;
    },
    blockUser: async (_: any, { userId }: any, ctx: any) => {
      await db.query(
        'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [ctx.userId, userId]
      );
      return true;
    },
    deleteAccount: async (_: any, __: any, ctx: any) => {
      await db.query('DELETE FROM users WHERE id=$1', [ctx.userId]);
      return true;
    },
  },
};

export const buildSchema = () => buildSubgraphSchema({ typeDefs, resolvers });
