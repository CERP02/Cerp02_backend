"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ── Dashboard Stats ─────────────────────────────────────────────────────────
// Returns aggregated metrics for the superadmin overview dashboard
router.get("/stats", auth_1.requireAuth, (0, auth_1.requireRole)("superadmin"), async (req, res) => {
    try {
        // 1. Incident Counts
        const incidentStats = await db_1.default.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as pending,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved
      FROM incidents
    `);
        // 2. User Counts
        const userStats = await db_1.default.query(`
      SELECT 
        role,
        COUNT(*) as count
      FROM users
      GROUP BY role
    `);
        // 3. Recent Activity (Latest 5 incidents)
        const recentActivity = await db_1.default.query(`
      SELECT 
        i.id,
        i.description,
        i.status,
        i.created_at,
        u.name as reporter_name
      FROM incidents i
      LEFT JOIN users u ON i.reported_by = u.id
      ORDER BY i.created_at DESC
      LIMIT 5
    `);
        res.json({
            incidents: incidentStats.rows[0],
            users: userStats.rows.reduce((acc, row) => {
                acc[row.role] = parseInt(row.count);
                return acc;
            }, {}),
            recentActivity: recentActivity.rows
        });
    }
    catch (err) {
        console.error("Superadmin stats error:", err);
        res.status(500).json({ error: "Failed to fetch dashboard statistics" });
    }
});
// ── Audit Logs ──────────────────────────────────────────────────────────────
// Returns the system audit trail for superadmin oversight
router.get("/audit", auth_1.requireAuth, (0, auth_1.requireRole)("superadmin"), async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;
    try {
        const logs = await db_1.default.query(`
      SELECT 
        l.*,
        u.name as admin_name,
        u.email as admin_email
      FROM audit_logs l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
        res.json({ logs: logs.rows });
    }
    catch (err) {
        console.error("Audit logs error:", err);
        res.status(500).json({ error: "Failed to fetch audit logs" });
    }
});
// ── User Management ──────────────────────────────────────────────────────────
// Update a user's role (Promote/Demote)
router.patch("/users/:id/role", auth_1.requireAuth, (0, auth_1.requireRole)("superadmin"), async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!['user', 'responder', 'admin', 'superadmin'].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
    }
    try {
        // Start transaction
        await db_1.default.query("BEGIN");
        const result = await db_1.default.query("UPDATE users SET role = $1 WHERE id = $2 RETURNING name, email", [role, id]);
        if (result.rowCount === 0) {
            await db_1.default.query("ROLLBACK");
            return res.status(404).json({ error: "User not found" });
        }
        // Log the action
        await db_1.default.query("INSERT INTO audit_logs (user_id, action, target_id, target_type) VALUES ($1, $2, $3, $4)", [req.user?.userId, `Changed role of ${result.rows[0].email} to ${role}`, id, 'user']);
        await db_1.default.query("COMMIT");
        res.json({ message: `User role updated to ${role}` });
    }
    catch (err) {
        await db_1.default.query("ROLLBACK");
        console.error("Role update error:", err);
        res.status(500).json({ error: "Failed to update user role" });
    }
});
exports.default = router;
