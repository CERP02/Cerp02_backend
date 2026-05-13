// Import Router and types from Express to define route handlers
import { Router, Request, Response } from "express";

// Import bcryptjs to hash passwords before storing and to compare passwords on login
import bcrypt from "bcryptjs";

// Import jsonwebtoken to generate JWT tokens after successful authentication
import * as jwt from "jsonwebtoken";

// Load JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET;
// Load JWT expiry duration from environment or default to 7 days
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"];

// Import the shared database connection pool
import pool from "../db";

// Import the UserRole type to validate the role field during registration
import type { UserRole } from "../types";

// Import the auth middleware and AuthRequest type for the /me route
import { requireAuth } from "../middleware/auth";
// Import the AuthRequest type for typed request objects
import type { AuthRequest, JwtPayload } from "../types";

// Create a new Express Router instance to define auth-related routes
const router = Router();

// ── POST /auth/register ─────────────────────────────────────────────────────
// Allows a new user to create an account on the CERP community issue platform
// Returns a JWT token so the user is immediately logged in after registering
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  // Destructure the required fields from the request body
  // role defaults to "user" if not provided — most users are citizens
  // region is the Kasoa community town the user is based in
  const { name, email, password, role = "user", region } = req.body;

  // Validate that the required fields are present
  if (!name || !email || !password) {
    // Respond with 400 Bad Request if any required field is missing
    res.status(400).json({ error: "Name, email and password are required" });
    // Stop execution
    return;
  }

  // --- ROLE LOGIC ---
  // Default to user (equivalent to "citizen") for public signups.
  // Only allow role specification if the request is from an authenticated superadmin.
  let assignedRole: UserRole = "user";

  // Check if there's a valid superadmin token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
      if (decoded.role === "superadmin" && role) {
        assignedRole = role as UserRole;
      }
    } catch (err) {
      // If token is invalid, we just treat it as a public signup
    }
  }

  // Define the list of valid roles
  const validRoles: UserRole[] = ["user", "responder", "admin", "superadmin"];

  // Final validation of the assigned role
  if (!validRoles.includes(assignedRole)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  try {
    // Check if a user with this email already exists in the database
    const exists = await pool.query(
      // Query only the ID column for efficiency
      "SELECT id FROM users WHERE email = $1",
      // Normalize email to lowercase to prevent duplicate accounts with different casing
      [email.toLowerCase()]
    );

    // If a matching email was found, reject the registration
    if (exists.rows.length > 0) {
      // Return 409 Conflict indicating the email is already taken
      res.status(409).json({ error: "An account with this email already exists" });
      // Stop execution
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
      [name, email.toLowerCase(), password_hash, assignedRole, region || null]
    );

    // Get the newly created user from the query result
    const user = result.rows[0];

    // Ensure the JWT secret is configured
    if (!JWT_SECRET) {
      // Log the configuration error for server-side debugging
      console.error("JWT_SECRET is not configured");
      // Return 500 without exposing internal details
      res.status(500).json({ error: "Server configuration error" });
      // Stop execution
      return;
    }

    // Generate a JWT token containing the user's ID, role, and email
    const token = jwt.sign(
      // Payload embedded in the token
      { userId: user.id, role: user.role, email: user.email },
      // Secret key used to sign the token
      JWT_SECRET,
      // Token expiry duration
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Respond with 201 Created, the JWT token, and the user's profile
    res.status(201).json({
      // Success message
      message: "Account created successfully",
      // JWT token for authenticating future requests
      token,
      // User profile data for the frontend to display
      user: {
        // User's unique ID
        id: user.id,
        // User's full name
        name: user.name,
        // User's email address
        email: user.email,
        // User's role on the platform
        role: user.role,
        // User's Kasoa community town
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
    // Log the login attempt for debugging (remove in production)
    console.log("Login request received:", { body: req.body, headers: req.headers });

    // Destructure email and password from the request body
    const { email, password } = req.body;

    // Validate that both fields are present and are strings
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      // Log the invalid body for debugging
      console.log("Invalid request body:", { email, password });
      // Return 400 with a descriptive error
      res.status(400).json({ error: "Email and password are required and must be strings" });
      // Stop execution
      return;
    }

    // Look up the user by their email address
    const result = await pool.query(
      // Select all columns to get the password hash for comparison
      "SELECT * FROM users WHERE email = $1",
      // Normalize to lowercase to match the stored value
      [email.toLowerCase()]
    );

    // If no user was found with this email, return a generic error
    // We don't say "email not found" specifically to prevent user enumeration attacks
    if (result.rows.length === 0) {
      // Return 401 with a generic message
      res.status(401).json({ error: "Invalid email or password" });
      // Stop execution
      return;
    }

    // Get the user record from the query result
    const user = result.rows[0];

    // Check if the account is suspended
    if (user.status === "suspended") {
      res.status(403).json({ error: "Your account has been suspended. Please contact the platform superadmin." });
      return;
    }

    // Check if account is currently locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil((new Date(user.locked_until).getTime() - new Date().getTime()) / 60000);
      res.status(403).json({ error: `Account locked due to too many failed attempts. Try again in ${remainingMinutes} minutes.` });
      return;
    }

    // Compare the provided password against the stored bcrypt hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    // If the password does not match, increment attempts and handle lockout
    if (!passwordMatch) {
      const newAttempts = (user.login_attempts || 0) + 1;

      if (newAttempts >= 5) {
        // Lock account for 30 minutes
        const lockTime = new Date(Date.now() + 30 * 60 * 1000);
        await pool.query("UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3", [newAttempts, lockTime, user.id]);
        res.status(403).json({ error: "Too many failed attempts. Account locked for 30 minutes." });
      } else {
        await pool.query("UPDATE users SET login_attempts = $1 WHERE id = $2", [newAttempts, user.id]);
        res.status(401).json({ error: "Invalid email or password" });
      }
      return;
    }

    // On success, reset login attempts
    await pool.query("UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1", [user.id]);

    // Ensure the JWT secret is configured
    if (!JWT_SECRET) {
      // Log the configuration error
      console.error("JWT_SECRET is not configured");
      // Return 500 without details
      res.status(500).json({ error: "Server configuration error" });
      // Stop execution
      return;
    }

    // Generate a JWT token with the user's ID, role, and email
    const token = jwt.sign(
      // Payload embedded in the token
      { userId: user.id, role: user.role, email: user.email },
      // Secret key
      JWT_SECRET,
      // Expiry duration
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Respond with the token and the user's profile data
    res.json({
      // Success message
      message: "Login successful",
      // JWT token for future requests
      token,
      // User profile for the frontend
      user: {
        // User's unique ID
        id: user.id,
        // User's full name
        name: user.name,
        // User's email
        email: user.email,
        // User's role
        role: user.role,
        // User's Kasoa town
        region: user.region,
      },
    });
  } catch (err) {
    // Log the error for debugging
    console.error("Login error:", err);
    // Return a generic 500 error
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
      "SELECT id, name, email, role, region, created_at, status FROM users WHERE id = $1",
      // req.user is set by the requireAuth middleware
      [req.user?.userId]
    );

    // If no user was found (e.g. the account was deleted after the token was issued)
    if (result.rows.length === 0) {
      // Return 404 not found
      res.status(404).json({ error: "User not found" });
      // Stop execution
      return;
    }

    const user = result.rows[0];

    // Check if the user account is suspended
    if (user.status === "suspended") {
      res.status(403).json({ error: "Your account has been suspended." });
      return;
    }

    // Return the user's profile data
    res.json({ user });
  } catch (err) {
    // Log the error for debugging
    console.error("Me error:", err);
    // Return a generic 500 error
    res.status(500).json({ error: "Server error" });
  }
});

// Export the router so it can be mounted in src/index.ts
/**
 * POST /auth/forgot-password: Generate a password reset token
 */
router.post("/forgot-password", async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (result.rows.length === 0) {
      // For security, don't confirm if email exists. Just say "If exists, check email"
      res.json({ message: "If an account exists with this email, a reset link has been sent." });
      return;
    }

    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const expiry = new Date(Date.now() + 3600000); // 1 hour

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3",
      [token, expiry, email.toLowerCase()]
    );

    // In production, send an email. For now, we return the token in the response for demo purposes.
    res.json({ message: "Reset token generated", token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /auth/reset-password: Use token to set a new password
 */
router.post("/reset-password", async (req: Request, res: Response): Promise<void> => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    res.status(400).json({ error: "Token and new password are required" });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expiry > NOW()",
      [token]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: "Invalid or expired reset token" });
      return;
    }

    const userId = result.rows[0].id;
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    await pool.query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL, login_attempts = 0, locked_until = NULL WHERE id = $2",
      [hash, userId]
    );

    res.json({ message: "Password updated successfully. You can now log in." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
