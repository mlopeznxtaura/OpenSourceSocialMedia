import { Pool } from 'pg';
let pool: Pool;
export const db = {
  query: async (text: string, params?: any[]) => {
    if (!pool) pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    return pool.query(text, params);
  },
  getPool: () => {
    if (!pool) pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    return pool;
  },
};
