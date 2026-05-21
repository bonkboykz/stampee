import { pool } from './client.js';

// Run a transaction with `SET LOCAL app.user_id` so that PLpgSQL functions
// using `app.uid()` see the caller's identity.
export async function withUid<T>(userId: string | null, fn: (sql: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    }
    const result = await fn(async (text, params) => {
      const r = await client.query(text, params as any);
      return { rows: r.rows };
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
