"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Import the Pool class from the pg library for managing PostgreSQL connections
const pg_1 = require("pg");
// Import dotenv to load environment variables from the .env file
const dotenv = require("dotenv");
// Load the .env file so process.env has DATABASE_URL and other config values
dotenv.config();
// Create a connection pool using the DATABASE_URL from the .env file
// A pool keeps multiple connections open and reuses them for efficiency
const pool = new pg_1.Pool({
    // The full PostgreSQL connection string including host, port, user, password, and database name
    connectionString: process.env.DATABASE_URL,
});
// Log a success message to the terminal whenever a new connection is established
pool.on("connect", () => {
    // Confirm the database connection is working
    console.log("✅ PostgreSQL connected to CERP community issue database");
});
// If a connection error occurs, log the error and terminate the process
// The process should restart via a process manager in production
pool.on("error", (err) => {
    // Log the connection error details
    console.error("❌ PostgreSQL connection error:", err.message);
    // Exit with code 1 to signal an abnormal termination
    process.exit(1);
});
// Export the pool so it can be imported and used in route handlers
exports.default = pool;
