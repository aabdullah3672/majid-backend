import { badRequest } from "./httpError.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const requireFields = (body, fields) => {
  const errors = {};
  fields.forEach((field) => {
    const value = body?.[field];
    if (typeof value !== "string" || value.trim() === "") {
      errors[field] = "This field is required.";
    }
  });
  if (Object.keys(errors).length) {
    throw badRequest("Please complete the required fields.", errors);
  }
};

export const validateEmail = (email, field = "email") => {
  if (!emailPattern.test(String(email || "").trim())) {
    throw badRequest("Enter a valid email address.", { [field]: "Enter a valid email address." });
  }
};

export const validatePassword = (password) => {
  if (String(password || "").length < 6) {
    throw badRequest("Password must be at least 6 characters.", { password: "Use at least 6 characters." });
  }
};

export const cleanString = (value) => String(value || "").trim();
