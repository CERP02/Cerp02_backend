import { Router, Response } from "express";
import pool from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AuthRequest } from "../types";

const router = Router();

// ── Get All Settings ─────────────────────────────────────────────────────────
// Public settings (like app_name) could be exposed without auth, 
// but for now, we'll keep the management interface superadmin-only.
router.get("/", requireAuth, requireRole("superadmin"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM settings ORDER BY key ASC");
    res.json({ settings: result.rows });
  } catch (err) {
    console.error("Fetch settings error:", err);
    res.status(500).json({ error: "Failed to fetch platform settings" });
  }
});

// ── Update Settings ──────────────────────────────────────────────────────────
// Updates specific settings keys and logs the change in the audit trail
router.patch("/", requireAuth, requireRole("superadmin"), async (req: AuthRequest, res: Response) => {
  const updates = req.body; // Expecting { key: value, ... }

  try {
    await pool.query("BEGIN");

    for (const [key, value] of Object.entries(updates)) {
      const result = await pool.query(
        "UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING key",
        [value, key]
      );

      if (result.rowCount === 0) {
        throw new Error(`Setting ${key} not found`);
      }

      // Log to audit logs
      await pool.query(
        "INSERT INTO audit_logs (user_id, action, target_type) VALUES ($1, $2, $3)",
        [req.user?.userId, `Updated setting ${key} to ${value}`, 'settings']
      );
    }

    await pool.query("COMMIT");
    res.json({ message: "Settings updated successfully" });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Update settings error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update settings" });
  }
});

export default router;
