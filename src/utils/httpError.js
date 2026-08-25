export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = "Authentication required.") => new HttpError(401, message);
export const forbidden = (message = "You do not have permission to perform this action.") => new HttpError(403, message);
export const notFound = (message = "Resource not found.") => new HttpError(404, message);
