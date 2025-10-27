// Middleware/errorHandler.js
import { z } from "zod";
import { logger } from "../Utils/logger.js";
import { getRequestId } from "../Utils/requestContext.js";

// ----------------- Zod Error Handler -----------------
const handleZodError = (reply, error) => {
  const errorsMap = new Map();

  error.issues.forEach((err) => {
    const field = err.path.join(".");
    if (!errorsMap.has(field)) {
      errorsMap.set(field, {
        message: err.message,
        path: err.path,
      });
    }
  });

  const errors = Array.from(errorsMap.values());

  return reply.code(400).send({
    status: "fail",
    message: "Validation Error",
    errors,
  });
};

// ----------------- Global Error Handler -----------------
const errorHandler = async (error, request, reply) => {
  const requestId = getRequestId(request.requestId); // Pass request.requestId if set by requestContextMiddleware
  logger.error(`❌ Path: ${request.url} | Error: ${error.message}`, {
    error,
    requestId,
    stack: error.stack,
  });

  if (error instanceof SyntaxError && "body" in error) {
    return reply.code(400).send({
      status: "error",
      message:
        "Invalid JSON payload received. Please check your request body format.",
    });
  }

  if (error instanceof z.ZodError) {
    return handleZodError(reply, error);
  }

  return reply.code(500).send({
    status: "error",
    requestId,
    message:
      process.env.NODE_ENV === "development"
        ? error.message || "Internal Server Error"
        : "Internal Server Error",
  });
};

// ----------------- 404 Handler -----------------
const notFoundHandler = async (request, reply) => {
  logger.warn(`404 Not Found - Path: ${request.url}`);

  return reply.code(404).send({
    status: "error",
    message: "Route not found",
    errors: [],
  });
};

export { errorHandler, notFoundHandler };