const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  password: 'password', // Assuming default or no password, I'll check db.ts
  host: 'localhost',
  port: 5432,
  database: 'cerp'
});

async function run() {
  try {
    const res = await pool.query('SELECT id, type, status, assigned_agency FROM incidents;');
    console.log('Incidents:', res.rows);
    const users = await pool.query('SELECT id, name, email, role FROM users;');
    console.log('Users:', users.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
