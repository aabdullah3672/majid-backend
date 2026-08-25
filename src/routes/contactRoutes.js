import { Router } from "express";
import { query } from "../config/db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { cleanString, requireFields, validateEmail } from "../utils/validation.js";
import { created } from "../utils/response.js";

export const contactRoutes = Router();

contactRoutes.post("/", asyncHandler(async (req, res) => {
  requireFields(req.body, ["name", "email", "message"]);
  validateEmail(req.body.email);

  const result = await query(
    "INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)",
    [cleanString(req.body.name), cleanString(req.body.email).toLowerCase(), cleanString(req.body.message)]
  );

  return created(res, {
    contact: {
      id: result.insertId,
      name: cleanString(req.body.name),
      email: cleanString(req.body.email).toLowerCase()
    }
  }, "Message received. We'll get back to you soon.");
}));
