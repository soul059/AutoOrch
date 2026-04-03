import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://autoorch:autoorch_dev_password@localhost:5432/autoorch',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,    // 30s max per query — prevents hung queries
  query_timeout: 30000,
});

export default pool;
