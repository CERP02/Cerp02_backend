// Import Router and types from Express to define route handlers
import { Router, Request, Response } from "express";

// Import bcryptjs to hash passwords before storing and to compare passwords on login
import bcrypt from "bcryptjs";

// Import jsonwebtoken to generate JWT tokens after successful authentication
import * as jwt from "jsonwebtoken";

// Load JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"];

// Import the shared database connection pool
import pool from "../db";

// Import the UserRole type to validate the role field during registration
import type { UserRole } from "../types";

// Import the auth middleware and AuthRequest type for the /me route
import { requireAuth } from "../middleware/auth";
import type { AuthRequest } from "../types";

// Create a new Express Router instance to define auth-related routes
const router = Router();

// ── POST /auth/register ─────────────────────────────────────────────────────
// Allows a new user to create an account on the CERP platform
// Returns a JWT token so the user is immediately logged in after registering
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  // Destructure the required fields from the request body
  // role defaults to "citizen" if not provided — most users are citizens
  // region is the Kasoa community town the user is based in
  const { name, email, password, role = "citizen", region } = req.body;

  // Validate that the required fields are present
  if (!name || !email || !password) {
    // Respond with 400 Bad Request if any required field is missing
    res.status(400).json({ error: "Name, email and password are required" });
    return;
  }

  // Define the list of valid roles to prevent arbitrary role assignment
  const validRoles: UserRole[] = ["citizen", "responder", "admin"];

  // Reject the request if an invalid role was provided
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be citizen, responder, or admin" });
    return;
  }

  try {
    // Check if a user with this email already exists in the database
    const exists = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      // Normalize email to lowercase to prevent duplicate accounts with different casing
      [email.toLowerCase()]
    );

    // If a matching email was found, reject the registration
    if (exists.rows.length > 0) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    // Hash the password with bcrypt using a cost factor of 12
    // Higher cost = more secure but slower — 12 is a good production balance
    const password_hash = await bcrypt.hash(password, 12);

    // Insert the new user into the database and return the created record
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, region)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, region, created_at`,
      // Pass parameterized values to prevent SQL injection
      [name, email.toLowerCase(), password_hash, role, region || null]
    );

    // Get the newly created user from the query result
    const user = result.rows[0];

    // Ensure the JWT secret is configured
    if (!JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    // Generate a JWT token containing the user's ID, role, and email
    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Respond with 201 Created, the JWT token, and the user's profile
    res.status(201).json({
      message: "Account created successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region: user.region,
      },
    });
  } catch (err) {
    // Log the error for server-side debugging
    console.error("Register error:", err);
    // Respond with a generic 500 error — don't expose internal details
    res.status(500).json({ error: "Server error during registration" });
  }
});

// ── POST /auth/login ────────────────────────────────────────────────────────
// Authenticates an existing user and returns a JWT token
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("Login request received:", { body: req.body, headers: req.headers });

    // Destructure email and password from the request body
    const { email, password } = req.body;

    // Validate that both fields are present and are strings
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      console.log("Invalid request body:", { email, password });
      res.status(400).json({ error: "Email and password are required and must be strings" });
      return;
    }

    // Look up the user by their email address
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      // Normalize to lowercase to match the stored value
      [email.toLowerCase()]
    );

    // If no user was found with this email, return a generic error
    // We don't say "email not found" specifically to prevent user enumeration attacks
    if (result.rows.length === 0) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Get the user record from the query result
    const user = result.rows[0];

    // Compare the provided password against the stored bcrypt hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    // If the password does not match, return the same generic error
    if (!passwordMatch) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Ensure the JWT secret is configured
    if (!JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      res.status(500).json({ error: "Server configuration error" });
      return;
    }

    // Generate a JWT token with the user's ID, role, and email
    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Respond with the token and the user's profile data
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region: user.region,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ── GET /auth/me ────────────────────────────────────────────────────────────
// Returns the profile of the currently logged-in user
// Requires a valid JWT token in the Authorization header
router.get("/me", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Look up the user by the ID extracted from the JWT token
    const result = await pool.query(
      // Select all profile fields except the password hash
      "SELECT id, name, email, role, region, created_at FROM users WHERE id = $1",
      // req.user is set by the requireAuth middleware
      [req.user?.userId]
    );

    // If no user was found (e.g. the account was deleted after the token was issued)
    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Return the user's profile data
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Export the router so it can be mounted in src/index.ts
export default router;
