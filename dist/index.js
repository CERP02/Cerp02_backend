"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Import dotenv to load environment variables from the .env file
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables from the .env file into process.env
dotenv_1.default.config();
// Import the Express framework for building the HTTP server
const express_1 = __importDefault(require("express"));
// Import the cors middleware to allow the Next.js frontend to call this API
const cors_1 = __importDefault(require("cors"));
// Import the auth route handlers (register, login, me)
const auth_1 = __importDefault(require("./routes/auth"));
// Import the community issue route handlers (CRUD + agency assignment)
const incidents_1 = __importDefault(require("./routes/incidents"));
// Import the notification route handlers (create, list, delete)
const alerts_1 = __importDefault(require("./routes/alerts"));
// Import the new superadmin and settings route modules
const superadmin_1 = __importDefault(require("./routes/superadmin"));
const settings_1 = __importDefault(require("./routes/settings"));
// Import the user management route handlers (superadmin only)
const users_1 = __importDefault(require("./routes/users"));
// Create the Express application instance
const app = (0, express_1.default)();
// Read the port from the environment variable, defaulting to 4000 if not set
const PORT = process.env.PORT || 4000;
// ── Middleware ───────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});
// Configure CORS to allow requests from the Next.js frontend origin
app.use((0, cors_1.default)({
    // Allow requests from the frontend URL defined in .env (e.g. http://localhost:3000)
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    // Allow cookies and Authorization headers to be sent cross-origin
    credentials: true,
}));
// Parse incoming JSON request bodies and make them available as req.body
// The 10mb limit allows citizens to submit base64-encoded media previews
app.use(express_1.default.json({ limit: "10mb" }));
// Parse URL-encoded form bodies (for compatibility with HTML forms)
app.use(express_1.default.urlencoded({ extended: true }));
// ── Routes ───────────────────────────────────────────────────────────────────
// Mount the auth routes at /auth
// Handles: POST /auth/register, POST /auth/login, GET /auth/me
app.use("/auth", auth_1.default);
// Mount the superadmin management routes
app.use("/superadmin", superadmin_1.default);
// Mount the platform settings routes
app.use("/settings", settings_1.default);
// Mount the community issue routes at /incidents
// Handles: GET /incidents, GET /incidents/:id, POST /incidents,
//          PATCH /incidents/:id, PATCH /incidents/:id/dispatch, DELETE /incidents/:id
app.use("/incidents", incidents_1.default);
// Mount the notification routes at /alerts
// Handles: GET /alerts, GET /alerts/:id, POST /alerts, DELETE /alerts/:id
app.use("/alerts", alerts_1.default);
// Mount the user management routes at /users
// Handles: GET /users, PATCH /users/:id, DELETE /users/:id
app.use("/users", users_1.default);
// ── Health Check ─────────────────────────────────────────────────────────────
// Simple health check endpoint used to verify the server is running
// Visit http://localhost:4000/health to confirm the API is up
app.get("/health", (_req, res) => {
    // Return a JSON object with the server status and current timestamp
    res.json({
        // Indicate the server is running normally
        status: "ok",
        // Identify this service as the Community Issue Reporting Platform API
        service: "CERP API — Kasoa Community Issue Reporting Platform",
        // Include the current server time for debugging
        timestamp: new Date().toISOString(),
    });
});
// ── 404 Handler ──────────────────────────────────────────────────────────────
// Catch-all handler for any route that was not matched above
app.use((_req, res) => {
    // Return a 404 JSON error instead of the default Express HTML page
    res.status(404).json({ error: "Route not found" });
});
// ── Global Error Handler ─────────────────────────────────────────────────────
// Express calls this handler whenever next(err) is called or an error is thrown
app.use((err, _req, res, _next) => {
    // Return a generic 500 error — never expose internal error details to the client
    res.status(500).json({ error: "Internal server error" });
});
// ── Start Server ─────────────────────────────────────────────────────────────
// Start listening on the configured port
app.listen(PORT, () => {
    // Log the server URL to the terminal so the developer knows it is running
    console.log(`🚀 CERP API running on http://localhost:${PORT}`);
    // Log the health check URL for quick verification
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
});
// Export the app for testing purposes
exports.default = app;
