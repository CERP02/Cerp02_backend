// Import dotenv to load environment variables from the .env file
import dotenv from "dotenv";

// Load environment variables from the .env file into process.env
dotenv.config();

// Import the Express framework for building the HTTP server
import express from "express";

// Import the cors middleware to allow the Next.js frontend to call this API
import cors from "cors";

// Import the auth route handlers (register, login, me)
import authRoutes from "./routes/auth";

// Import the community issue route handlers (CRUD + agency assignment)
import incidentRoutes from "./routes/incidents";

// Import the notification route handlers (create, list, delete)
import alertRoutes from "./routes/alerts";
// Import the new superadmin and settings route modules
import superadminRoutes from "./routes/superadmin";
import settingsRoutes from "./routes/settings";

// Import the user management route handlers (superadmin only)
import userRoutes from "./routes/users";

// Create the Express application instance
const app = express();

// Read the port from the environment variable, defaulting to 4000 if not set
const PORT = process.env.PORT || 4000;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Configure CORS to allow requests from the Next.js frontend origin
app.use(cors({
  // Allow requests from the frontend URL defined in .env (e.g. http://localhost:3000)
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  // Allow cookies and Authorization headers to be sent cross-origin
  credentials: true,
}));

// Parse incoming JSON request bodies and make them available as req.body
// The 10mb limit allows citizens to submit base64-encoded media previews
app.use(express.json({ limit: "10mb" }));

// Parse URL-encoded form bodies (for compatibility with HTML forms)
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────────────────

// Mount the auth routes at /auth
// Handles: POST /auth/register, POST /auth/login, GET /auth/me
app.use("/auth", authRoutes);

// Mount the superadmin management routes
app.use("/superadmin", superadminRoutes);

// Mount the platform settings routes
app.use("/settings", settingsRoutes);

// Mount the community issue routes at /incidents
// Handles: GET /incidents, GET /incidents/:id, POST /incidents,
//          PATCH /incidents/:id, PATCH /incidents/:id/dispatch, DELETE /incidents/:id
app.use("/incidents", incidentRoutes);

// Mount the notification routes at /alerts
// Handles: GET /alerts, GET /alerts/:id, POST /alerts, DELETE /alerts/:id
app.use("/alerts", alertRoutes);

// Mount the user management routes at /users
// Handles: GET /users, PATCH /users/:id, DELETE /users/:id
app.use("/users", userRoutes);

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
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
export default app;
