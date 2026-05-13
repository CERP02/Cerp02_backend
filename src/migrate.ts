import pool from "./db";

async function migrate() {
  console.log("🚀 Starting database migration...");
  try {
    // Drop the old role check constraint
    await pool.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    `);
    console.log("✅ Old role check dropped.");

    // Update existing 'citizen' roles to 'user'
    await pool.query(`
      UPDATE users SET role = 'user' WHERE role = 'citizen';
    `);
    console.log("✅ Existing 'citizen' roles updated to 'user'.");

    // Add new role check with 'user'
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'responder', 'admin', 'superadmin'));
    `);
    console.log("✅ New role check added.");

    // Change default role to 'user'
    await pool.query(`
      ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
    `);
    console.log("✅ Default role set to 'user'.");

    // Add security columns
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ;
    `);
    console.log("✅ Auth security columns added.");

    console.log("✨ Migration completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();
