import pool from "./src/db";

async function check() {
  const r = await pool.query('SELECT COUNT(*) FROM incidents');
  console.log('Total Incidents:', r.rows[0].count);
  
  const all = await pool.query('SELECT * FROM incidents LIMIT 5');
  console.log('Recent Incidents:', JSON.stringify(all.rows, null, 2));
  
  process.exit(0);
}

check();
