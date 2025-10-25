// auth.router.js
import { checkAuth, forgotPassword, login, logout, refresh, resetPassword, signup, updateUserProfile, verifyEmail, changePassword, resendVerificationCode } from "../Controllers/auth.controller.js";
import { requireAuth } from "../Middleware/requireAuth.js";

export default async function authRouter(fastify, opts) {
  fastify.post("/signup", { handler: signup });
  fastify.post("/protected-route", { preHandler: requireAuth, handler: async (request, reply) => {
    reply.send("Hello");
  } });
  fastify.post("/verify-email", { handler: verifyEmail });
  fastify.post("/login", { handler: login });
  fastify.post("/logout", { handler: logout });
  fastify.post("/forgot-password", { handler: forgotPassword });
  fastify.post("/reset-password/:token", { handler: resetPassword });
  fastify.get("/check-auth", { preHandler: requireAuth, handler: checkAuth });
  fastify.get("/refresh", { handler: refresh });
  fastify.put("/profile", { preHandler: requireAuth, handler: updateUserProfile });
  fastify.put("/change-password", { preHandler: requireAuth, handler: changePassword });
  fastify.post("/resend-verification-code", { handler: resendVerificationCode });
}