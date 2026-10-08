// Shared harness for the REAL-concurrency suites (*.pg.test.js): a throw-away database on any real
// Postgres named by PG_CONCURRENCY_URL, with the live-table replica and the given migrations loaded.
import pg from 'pg'

export const hasRealPostgres = Boolean(process.env.PG_CONCURRENCY_URL)

/**
 * @param {string[]} sqlFiles   SQL texts, run in order after the roles are in place
 * @param {(index:number, db:{exec:(sql:string)=>Promise<any>})=>Promise<void>} [beforeFile]  optional hook run
 *        before each SQL file (e.g. to pre-create production-shaped stubs before the migration that replaces them)
 */
export async function createTestDatabase(sqlFiles, { beforeFile } = {}) {
  const base = process.env.PG_CONCURRENCY_URL
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  const dbName = `conc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  await admin.query(`create database ${dbName}`)
  const u = new URL(base)
  u.pathname = `/${dbName}`
  const pool = new pg.Pool({ connectionString: u.toString(), max: 40 })
  pool.on('error', () => {}) // a client torn down at database drop must not fail the run

  const c = await pool.connect()
  try {
    for (const role of ['anon', 'authenticated']) {
      await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`)
    }
    await c.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $$`)
    await c.query(`grant usage on schema public to anon, authenticated, service_role; alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
    for (let i = 0; i < sqlFiles.length; i++) {
      if (beforeFile) await beforeFile(i, { exec: (sql) => c.query(sql) })
      await c.query(sqlFiles[i])
    }
  } finally {
    c.release()
  }

  return {
    pool,
    async drop() {
      await pool.end()
      await admin.query(`drop database if exists ${dbName} with (force)`)
      await admin.end()
    },
  }
}
