/**
 * Consistent JSON response wrapper.
 * Format: { success, message, data, errors }
 */
export const success = (res, data = null, message = "Success", status = 200) => {
  return res.status(status).json({
    success: true,
    message,
    data,
    errors: null
  });
};

export const created = (res, data = null, message = "Created successfully") => {
  return success(res, data, message, 201);
};

export const paginated = (res, data, meta, message = "Success") => {
  return res.status(200).json({
    success: true,
    message,
    data,
    meta,
    errors: null
  });
};
