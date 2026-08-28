export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    data: null,
    errors: null
  });
};

export const errorHandler = (error, req, res, next) => {
  const status = error.status || 500;
  const payload = {
    success: false,
    message: status === 500 ? "Something went wrong." : error.message,
    data: null,
    errors: error.details || null
  };

  if (status === 500) {
    // Always log full error to server logs (visible in Render dashboard)
    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, error.message, error.stack);
    // Include error hint in response for debugging (remove in true production)
    payload.debug = error.message;
  }

  if (status === 500 && req.app.get("env") !== "production") {
    payload.stack = error.stack;
  }

  res.status(status).json(payload);
};
