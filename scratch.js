require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    const res = await pool.query('SELECT id, type, status, assigned_agency, reported_by FROM incidents;');
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
