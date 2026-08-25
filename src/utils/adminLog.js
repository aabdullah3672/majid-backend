import { query } from "../config/db.js";

/**
 * Log admin activity for audit trail.
 */
export const logAdminAction = async (adminId, action, entityType = null, entityId = null, details = null) => {
  try {
    await query(
      "INSERT INTO admin_activity_log (admin_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
      [adminId, action, entityType, entityId, details ? JSON.stringify(details) : null]
    );
  } catch {
    // Non-critical — don't fail the request
  }
};
