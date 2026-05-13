import pool from "./db";

async function seedIncidents() {
  let userId: string;

  const userResult = await pool.query('SELECT id FROM users LIMIT 1');
  if (userResult.rows.length === 0) {
    console.log('No user found. Creating a sample user.');
    await pool.query(`
      INSERT INTO users (name, email, password_hash, role, region)
      VALUES ($1, $2, $3, $4, $5)
    `, ['Sample User', 'user@cerp.com', '$2a$12$vmHG48t0c0KzoVfJo9SFqOvKY09ix3MG4PeAIQpHnlDtj8ttOhCOi', 'user', 'Kasoa Central']);
    const newUser = await pool.query('SELECT id FROM users WHERE email = $1', ['user@cerp.com']);
    userId = newUser.rows[0].id;
  } else {
    userId = userResult.rows[0].id;
  }

  await pool.query(`
    INSERT INTO incidents (type, description, location_text, latitude, longitude, region, severity, status, reported_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    'other',
    'Heavy traffic congestion on Main Street due to construction',
    'Main Street, Kasoa Central',
    5.5300,
    -0.4100,
    'Kasoa Central',
    'moderate',
    'new',
    userId
  ]);

  console.log('Sample incident inserted.');
  process.exit(0);
}

seedIncidents().catch(console.error);