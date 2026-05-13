import { Router, Response } from "express";
import pool from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AuthRequest } from "../types";

/**
 * Users Router: Provides endpoints for Superadmin to manage platform users.
 */
const router = Router();

// Only Superadmins can access these routes
router.use(requireAuth, requireRole("superadmin"));

/**
 * GET /users: Fetch all users (admins, responders, citizens).
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, region, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/**
 * PATCH /users/:id: Update a user's role or region.
 */
router.patch("/:id", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { role, region, status } = req.body;

  try {
    // Validate role if provided
    if (role && !["user", "responder", "admin", "superadmin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Validate status if provided
    if (status && !["active", "suspended"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Start transaction for audit logging
    await pool.query("BEGIN");

    const result = await pool.query(
      `UPDATE users 
       SET role = COALESCE($1, role), 
           region = COALESCE($2, region),
           status = COALESCE($3, status)
       WHERE id = $4
       RETURNING id, name, email, role, region, status`,
      [role, region, status, id]
    );

    if (result.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    // Log the update action
    await pool.query(
      "INSERT INTO audit_logs (user_id, action, target_id, target_type) VALUES ($1, $2, $3, $4)",
      [req.user?.userId, `Updated user ${result.rows[0].email} (Role: ${role || 'unchanged'})`, id, 'user']
    );

    await pool.query("COMMIT");
    res.json({ message: "User updated successfully", user: result.rows[0] });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Update user error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

/**
 * DELETE /users/:id: Remove a user from the platform.
 */
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  try {
    // Prevent superadmins from deleting themselves
    if (id === req.user?.userId) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    await pool.query("BEGIN");

    const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [id]);
    if (userResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    // Log the deletion
    await pool.query(
      "INSERT INTO audit_logs (user_id, action, target_id, target_type) VALUES ($1, $2, $3, $4)",
      [req.user?.userId, `Deleted user ${userResult.rows[0].email}`, id, 'user']
    );

    await pool.query("COMMIT");
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
