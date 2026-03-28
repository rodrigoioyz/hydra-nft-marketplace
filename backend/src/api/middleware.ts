import { randomUUID } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";

// Attach a unique request ID and log each request with method, path, status, duration
export function requestLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const reqId = randomUUID().slice(0, 8);
    const start = Date.now();
    (req as Request & { reqId: string }).reqId = reqId;

    res.on("finish", () => {
      const ms = Date.now() - start;
      const level = res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO";
      console.log(`[API] [${level}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms) [${reqId}]`);
    });

    next();
  };
}

// Wraps async route handlers so Express catches thrown errors
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// Standard error shape
export function apiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  res.status(status).json({ error: code, message, ...(details ? { details } : {}) });
}

// Global error handler — mount last
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const reqId = (req as Request & { reqId?: string }).reqId ?? "?";
  console.error(`[API] [ERROR] Unhandled error [${reqId}]:`, err);
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: "internal_error", message });
}
