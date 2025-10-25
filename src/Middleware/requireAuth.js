import jwt from "jsonwebtoken";
import { User } from "../Models/user.model.js";
import { logger } from "../Utils/logger.js";

export const requireAuth = async (request, reply) => {
  const token = request.cookies?.AccessToken || request.headers['authorization']?.replace(/^Bearer\s/i, '');

  logger.debug(`[requireAuth] Attempting to authenticate for path: ${request.url}`);
  logger.debug(`[requireAuth] AccessToken from cookies: ${request.cookies?.AccessToken ? 'present' : 'missing'}`);
  logger.debug(`[requireAuth] Authorization header: ${request.headers['authorization'] ? 'present' : 'missing'}`);

  if (!token) {
    logger.warn(`[requireAuth] Unauthorized: No token provided for path: ${request.url}`);
    return reply.code(401).send({ success: false, message: "Unauthorized - no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    logger.debug(`[requireAuth] Token decoded for userId: ${decoded.userId}`);

    request.userId = decoded.userId;
    request.sessionId = decoded.sessionId;

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      logger.warn(`[requireAuth] Unauthorized: User not found for userId: ${decoded.userId}`);
      return reply.code(401).send({ success: false, message: "Unauthorized - user not found" });
    }
    request.user = user;
    logger.debug(`[requireAuth] User ${user.userName} authenticated.`);

    if (request.session) {
      request.session.touch();
      logger.debug(`[requireAuth] Session ${request.session.id} touched.`);
    }

    // No need to call next() in Fastify; return to continue
  } catch (error) {
    logger.error(`[requireAuth] Authentication error for path: ${request.url} - ${error.name}: ${error.message}`);
    if (error.name === "TokenExpiredError") {
      return reply.code(401).send({ success: false, message: "Access token expired" });
    } else if (error.name === "JsonWebTokenError") {
      return reply.code(401).send({ success: false, message: "Invalid token" });
    } else {
      return reply.code(500).send({ success: false, message: "Server error during authentication" });
    }
  }
};