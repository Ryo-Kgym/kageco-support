import "server-only";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";

type Query = <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<Row[]>;

interface Database {
  query: Query;
  transaction: <Result>(work: (query: Query) => Promise<Result>) => Promise<Result>;
}

const schema = `
  CREATE TABLE IF NOT EXISTS forecast_preferences (
    year integer NOT NULL,
    mode text NOT NULL CHECK (mode IN ('real', 'demo')),
    tax jsonb NOT NULL DEFAULT '{}'::jsonb,
    plans jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_closed_month integer CHECK (last_closed_month BETWEEN 0 AND 12),
    PRIMARY KEY (year, mode)
  );
  CREATE TABLE IF NOT EXISTS freee_connections (
    id boolean PRIMARY KEY CHECK (id),
    company_id bigint NOT NULL,
    company_name text NOT NULL,
    version uuid NOT NULL,
    encrypted_tokens text NOT NULL,
    sync_id uuid,
    sync_until timestamptz
  );
  CREATE TABLE IF NOT EXISTS freee_snapshots (
    company_id bigint NOT NULL,
    year integer NOT NULL,
    snapshot jsonb NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, year)
  );
  CREATE TABLE IF NOT EXISTS oauth_attempts (
    state_hash text PRIMARY KEY,
    session_id text NOT NULL,
    expires_at timestamptz NOT NULL
  );
`;

function pooledQuery(connection: Pool | PoolClient): Query {
  return async <Row>(sql: string, params?: unknown[]) => (await connection.query(sql, params)).rows as Row[];
}

async function initialize(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
    pool.on("error", () => { console.error("PostgreSQL idle connection failed"); });
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(682026)");
        await client.query(schema);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      await pool.end();
      throw error;
    }
    return {
      query: pooledQuery(pool),
      async transaction(work) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work(pooledQuery(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }

  if (process.env.NODE_ENV !== "development") throw new Error("DATABASE_URL is required");
  const dataPath = join(process.cwd(), ".data");
  await mkdir(dataPath, { recursive: true, mode: 0o700 });
  const local = await PGlite.create(join(dataPath, "postgres"));
  await local.exec(schema);
  return {
    query: async <Row>(sql: string, params?: unknown[]) => (await local.query<Row>(sql, params)).rows,
    transaction: (work) => local.transaction((tx) => work(
      async <Row>(sql: string, params?: unknown[]) => (await tx.query<Row>(sql, params)).rows,
    )),
  };
}

const state = globalThis as typeof globalThis & { kagecoDatabase?: Promise<Database> };

export function database() {
  state.kagecoDatabase ??= initialize().catch((error: unknown) => {
    delete state.kagecoDatabase;
    throw error;
  });
  return state.kagecoDatabase;
}
