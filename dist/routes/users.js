"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
/**
 * Users Router: Provides endpoints for Superadmin to manage platform users.
 */
const router = (0, express_1.Router)();
// Only Superadmins can access these routes
router.use(auth_1.requireAuth, (0, auth_1.requireRole)("superadmin"));
/**
 * GET /users: Fetch all users (admins, responders, citizens).
 */
router.get("/", async (req, res) => {
    try {
        const result = await db_1.default.query("SELECT id, name, email, role, region, created_at FROM users ORDER BY created_at DESC");
        res.json({ users: result.rows });
    }
    catch (err) {
        console.error("Fetch users error:", err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});
/**
 * PATCH /users/:id: Update a user's role or region.
 */
router.patch("/:id", async (req, res) => {
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
        await db_1.default.query("BEGIN");
        const result = await db_1.default.query(`UPDATE users 
       SET role = COALESCE($1, role), 
           region = COALESCE($2, region),
           status = COALESCE($3, status)
       WHERE id = $4
       RETURNING id, name, email, role, region, status`, [role, region, status, id]);
        if (result.rows.length === 0) {
            await db_1.default.query("ROLLBACK");
            return res.status(404).json({ error: "User not found" });
        }
        // Log the update action
        await db_1.default.query("INSERT INTO audit_logs (user_id, action, target_id, target_type) VALUES ($1, $2, $3, $4)", [req.user?.userId, `Updated user ${result.rows[0].email} (Role: ${role || 'unchanged'})`, id, 'user']);
        await db_1.default.query("COMMIT");
        res.json({ message: "User updated successfully", user: result.rows[0] });
    }
    catch (err) {
        await db_1.default.query("ROLLBACK");
        console.error("Update user error:", err);
        res.status(500).json({ error: "Failed to update user" });
    }
});
/**
 * DELETE /users/:id: Remove a user from the platform.
 */
router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // Prevent superadmins from deleting themselves
        if (id === req.user?.userId) {
            return res.status(400).json({ error: "You cannot delete your own account" });
        }
        await db_1.default.query("BEGIN");
        const userResult = await db_1.default.query("SELECT email FROM users WHERE id = $1", [id]);
        if (userResult.rows.length === 0) {
            await db_1.default.query("ROLLBACK");
            return res.status(404).json({ error: "User not found" });
        }
        await db_1.default.query("DELETE FROM users WHERE id = $1", [id]);
        // Log the deletion
        await db_1.default.query("INSERT INTO audit_logs (user_id, action, target_id, target_type) VALUES ($1, $2, $3, $4)", [req.user?.userId, `Deleted user ${userResult.rows[0].email}`, id, 'user']);
        await db_1.default.query("COMMIT");
        res.json({ message: "User deleted successfully" });
    }
    catch (err) {
        await db_1.default.query("ROLLBACK");
        console.error("Delete user error:", err);
        res.status(500).json({ error: "Failed to delete user" });
    }
});
exports.default = router;
