/**
 * PAPERCRASH API — Acceso a Neon PostgreSQL (@neondatabase/serverless Pool)
 */
import { Pool } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL?.trim() || '';

const pool = connectionString ? new Pool({ connectionString, max: 5 }) : null;

export function hasDatabase() {
  return Boolean(pool);
}

/**
 * Ejecuta una consulta parametrizada en Neon usando $1, $2, ...
 * @param {string} queryText
 * @param {any[]} [params]
 * @returns {Promise<any[]>}
 */
export async function query(queryText, params = []) {
  if (!pool) {
    throw new Error('DATABASE_URL no configurado en las variables de entorno.');
  }
  const res = await pool.query(queryText, params);
  return res.rows;
}

/** Ping rápido para /api/health (también despierta Render + Neon). */
export async function pingDatabase() {
  if (!pool) return { connected: false, reason: 'NO_DATABASE_URL' };
  const rows = await query('SELECT 1 AS ok');
  return { connected: rows?.[0]?.ok === 1 };
}
