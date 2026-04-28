// Import Router and types from Express for defining route handlers
import { Router, Response } from "express";

// Import the database connection pool to run SQL queries
import pool from "../db";

// Import the auth middleware functions for protecting routes
import { requireAuth, requireRole } from "../middleware/auth";

// Import the AuthRequest type that extends Express Request with the user property
import type { AuthRequest } from "../types";

// Create a new Express Router instance for incident-related routes
const router = Router();

// ── GET /incidents ──────────────────────────────────────────────────────────
// Returns a filtered, paginated list of incidents from the database
// This is a public endpoint — no authentication required to view incidents
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

    // Add a type filter if the caller provided one (e.g. "flood")
    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      values.push(type);
    }

    // Add a status filter if provided (e.g. "new", "dispatched", "resolved")
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    // Add a Kasoa town filter — uses ILIKE for case-insensitive partial matching
    if (region) {
      conditions.push(`region ILIKE $${paramIndex++}`);
      values.push(`%${region}%`);
    }

    // Add a severity filter if provided (e.g. "critical")
    if (severity) {
      conditions.push(`severity = $${paramIndex++}`);
      values.push(severity);
    }

    // Join all conditions with AND to form the full WHERE clause
    // If no filters were provided, the WHERE clause is omitted entirely
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Execute the main query joining incidents with the users table to get reporter names
    const result = await pool.query(
      `SELECT
         i.*,
         -- Join to get the name of the citizen who reported this incident
         u.name AS reporter_name
       FROM incidents i
       LEFT JOIN users u ON i.reported_by = u.id
       ${where}
       -- Most recent incidents first
       ORDER BY i.created_at DESC
       -- Apply pagination with limit and offset
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      // Pass all values including the limit and offset at the end
      [...values, parseInt(limit as string), parseInt(offset as string)]
    );

    // Run a separate count query to get the total number of matching records for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM incidents ${where}`,
      // Reuse the same filter values (without limit and offset)
      values
    );

    // Respond with the incidents array and pagination metadata
    res.json({
      // The list of incident records
      incidents: result.rows,
      // Total count of matching incidents (used by the frontend to calculate page numbers)
      total: parseInt(countResult.rows[0].count),
      // Echo back the limit that was used
      limit: parseInt(limit as string),
      // Echo back the offset that was used
      offset: parseInt(offset as string),
    });
  } catch (err) {
    console.error("Get incidents error:", err);
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

// ── GET /incidents/:id ──────────────────────────────────────────────────────
// Returns a single incident by its UUID including its response log history
router.get("/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Query the incident record joined with the reporter's name
    const result = await pool.query(
      `SELECT i.*, u.name AS reporter_name
       FROM incidents i
       LEFT JOIN users u ON i.reported_by = u.id
       WHERE i.id = $1`,
      // Use the ID from the URL parameter
      [req.params.id]
    );

    // If no incident was found with this ID, return 404
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }

    // Also fetch the full response log for this incident ordered by time
    const logs = await pool.query(
      `SELECT rl.*, u.name AS responder_name
       FROM response_logs rl
       -- Join to get the name of who performed each logged action
       JOIN users u ON rl.responder_id = u.id
       WHERE rl.incident_id = $1
       ORDER BY rl.created_at ASC`,
      [req.params.id]
    );

    // Return both the incident and its audit trail
    res.json({
      incident: result.rows[0],
      logs: logs.rows,
    });
  } catch (err) {
    console.error("Get incident error:", err);
    res.status(500).json({ error: "Failed to fetch incident" });
  }
});

// ── POST /incidents ─────────────────────────────────────────────────────────
// Creates a new incident report in the database
// Requires the user to be authenticated (any role can submit a report)
router.post("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  // Destructure all incident fields from the request body
  const {
    type,           // Category of the emergency
    description,    // What is happening at the scene
    location_text,  // Street address or landmark in Kasoa
    latitude,       // GPS latitude — optional
    longitude,      // GPS longitude — optional
    region,         // Which Kasoa community town
    severity = "low",      // Default to low until admin reviews
    media_urls = [],       // Default to empty array if no media was uploaded
  } = req.body;

  // Validate that all required fields are present
  if (!type || !description || !location_text || !region) {
    res.status(400).json({
      error: "type, description, location_text and region are required",
    });
    return;
  }

  // Validate that the type is one of the three allowed values
  const validTypes = ["flood", "fire", "accident"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: "type must be flood, fire or accident" });
    return;
  }

  try {
    // Insert the new incident into the database
    const result = await pool.query(
      `INSERT INTO incidents
         (type, description, location_text, latitude, longitude, region, severity, reported_by, media_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       -- Return the full created record
       RETURNING *`,
      [
        // Incident category
        type,
        // Free-text description
        description,
        // Address or landmark
        location_text,
        // GPS coordinates — null if not provided
        latitude || null,
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

    // Respond with 201 Created and the full incident record
    res.status(201).json({
      message: "Incident reported successfully to the Kasoa Command Center",
      incident: result.rows[0],
    });
  } catch (err) {
    console.error("Create incident error:", err);
    res.status(500).json({ error: "Failed to create incident" });
  }
});

