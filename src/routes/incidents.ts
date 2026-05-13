// Import Router and Response from Express
import { Router, Response } from "express";

// Import the notification utilities for alerting admins and agencies
import { notifyAdminOfNewIssue, notifyAgencyOfAssignment } from "../utils/notifications";

// Import the database connection pool to run SQL queries
import pool from "../db";

// Import the auth middleware functions for protecting routes
import { requireAuth, requireRole } from "../middleware/auth";

// Import the AuthRequest type that extends Express Request with the user property
import type { AuthRequest } from "../types";

// Create a new Express Router instance for community issue routes
const router = Router();

// ── GET /incidents ──────────────────────────────────────────────────────────
// Returns a filtered, paginated list of community issues from the database
// This is a public endpoint — no authentication required to view issues
router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  // Destructure optional filter and pagination parameters from the query string
  const { type, status, region, severity, limit = "50", offset = "0" } = req.query;

  try {
    // Build the WHERE clause dynamically based on which filters were provided
    const conditions: string[] = [];
    // Values array used with parameterized queries to prevent SQL injection
    const values: unknown[] = [];
    // Tracks the current parameter index for the $N placeholders
    let paramIndex = 1;

    // Add a type filter if the caller provided one (e.g. "burst_water_pipe")
    if (type) {
      // Push the condition string with the next parameter placeholder
      conditions.push(`i.type = $${paramIndex++}`);
      // Push the actual value to be substituted safely
      values.push(type);
    }

    // Add a status filter if provided (e.g. "new", "assigned", "in_progress", "resolved")
    if (status) {
      // Push the status condition with the next parameter placeholder
      conditions.push(`i.status = $${paramIndex++}`);
      // Push the status value
      values.push(status);
    }

    // Add a Kasoa town filter — uses ILIKE for case-insensitive partial matching
    if (region) {
      // Push the region condition using ILIKE for flexible matching
      conditions.push(`i.region ILIKE $${paramIndex++}`);
      // Wrap the value with % wildcards for partial matching
      values.push(`%${region}%`);
    }

    // Add a severity filter if provided (e.g. "critical")
    if (severity) {
      // Push the severity condition with the next parameter placeholder
      conditions.push(`i.severity = $${paramIndex++}`);
      // Push the severity value
      values.push(severity);
    }

    // Join all conditions with AND to form the full WHERE clause
    // If no filters were provided, the WHERE clause is omitted entirely
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `SELECT
         i.*,
         -- Join to get the name of the citizen who reported this issue
         u.name AS reporter_name
       FROM incidents i
       LEFT JOIN users u ON i.reported_by = u.id
       ${where}
       -- Most recent issues first
       ORDER BY i.created_at DESC
       -- Apply pagination with limit and offset
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    
    const queryValues = [...values, parseInt(limit as string) || 50, parseInt(offset as string) || 0];

    // Execute the main query joining incidents with the users table to get reporter names
    const result = await pool.query(sql, queryValues);

    // Run a separate count query to get the total number of matching records for pagination
    const countResult = await pool.query(
      // Count all rows matching the same filters (without limit/offset)
      `SELECT COUNT(*) FROM incidents i ${where}`,
      // Reuse the same filter values (without limit and offset)
      values
    );

    // Respond with the issues array and pagination metadata
    res.json({
      // The list of community issue records
      incidents: result.rows,
      // Total count of matching issues (used by the frontend to calculate page numbers)
      total: parseInt(countResult.rows[0].count),
      // Echo back the limit that was used
      limit: parseInt(limit as string),
      // Echo back the offset that was used
      offset: parseInt(offset as string),
    });
  } catch (err) {
    // Log the error for server-side debugging
    console.error("Get issues error:", err);
    // Return a 500 error to the client
    res.status(500).json({ error: "Failed to fetch community issues" });
  }
});

// ── GET /incidents/:id ──────────────────────────────────────────────────────
// Returns a single community issue by its UUID including its response log history
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Query the issue record joined with the reporter's name
    const result = await pool.query(
      `SELECT i.*, u.name AS reporter_name
       FROM incidents i
       LEFT JOIN users u ON i.reported_by = u.id
       WHERE i.id = $1`,
      // Use the ID from the URL parameter
      [req.params.id]
    );

    // If no issue was found with this ID, return 404
    if (result.rows.length === 0) {
      // Respond with a not found error
      res.status(404).json({ error: "Community issue not found" });
      // Stop execution
      return;
    }

    // Also fetch the full response log for this issue ordered by time
    const logs = await pool.query(
      `SELECT rl.*, u.name AS responder_name
       FROM response_logs rl
       -- Join to get the name of who performed each logged action
       JOIN users u ON rl.responder_id = u.id
       WHERE rl.incident_id = $1
       ORDER BY rl.created_at ASC`,
      // Filter logs by the issue ID from the URL parameter
      [req.params.id]
    );

    // Return both the issue and its audit trail
    res.json({
      // The community issue record
      incident: result.rows[0],
      // The list of actions taken on this issue
      logs: logs.rows,
    });
  } catch (err) {
    // Log the error for debugging
    console.error("Get issue error:", err);
    // Return a 500 error
    res.status(500).json({ error: "Failed to fetch community issue" });
  }
});

// ── POST /incidents ─────────────────────────────────────────────────────────
// Creates a new community issue report in the database
// Requires the user to be authenticated (any role can submit a report)
router.post("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  // Destructure all issue fields from the request body
  const {
    type,           // Category of the community issue
    description,    // What the citizen observed
    location_text,  // Street address or landmark in Kasoa
    latitude,       // GPS latitude — optional
    longitude,      // GPS longitude — optional
    region,         // Which Kasoa community town
    severity = "low",      // Default to low until admin reviews
    media_urls = [],       // Default to empty array if no media was uploaded
  } = req.body;

  // Validate that all required fields are present
  if (!type || !description || !location_text || !region) {
    // Return 400 Bad Request listing the required fields
    res.status(400).json({
      // Tell the caller which fields they need to provide
      error: "type, description, location_text and region are required",
    });
    // Stop execution
    return;
  }

  // Define the list of valid community issue types matching the database CHECK constraint
  const validTypes = [
    "traffic_congestion",   // Traffic jams needing police direction
    "burst_water_pipe",     // Water pipe leaks needing GWCL
    "electrical_fault",     // Power issues needing ECG
    "weak_bridge",          // Compromised bridges needing GHA
    "pothole_bad_road",     // Road surface damage needing repair
    "illegal_dumping",      // Waste disposal needing Zoomlion
    "streetlight_outage",   // Broken street lights needing ECG
    "open_manhole",         // Uncovered manholes needing HSD
    "noise_complaint",      // Noise issues needing police
    "other",                // General issues for Municipal Assembly
  ];

  // Reject the request if the type is not in the valid list
  if (!validTypes.includes(type)) {
    // Return 400 with the list of valid types
    res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    // Stop execution
    return;
  }

  try {
    // Insert the new community issue into the database
    const result = await pool.query(
      `INSERT INTO incidents
         (type, description, location_text, latitude, longitude, region, severity, reported_by, media_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       -- Return the full created record
       RETURNING *`,
      [
        // Community issue category
        type,
        // Free-text description
        description,
        // Address or landmark
        location_text,
        // GPS coordinates — null if not provided
        latitude || null,
        // GPS longitude — null if not provided
        longitude || null,
        // Kasoa community town
        region,
        // Initial severity level
        severity,
        // UUID of the reporting user — attached by requireAuth middleware
        req.user?.userId || null,
        // Array of media file URLs
        media_urls,
      ]
    );

    // Send notification to admin about the new community issue
    notifyAdminOfNewIssue(result.rows[0]).catch((err) =>
      // Log the error but don't fail the request — notification is best-effort
      console.error("Failed to notify admin:", err)
    );

    // Respond with 201 Created and the full issue record
    res.status(201).json({
      // Success message for the caller
      message: "Community issue reported successfully to the Kasoa Command Center",
      // The full issue record as stored in the database
      incident: result.rows[0],
    });
  } catch (err) {
    // Log the error for debugging
    console.error("Create issue error:", err);
    // Return a 500 error
    res.status(500).json({ error: "Failed to create community issue report" });
  }
});

// ── PATCH /incidents/:id ────────────────────────────────────────────────────
// Updates the status, severity, or assigned agency of a community issue
// Only admin and responder roles are allowed to modify issues
router.patch(
  "/:id",
  // First verify the user is authenticated
  requireAuth,
  // Then verify the user has admin or responder role
  requireRole("admin", "responder"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    // Destructure the fields that can be updated
    const { status, severity, assigned_agency } = req.body;

    // Define valid values for the status field
    const validStatuses = ["new", "assigned", "in_progress", "resolved"];
    // Define valid values for the severity field
    const validSeverities = ["low", "moderate", "critical"];

    // Reject the request if an invalid status was provided
    if (status && !validStatuses.includes(status)) {
      // Return 400 with an error message
      res.status(400).json({ error: "Invalid status. Must be new, assigned, in_progress, or resolved" });
      // Stop execution
      return;
    }

    // Reject the request if an invalid severity was provided
    if (severity && !validSeverities.includes(severity)) {
      // Return 400 with an error message
      res.status(400).json({ error: "Invalid severity. Must be low, moderate, or critical" });
      // Stop execution
      return;
    }

    try {
      // Check the issue exists before trying to update it
      const exists = await pool.query(
        // Select only the ID to check existence efficiently
        "SELECT id FROM incidents WHERE id = $1",
        // Use the ID from the URL parameter
        [req.params.id]
      );

      // Return 404 if the issue does not exist
      if (exists.rows.length === 0) {
        // Respond with not found error
        res.status(404).json({ error: "Community issue not found" });
        // Stop execution
        return;
      }

      // Dynamically build the SET clause from the provided fields
      const fields: string[] = [];
      // Values array for parameterized query
      const values: unknown[] = [];
      // Parameter index counter
      let paramIndex = 1;

      // Add status to the update if it was provided
      if (status) { fields.push(`status = $${paramIndex++}`); values.push(status); }
      // Add severity to the update if it was provided
      if (severity) { fields.push(`severity = $${paramIndex++}`); values.push(severity); }
      // Add assigned_agency to the update if it was provided (can be set to null to unassign)
      if (assigned_agency !== undefined) { fields.push(`assigned_agency = $${paramIndex++}`); values.push(assigned_agency); }

      // Reject the request if no fields were provided to update
      if (fields.length === 0) {
        // Return 400 explaining that at least one field must be provided
        res.status(400).json({ error: "No fields to update" });
        // Stop execution
        return;
      }

      // Add the issue ID as the final parameter for the WHERE clause
      values.push(req.params.id);

      // Execute the UPDATE query and return the updated record
      const result = await pool.query(
        // Build the dynamic UPDATE statement with the collected fields
        `UPDATE incidents SET ${fields.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        // Pass all the values for the parameterized query
        values
      );

      // Log this action in the response_logs table for audit purposes
      if (req.user?.userId) {
        // Build a human-readable description of what was changed
        const action = status
          ? `Status changed to ${status}`
          : `Updated: ${fields.map((f) => f.split(" =")[0]).join(", ")}`;

        // Insert the log entry into the response_logs table
        await pool.query(
          `INSERT INTO response_logs (incident_id, responder_id, action)
           VALUES ($1, $2, $3)`,
          // Pass the issue ID, user ID, and action description
          [req.params.id, req.user.userId, action]
        );
      }

      // Return the updated issue record
      res.json({
        // Success message
        message: "Community issue updated successfully",
        // The updated record
        incident: result.rows[0],
      });
    } catch (err) {
      // Log the error for debugging
      console.error("Update issue error:", err);
      // Return a 500 error
      res.status(500).json({ error: "Failed to update community issue" });
    }
  }
);

