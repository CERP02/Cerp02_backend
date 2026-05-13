"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ── Get All Settings ─────────────────────────────────────────────────────────
// Public settings (like app_name) could be exposed without auth, 
// but for now, we'll keep the management interface superadmin-only.
router.get("/", auth_1.requireAuth, (0, auth_1.requireRole)("superadmin"), async (req, res) => {
    try {
        const result = await db_1.default.query("SELECT * FROM settings ORDER BY key ASC");
        res.json({ settings: result.rows });
    }
    catch (err) {
        console.error("Fetch settings error:", err);
        res.status(500).json({ error: "Failed to fetch platform settings" });
    }
});
// ── Update Settings ──────────────────────────────────────────────────────────
// Updates specific settings keys and logs the change in the audit trail
router.patch("/", auth_1.requireAuth, (0, auth_1.requireRole)("superadmin"), async (req, res) => {
    const updates = req.body; // Expecting { key: value, ... }
    try {
        await db_1.default.query("BEGIN");
        for (const [key, value] of Object.entries(updates)) {
            const result = await db_1.default.query("UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING key", [value, key]);
            if (result.rowCount === 0) {
                throw new Error(`Setting ${key} not found`);
            }
            // Log to audit logs
            await db_1.default.query("INSERT INTO audit_logs (user_id, action, target_type) VALUES ($1, $2, $3)", [req.user?.userId, `Updated setting ${key} to ${value}`, 'settings']);
        }
        await db_1.default.query("COMMIT");
        res.json({ message: "Settings updated successfully" });
    }
    catch (err) {
        await db_1.default.query("ROLLBACK");
        console.error("Update settings error:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update settings" });
    }
});
exports.default = router;
