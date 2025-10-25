// Utils/requestContext.js
import { createNamespace } from "cls-hooked";
import { v4 as uuidv4 } from "uuid";

const session = createNamespace("request");

export const requestContextHook = async (request, reply) => {
  return new Promise((resolve) => {
    session.run(() => {
      try {
        const requestId = uuidv4();
        session.set("requestId", requestId);
        request.requestId = requestId; // Attach to request for controllers
        request.log.debug(`[requestContext] Assigned requestId: ${requestId}`); // Use Fastify's request logger
        resolve();
      } catch (error) {
        request.log.error(`[requestContext] Failed to assign requestId: ${error.message}`);
        resolve(); // Continue request processing even if UUID fails
      }
    });
  });
};

export const getRequestId = () => {
  const requestId = session.get("requestId");
  return requestId || "unknown"; // Fallback if CLS context is lost
};