// ── PATCH /incidents/:id ────────────────────────────────────────────────────
// Updates the status, severity, or assigned agency of an incident
// Only admin and responder roles are allowed to modify incidents
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
    const validStatuses = ["new", "dispatched", "resolved"];
    // Define valid values for the severity field
    const validSeverities = ["low", "moderate", "critical"];

    // Reject the request if an invalid status was provided
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    // Reject the request if an invalid severity was provided
    if (severity && !validSeverities.includes(severity)) {
      res.status(400).json({ error: "Invalid severity" });
      return;
    }

    try {
      // Check the incident exists before trying to update it
      const exists = await pool.query(
        "SELECT id FROM incidents WHERE id = $1",
        [req.params.id]
      );

      // Return 404 if the incident does not exist
      if (exists.rows.length === 0) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      // Dynamically build the SET clause from the provided fields
      const fields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      // Add status to the update if it was provided
      if (status) { fields.push(`status = $${paramIndex++}`); values.push(status); }
      // Add severity to the update if it was provided
      if (severity) { fields.push(`severity = $${paramIndex++}`); values.push(severity); }
      // Add assigned_agency to the update if it was provided (can be set to null to unassign)
      if (assigned_agency !== undefined) { fields.push(`assigned_agency = $${paramIndex++}`); values.push(assigned_agency); }

      // Reject the request if no fields were provided to update
      if (fields.length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }

      // Add the incident ID as the final parameter for the WHERE clause
      values.push(req.params.id);

      // Execute the UPDATE query and return the updated record
      const result = await pool.query(
        `UPDATE incidents SET ${fields.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      // Log this action in the response_logs table for audit purposes
      if (req.user?.userId) {
        // Build a human-readable description of what was changed
        const action = status
          ? `Status changed to ${status}`
          : `Updated: ${fields.map((f) => f.split(" =")[0]).join(", ")}`;

        // Insert the log entry
        await pool.query(
          `INSERT INTO response_logs (incident_id, responder_id, action)
           VALUES ($1, $2, $3)`,
          [req.params.id, req.user.userId, action]
        );
      }

      // Return the updated incident record
      res.json({
        message: "Incident updated successfully",
        incident: result.rows[0],
      });
    } catch (err) {
      console.error("Update incident error:", err);
      res.status(500).json({ error: "Failed to update incident" });
    }
  }
);

// ── PATCH /incidents/:id/dispatch ───────────────────────────────────────────
// Assigns a Kasoa emergency agency to the incident and sets status to dispatched
// This is a shortcut endpoint specifically for the dispatch action — admin only
router.patch(
  "/:id/dispatch",
  requireAuth,
  // Only admins can dispatch incidents
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    // The agency name must be provided in the request body
    const { assigned_agency } = req.body;

    // Validate the required field
    if (!assigned_agency) {
      res.status(400).json({ error: "assigned_agency is required" });
      return;
    }

    try {
      // Update the incident: set status to dispatched and record the assigned agency
      const result = await pool.query(
        `UPDATE incidents
         SET status = 'dispatched', assigned_agency = $1
         WHERE id = $2
         RETURNING *`,
        [assigned_agency, req.params.id]
      );

      // Return 404 if the incident was not found
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      // Log the dispatch action for the audit trail
      if (req.user?.userId) {
        await pool.query(
          `INSERT INTO response_logs (incident_id, responder_id, action)
           VALUES ($1, $2, $3)`,
          [
            req.params.id,
            req.user.userId,
            // Record which agency was dispatched in the log
            `Dispatched to ${assigned_agency}`,
          ]
        );
      }

      // Return the updated incident
      res.json({
        message: `Incident dispatched to ${assigned_agency}`,
        incident: result.rows[0],
      });
    } catch (err) {
      console.error("Dispatch error:", err);
      res.status(500).json({ error: "Failed to dispatch incident" });
    }
  }
);

// ── DELETE /incidents/:id ───────────────────────────────────────────────────
// Permanently deletes an incident record — admin only
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // Delete the incident and return its ID to confirm deletion
      const result = await pool.query(
        "DELETE FROM incidents WHERE id = $1 RETURNING id",
        [req.params.id]
      );

      // Return 404 if the incident was not found
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Incident not found" });
        return;
      }

      // Confirm successful deletion
      res.json({ message: "Incident deleted successfully" });
    } catch (err) {
      console.error("Delete incident error:", err);
      res.status(500).json({ error: "Failed to delete incident" });
    }
  }
);

// Export the router so it can be mounted at /incidents in src/index.ts
export default router;