// ── PATCH /incidents/:id/dispatch ───────────────────────────────────────────
// Assigns a Kasoa-area agency to the community issue and sets status to assigned
// This is a shortcut endpoint specifically for the assignment action — admin only
router.patch(
  "/:id/dispatch",
  // Verify the user is authenticated
  requireAuth,
  // Only admins can assign agencies to issues
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    // The agency name must be provided in the request body
    const { assigned_agency } = req.body;

    // Validate the required field
    if (!assigned_agency) {
      // Return 400 if no agency was specified
      res.status(400).json({ error: "assigned_agency is required" });
      // Stop execution
      return;
    }

    try {
      // Update the issue: set status to assigned and record the assigned agency
      const result = await pool.query(
        `UPDATE incidents
         SET status = 'assigned', assigned_agency = $1
         WHERE id = $2
         RETURNING *`,
        // Pass the agency name and issue ID
        [assigned_agency, req.params.id]
      );

      // Return 404 if the issue was not found
      if (result.rows.length === 0) {
        // Respond with not found error
        res.status(404).json({ error: "Community issue not found" });
        // Stop execution
        return;
      }

      // Log the assignment action for the audit trail
      if (req.user?.userId) {
        // Insert the log entry recording which agency was assigned
        await pool.query(
          `INSERT INTO response_logs (incident_id, responder_id, action)
           VALUES ($1, $2, $3)`,
          [
            // The issue that was assigned
            req.params.id,
            // The admin who performed the assignment
            req.user.userId,
            // Human-readable description of the action
            `Assigned to ${assigned_agency}`,
          ]
        );
      }

      // Send notification to the assigned agency
      notifyAgencyOfAssignment(result.rows[0], assigned_agency).catch((err) =>
        // Log the error but don't fail the request
        console.error("Failed to notify agency:", err)
      );

      // Return the updated issue
      res.json({
        // Success message including the agency name
        message: `Community issue assigned to ${assigned_agency}`,
        // The updated issue record
        incident: result.rows[0],
      });
    } catch (err) {
      // Log the error for debugging
      console.error("Assignment error:", err);
      // Return a 500 error
      res.status(500).json({ error: "Failed to assign community issue" });
    }
  }
);

// ── DELETE /incidents/:id ───────────────────────────────────────────────────
// Permanently deletes a community issue record — admin only
router.delete(
  "/:id",
  // Verify authentication
  requireAuth,
  // Only admins can delete issues
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Delete the issue and return its ID to confirm deletion
      const result = await pool.query(
        // Delete and return the ID for confirmation
        "DELETE FROM incidents WHERE id = $1 RETURNING id",
        // Use the ID from the URL parameter
        [req.params.id]
      );

      // Return 404 if the issue was not found
      if (result.rows.length === 0) {
        // Respond with not found error
        res.status(404).json({ error: "Community issue not found" });
        // Stop execution
        return;
      }

      // Confirm successful deletion
      res.json({ message: "Community issue deleted successfully" });
    } catch (err) {
      // Log the error for debugging
      console.error("Delete issue error:", err);
      // Return a 500 error
      res.status(500).json({ error: "Failed to delete community issue" });
    }
  }
);

// Export the router so it can be mounted at /incidents in src/index.ts
export default router;
