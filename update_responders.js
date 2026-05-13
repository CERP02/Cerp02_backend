const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const responders = [
  { name: 'Ghana Police Service', email: 'police@kasoa.gov.gh', plainPassword: 'GHpolice@crip123', role: 'responder', region: 'Kasoa' },
  { name: 'Ghana Water Company Ltd (GWCL)', email: 'gwcl@kasoa.gov.gh', plainPassword: 'GHwcl@crip123', role: 'responder', region: 'Kasoa' },
  { name: 'Electricity Company of Ghana (ECG)', email: 'ecg@kasoa.gov.gh', plainPassword: 'GHecg@crip123', role: 'responder', region: 'Kasoa' },
  { name: 'Ghana Highway Authority (GHA)', email: 'gha@kasoa.gov.gh', plainPassword: 'GHha@crip123', role: 'responder', region: 'Kasoa' },
  { name: 'Zoomlion Ghana Ltd', email: 'zoomlion@kasoa.gov.gh', plainPassword: 'GHzml@crip123', role: 'responder', region: 'Kasoa' },
  { name: 'Hydrological Services Department', email: 'hsd@kasoa.gov.gh', plainPassword: 'GHhsd@crip123', role: 'responder', region: 'Kasoa' },
  { name: 'Municipal Assembly', email: 'assembly@kasoa.gov.gh', plainPassword: 'GHmass@crip123', role: 'responder', region: 'Kasoa' }
];

async function updateDatabase() {
  try {
    console.log('Starting responder update...');

    // Delete all existing responders
    const deleteResult = await pool.query("DELETE FROM users WHERE role = 'responder'");
    console.log(`Deleted ${deleteResult.rowCount} existing responder accounts.`);

    // Insert new responders
    for (const r of responders) {
      const hash = await bcrypt.hash(r.plainPassword, 12);
      await pool.query(
        `INSERT INTO users (name, email, password_hash, role, region) VALUES ($1, $2, $3, $4, $5)`,
        [r.name, r.email.toLowerCase(), hash, r.role, r.region]
      );
      console.log(`Inserted responder: ${r.name}`);
    }

    console.log('Responder update completed successfully.');
  } catch (err) {
    console.error('Error updating responders:', err);
  } finally {
    await pool.end();
  }
}

updateDatabase();
