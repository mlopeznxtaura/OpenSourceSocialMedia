import { connect, NatsConnection, JSONCodec } from 'nats';
let nc: NatsConnection;
const jc = JSONCodec();
export const nats = {
  connect: async () => { nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' }); return nc; },
  publish: async (subject: string, payload: string | object) => {
    if (!nc) await nats.connect();
    const data = typeof payload === 'string' ? Buffer.from(payload) : jc.encode(payload);
    nc.publish(subject, data);
  },
  subscribe: async (subject: string, handler: (data: any) => void) => {
    if (!nc) await nats.connect();
    const sub = nc.subscribe(subject);
    (async () => { for await (const msg of sub) { try { handler(jc.decode(msg.data)); } catch {} } })();
    return sub;
  },
};
