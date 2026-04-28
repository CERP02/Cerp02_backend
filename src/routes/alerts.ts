// Import Router and types from Express for defining route handlers
import { Router, Response } from "express";

// Import the database connection pool
import pool from "../db";

// Import auth middleware to protect admin-only routes
import { requireAuth, requireRole } from "../middleware/auth";

// Import the AuthRequest type that includes the decoded JWT user
import type { AuthRequest } from "../types";

// Create a new Express Router for alert-related routes
const router = Router();

// ── GET /alerts ─────────────────────────────────────────────────────────────
// Returns a paginated list of broadcast alerts from the database
// Public endpoint — any user can view recent community alerts
router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  // Destructure optional filter and pagination parameters from the query string
  const { region, limit = "20", offset = "0" } = req.query;

  try {
    // Build the WHERE clause dynamically based on whether a town filter was provided
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // If a specific Kasoa town was requested, filter to that town plus community-wide alerts
    if (region && region !== "All Kasoa Towns") {
      // Show alerts targeting this specific town OR alerts targeting all towns
      conditions.push(`(target_region = $${paramIndex++} OR target_region = 'All Kasoa Towns')`);
      values.push(region);
    }

    // Build the complete WHERE clause or leave it blank if no filter was provided
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Query the alerts joined with the users table to get the admin's name
    const result = await pool.query(
      `SELECT a.*, u.name AS issuer_name
       FROM alerts a
       -- Join to get the full name of the admin who sent this alert
       JOIN users u ON a.issued_by = u.id
       ${where}
       -- Most recent alerts first
       ORDER BY a.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...values, parseInt(limit as string), parseInt(offset as string)]
    );

    // Return the list of alerts
    res.json({ alerts: result.rows });
  } catch (err) {
    console.error("Get alerts error:", err);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// ── GET /alerts/:id ──────────────────────────────────────────────────────────
// Returns a single alert by its UUID
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Query the alert by ID joined with the issuing admin's name
    const result = await pool.query(
      `SELECT a.*, u.name AS issuer_name
       FROM alerts a
       JOIN users u ON a.issued_by = u.id
       WHERE a.id = $1`,
      [req.params.id]
    );

    // Return 404 if no alert was found with this ID
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    // Return the alert record
    res.json({ alert: result.rows[0] });
  } catch (err) {
    console.error("Get alert error:", err);
    res.status(500).json({ error: "Failed to fetch alert" });
  }
});

// ── POST /alerts ─────────────────────────────────────────────────────────────
// Broadcasts a new emergency alert to the Kasoa community — admin only
router.post(
  "/",
  // Verify the user is authenticated
  requireAuth,
  // Verify the user has admin role — only admins can broadcast alerts
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    // Destructure the alert fields from the request body
    const {
      title,                              // Short notification title
      message,                            // Full alert message body
      target_region = "All Kasoa Towns",  // Default to broadcasting to all Kasoa towns
      radius_km,                          // Optional geo-fence radius
      channels = ["web"],                 // Default to web-only if no channels specified
    } = req.body;

    // Validate that the required fields are present
    if (!title || !message) {
      res.status(400).json({ error: "title and message are required" });
      return;
    }

    // Define the valid delivery channel values
    const validChannels = ["sms", "push", "web"];

    // Check that all provided channels are valid
    const invalidChannels = (channels as string[]).filter(
      (c) => !validChannels.includes(c)
    );

    // Reject the request if any invalid channel was provided
    if (invalidChannels.length > 0) {
      res.status(400).json({
        error: `Invalid channels: ${invalidChannels.join(", ")}. Must be sms, push or web`,
      });
      return;
    }

    try {
      // Insert the new alert into the database
      const result = await pool.query(
        `INSERT INTO alerts (title, message, target_region, radius_km, channels, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          // Alert title
          title,
          // Full message body
          message,
          // Target Kasoa town or "All Kasoa Towns"
          target_region,
          // Geo-fence radius — null if not specified
          radius_km || null,
          // Array of delivery channels
          channels,
          // UUID of the admin issuing this alert — from the JWT payload
          req.user?.userId,
        ]
      );

      // In production, trigger actual delivery here:
      // if (channels.includes("sms")) await sendSMS(message, target_region);
      // if (channels.includes("push")) await sendPushNotification(title, message);

      // Respond with 201 Created and the new alert record
      res.status(201).json({
        message: "Community alert broadcast successfully",
        alert: result.rows[0],
      });
    } catch (err) {
      console.error("Create alert error:", err);
      res.status(500).json({ error: "Failed to broadcast alert" });
    }
  }
);

// ── DELETE /alerts/:id ───────────────────────────────────────────────────────
// Deletes an alert record from the database — admin only
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Delete the alert and return its ID to confirm
      const result = await pool.query(
        "DELETE FROM alerts WHERE id = $1 RETURNING id",
        [req.params.id]
      );

      // Return 404 if the alert was not found
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Alert not found" });
        return;
      }

      // Confirm successful deletion
      res.json({ message: "Alert deleted successfully" });
    } catch (err) {
      console.error("Delete alert error:", err);
      res.status(500).json({ error: "Failed to delete alert" });
    }
  }
);

// Export the router so it can be mounted at /alerts in src/index.ts
export default router;
