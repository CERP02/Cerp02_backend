// Import Router and types from Express for defining route handlers
import { Router, Response } from "express";

// Import the database connection pool
import pool from "../db";

// Import auth middleware to protect admin-only routes
import { requireAuth, requireRole } from "../middleware/auth";

// Import the AuthRequest type that includes the decoded JWT user
import type { AuthRequest } from "../types";

// Create a new Express Router for community notification routes
const router = Router();

// ── GET /alerts ─────────────────────────────────────────────────────────────
// Returns a paginated list of community notifications from the database
// Public endpoint — any user can view recent community notifications
router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  // Destructure optional filter and pagination parameters from the query string
  const { region, limit = "20", offset = "0" } = req.query;

  try {
    // Build the WHERE clause dynamically based on whether a town filter was provided
    const conditions: string[] = [];
    // Values array for parameterized queries
    const values: unknown[] = [];
    // Parameter index counter
    let paramIndex = 1;

    // If a specific Kasoa town was requested, filter to that town plus community-wide notifications
    if (region && region !== "All Kasoa Towns") {
      // Show notifications targeting this specific town OR notifications targeting all towns
      conditions.push(`(target_region = $${paramIndex++} OR target_region = 'All Kasoa Towns')`);
      // Push the town name as the parameter value
      values.push(region);
    }

    // Build the complete WHERE clause or leave it blank if no filter was provided
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Query the notifications joined with the users table to get the admin's name
    const result = await pool.query(
      `SELECT a.*, u.name AS issuer_name
       FROM alerts a
       -- Join to get the full name of the admin who sent this notification
       JOIN users u ON a.issued_by = u.id
       ${where}
       -- Most recent notifications first
       ORDER BY a.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      // Pass filter values plus pagination parameters
      [...values, parseInt(limit as string), parseInt(offset as string)]
    );

    // Return the list of community notifications
    res.json({ alerts: result.rows });
  } catch (err) {
    // Log the error for debugging
    console.error("Get notifications error:", err);
    // Return a 500 error
    res.status(500).json({ error: "Failed to fetch community notifications" });
  }
});

// ── GET /alerts/:id ──────────────────────────────────────────────────────────
// Returns a single community notification by its UUID
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Query the notification by ID joined with the issuing admin's name
    const result = await pool.query(
      `SELECT a.*, u.name AS issuer_name
       FROM alerts a
       JOIN users u ON a.issued_by = u.id
       WHERE a.id = $1`,
      // Use the ID from the URL parameter
      [req.params.id]
    );

    // Return 404 if no notification was found with this ID
    if (result.rows.length === 0) {
      // Respond with not found error
      res.status(404).json({ error: "Notification not found" });
      // Stop execution
      return;
    }

    // Return the notification record
    res.json({ alert: result.rows[0] });
  } catch (err) {
    // Log the error for debugging
    console.error("Get notification error:", err);
    // Return a 500 error
    res.status(500).json({ error: "Failed to fetch notification" });
  }
});

// ── POST /alerts ─────────────────────────────────────────────────────────────
// Broadcasts a new community notification to Kasoa residents — admin only
router.post(
  "/",
  // Verify the user is authenticated
  requireAuth,
  // Verify the user has admin role — only admins can broadcast notifications
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    // Destructure the notification fields from the request body
    const {
      title,                              // Short notification title
      message,                            // Full notification message body
      target_region = "All Kasoa Towns",  // Default to broadcasting to all Kasoa towns
      radius_km,                          // Optional geo-fence radius
      channels = ["web"],                 // Default to web-only if no channels specified
    } = req.body;

    // Validate that the required fields are present
    if (!title || !message) {
      // Return 400 if title or message is missing
      res.status(400).json({ error: "title and message are required" });
      // Stop execution
      return;
    }

    // Define the valid delivery channel values
    const validChannels = ["sms", "push", "web"];

    // Check that all provided channels are valid
    const invalidChannels = (channels as string[]).filter(
      // Filter out any channel not in the valid list
      (c) => !validChannels.includes(c)
    );

    // Reject the request if any invalid channel was provided
    if (invalidChannels.length > 0) {
      // Return 400 listing the invalid channels
      res.status(400).json({
        error: `Invalid channels: ${invalidChannels.join(", ")}. Must be sms, push or web`,
      });
      // Stop execution
      return;
    }

    try {
      // Insert the new notification into the database
      const result = await pool.query(
        `INSERT INTO alerts (title, message, target_region, radius_km, channels, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          // Notification title
          title,
          // Full message body
          message,
          // Target Kasoa town or "All Kasoa Towns"
          target_region,
          // Geo-fence radius — null if not specified
          radius_km || null,
          // Array of delivery channels
          channels,
          // UUID of the admin issuing this notification — from the JWT payload
          req.user?.userId,
        ]
      );

      // Respond with 201 Created and the new notification record
      res.status(201).json({
        // Success message
        message: "Community notification broadcast successfully",
        // The notification record as stored in the database
        alert: result.rows[0],
      });
    } catch (err) {
      // Log the error for debugging
      console.error("Create notification error:", err);
      // Return a 500 error
      res.status(500).json({ error: "Failed to broadcast community notification" });
    }
  }
);

// ── DELETE /alerts/:id ───────────────────────────────────────────────────────
// Deletes a notification record from the database — admin only
router.delete(
  "/:id",
  // Verify authentication
  requireAuth,
  // Only admins can delete notifications
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Delete the notification and return its ID to confirm
      const result = await pool.query(
        // Delete and return the ID
        "DELETE FROM alerts WHERE id = $1 RETURNING id",
        // Use the ID from the URL parameter
        [req.params.id]
      );

      // Return 404 if the notification was not found
      if (result.rows.length === 0) {
        // Respond with not found error
        res.status(404).json({ error: "Notification not found" });
        // Stop execution
        return;
      }

      // Confirm successful deletion
      res.json({ message: "Notification deleted successfully" });
    } catch (err) {
      // Log the error for debugging
      console.error("Delete notification error:", err);
      // Return a 500 error
      res.status(500).json({ error: "Failed to delete notification" });
    }
  }
);

// Export the router so it can be mounted at /alerts in src/index.ts
export default router;
