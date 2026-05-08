"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Import Router and types from Express to define route handlers
const express_1 = require("express");
// Import bcryptjs to hash passwords before storing and to compare passwords on login
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// Import jsonwebtoken to generate JWT tokens after successful authentication
const jwt = __importStar(require("jsonwebtoken"));
// Load JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d");
// Import the shared database connection pool
const db_1 = __importDefault(require("../db"));
// Import the auth middleware and AuthRequest type for the /me route
const auth_1 = require("../middleware/auth");
// Create a new Express Router instance to define auth-related routes
const router = (0, express_1.Router)();
// ── POST /auth/register ─────────────────────────────────────────────────────
// Allows a new user to create an account on the CERP platform
// Returns a JWT token so the user is immediately logged in after registering
router.post("/register", async (req, res) => {
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
    const validRoles = ["citizen", "responder", "admin"];
    // Reject the request if an invalid role was provided
    if (!validRoles.includes(role)) {
        res.status(400).json({ error: "Invalid role. Must be citizen, responder, or admin" });
        return;
    }
    try {
        // Check if a user with this email already exists in the database
        const exists = await db_1.default.query("SELECT id FROM users WHERE email = $1", 
        // Normalize email to lowercase to prevent duplicate accounts with different casing
        [email.toLowerCase()]);
        // If a matching email was found, reject the registration
        if (exists.rows.length > 0) {
            res.status(409).json({ error: "An account with this email already exists" });
            return;
        }
        // Hash the password with bcrypt using a cost factor of 12
        // Higher cost = more secure but slower — 12 is a good production balance
        const password_hash = await bcryptjs_1.default.hash(password, 12);
        // Insert the new user into the database and return the created record
        const result = await db_1.default.query(`INSERT INTO users (name, email, password_hash, role, region)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, region, created_at`, 
        // Pass parameterized values to prevent SQL injection
        [name, email.toLowerCase(), password_hash, role, region || null]);
        // Get the newly created user from the query result
        const user = result.rows[0];
        // Ensure the JWT secret is configured
        if (!JWT_SECRET) {
            console.error("JWT_SECRET is not configured");
            res.status(500).json({ error: "Server configuration error" });
            return;
        }
        // Generate a JWT token containing the user's ID, role, and email
        const token = jwt.sign({ userId: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
    }
    catch (err) {
        // Log the error for server-side debugging
        console.error("Register error:", err);
        // Respond with a generic 500 error — don't expose internal details
        res.status(500).json({ error: "Server error during registration" });
    }
});
// ── POST /auth/login ────────────────────────────────────────────────────────
// Authenticates an existing user and returns a JWT token
router.post("/login", async (req, res) => {
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
        const result = await db_1.default.query("SELECT * FROM users WHERE email = $1", 
        // Normalize to lowercase to match the stored value
        [email.toLowerCase()]);
        // If no user was found with this email, return a generic error
        // We don't say "email not found" specifically to prevent user enumeration attacks
        if (result.rows.length === 0) {
            res.status(401).json({ error: "Invalid email or password" });
            return;
        }
        // Get the user record from the query result
        const user = result.rows[0];
        // Compare the provided password against the stored bcrypt hash
        const passwordMatch = await bcryptjs_1.default.compare(password, user.password_hash);
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
        const token = jwt.sign({ userId: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
    }
    catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error during login" });
    }
});
// ── GET /auth/me ────────────────────────────────────────────────────────────
// Returns the profile of the currently logged-in user
// Requires a valid JWT token in the Authorization header
router.get("/me", auth_1.requireAuth, async (req, res) => {
    try {
        // Look up the user by the ID extracted from the JWT token
        const result = await db_1.default.query(
        // Select all profile fields except the password hash
        "SELECT id, name, email, role, region, created_at FROM users WHERE id = $1", 
        // req.user is set by the requireAuth middleware
        [req.user?.userId]);
        // If no user was found (e.g. the account was deleted after the token was issued)
        if (result.rows.length === 0) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        // Return the user's profile data
        res.json({ user: result.rows[0] });
    }
    catch (err) {
        console.error("Me error:", err);
        res.status(500).json({ error: "Server error" });
    }
});
// Export the router so it can be mounted in src/index.ts
exports.default = router;
