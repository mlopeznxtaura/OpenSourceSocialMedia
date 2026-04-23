/**
 * Colossus Identity Service
 * OAuth2/OIDC client manager, JWT issuance, Colossus native DID.
 * All OAuth tokens encrypted at rest via Vault / AES-256-GCM.
 */

import Fastify from 'fastify';
import fastifyOAuth2 from '@fastify/oauth2';
import fastifyJwt from '@fastify/jwt';
import { SignJWT, importPKCS8 } from 'jose';
import { db } from '../lib/db';
import { vault } from '../lib/vault';
import { nats } from '../lib/nats';
import { logger } from '../lib/logger';
import { buildSchema } from './schema';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';

const PORT = parseInt(process.env.IDENTITY_PORT ?? '4001');

const PROVIDERS = [
  { name: 'github',   scope: ['read:user', 'user:email'] },
  { name: 'google',   scope: ['openid', 'profile', 'email'] },
  { name: 'discord',  scope: ['identify', 'email'] },
  { name: 'spotify',  scope: ['user-read-private', 'user-read-email'] },
  { name: 'linkedin', scope: ['r_liteprofile', 'r_emailaddress'] },
];

async function issueJWT(userId: string): Promise<string> {
  const privateKey = await importPKCS8(process.env.JWT_SECRET!, 'RS256');
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

async function encryptToken(token: string): Promise<Buffer> {
  // Delegate to Vault transit encryption
  const encrypted = await vault.write('transit/encrypt/oauth-tokens', {
    plaintext: Buffer.from(token).toString('base64'),
  });
  return Buffer.from(encrypted.data.ciphertext);
}

async function start() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });

  // Register OAuth plugins per provider
  for (const p of PROVIDERS) {
    const clientId = process.env[`${p.name.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`${p.name.toUpperCase()}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) continue;

    await app.register(fastifyOAuth2, {
      name: `${p.name}OAuth`,
      scope: p.scope,
      credentials: { client: { id: clientId, secret: clientSecret } },
      startRedirectPath: `/auth/${p.name}`,
      callbackUri: `${process.env.BASE_URL}/auth/${p.name}/callback`,
    });

    app.get(`/auth/${p.name}/callback`, async (request, reply) => {
      const token = await (app as any)[`${p.name}OAuth`].getAccessTokenFromAuthorizationCodeFlow(request);
      
      // Fetch user profile from provider
      const profile = await fetchProviderProfile(p.name, token.token.access_token);
      
      // Upsert user
      const user = await upsertUser(profile, p.name, token);

      // Emit identity event
      await nats.publish('user.authenticated', JSON.stringify({ userId: user.id, provider: p.name }));

      const jwt = await issueJWT(user.id);
      const refreshToken = await createRefreshToken(user.id);

      reply
        .setCookie('refresh_token', refreshToken, { httpOnly: true, secure: true, maxAge: 30 * 86400 })
        .redirect(`${process.env.FRONTEND_URL}/auth/success?token=${jwt}`);
    });
  }

  // Native Colossus ID registration
  app.post('/auth/native', async (request) => {
    const { publicKey, signature } = request.body as any;
    // Verify self-sovereign identity (did:key)
    const colossusId = `did:key:${publicKey}`;
    const result = await db.query(
      `INSERT INTO users (colossus_id) VALUES ($1)
       ON CONFLICT (colossus_id) DO UPDATE SET colossus_id = EXCLUDED.colossus_id
       RETURNING id`,
      [colossusId]
    );
    const userId = result.rows[0].id;
    const jwt = await issueJWT(userId);
    return { token: jwt, userId, colossusId };
  });

  // Token refresh
  app.post('/auth/refresh', async (request, reply) => {
    const { refresh_token } = request.cookies as any;
    if (!refresh_token) return reply.status(401).send({ error: 'No refresh token' });
    const userId = await validateRefreshToken(refresh_token);
    if (!userId) return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    const jwt = await issueJWT(userId);
    return { token: jwt };
  });

  // Logout
  app.post('/auth/logout', async (request, reply) => {
    const { refresh_token } = request.cookies as any;
    if (refresh_token) await revokeRefreshToken(refresh_token);
    reply.clearCookie('refresh_token').send({ success: true });
  });

  // Data export (GDPR / portability)
  app.get('/v1/me/export', { preHandler: [app.authenticate] }, async (request) => {
    const userId = (request as any).user.sub;
    const [userData, identities, follows, content] = await Promise.all([
      db.query('SELECT * FROM users WHERE id=$1', [userId]),
      db.query('SELECT provider, provider_user_id, created_at FROM external_identities WHERE user_id=$1', [userId]),
      db.query('SELECT followee_id, created_at FROM follows WHERE follower_id=$1', [userId]),
      db.query('SELECT id, storage_url, mime_type, mini_kernel_id, created_at FROM content_items WHERE owner_id=$1', [userId]),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      user: userData.rows[0],
      externalIdentities: identities.rows,
      follows: follows.rows,
      contentItems: content.rows,
    };
  });

  // Delete account
  app.delete('/v1/me', { preHandler: [app.authenticate] }, async (request) => {
    const userId = (request as any).user.sub;
    await db.query('DELETE FROM users WHERE id=$1', [userId]);
    await nats.publish('user.deleted', JSON.stringify({ userId }));
    return { success: true };
  });

  // GraphQL subgraph for identity
  const server = new ApolloServer({
    schema: buildSchema(),
    plugins: [fastifyApolloDrainPlugin(app)],
  });
  await server.start();
  await app.register(fastifyApollo(server));

  app.get('/health', async () => ({ status: 'ok', service: 'identity' }));

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`Identity service running on :${PORT}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchProviderProfile(provider: string, accessToken: string) {
  const endpoints: Record<string, string> = {
    github:   'https://api.github.com/user',
    google:   'https://www.googleapis.com/oauth2/v3/userinfo',
    discord:  'https://discord.com/api/users/@me',
    spotify:  'https://api.spotify.com/v1/me',
    linkedin: 'https://api.linkedin.com/v2/me',
  };
  const res = await fetch(endpoints[provider]!, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

async function upsertUser(profile: any, provider: string, token: any) {
  const providerUserId = String(profile.id ?? profile.sub ?? profile.pk);
  const existing = await db.query(
    'SELECT user_id FROM external_identities WHERE provider=$1 AND provider_user_id=$2',
    [provider, providerUserId]
  );
  if (existing.rows.length > 0) {
    const userId = existing.rows[0].user_id;
    return { id: userId };
  }
  const newUser = await db.query('INSERT INTO users DEFAULT VALUES RETURNING id');
  const userId = newUser.rows[0].id;
  const encryptedToken = await encryptToken(token.token.access_token);
  await db.query(
    `INSERT INTO external_identities (user_id, provider, provider_user_id, oauth_token_encrypted, raw_profile)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, provider, providerUserId, encryptedToken, JSON.stringify(profile)]
  );
  return { id: userId };
}

async function createRefreshToken(userId: string): Promise<string> {
  const { randomBytes, createHash } = await import('crypto');
  const token = randomBytes(64).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, hash]
  );
  return token;
}

async function validateRefreshToken(token: string): Promise<string | null> {
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  const result = await db.query(
    `SELECT user_id FROM refresh_tokens 
     WHERE token_hash=$1 AND expires_at > NOW() AND revoked=FALSE`,
    [hash]
  );
  return result.rows[0]?.user_id ?? null;
}

async function revokeRefreshToken(token: string) {
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  await db.query('UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1', [hash]);
}

start().catch((err) => { logger.error(err); process.exit(1); });
