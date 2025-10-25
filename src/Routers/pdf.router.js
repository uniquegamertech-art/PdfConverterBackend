import pkg from '@prisma/client';
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { s3 } from "../s3.js";
import {
  createUploadSession,
  completeUploadSession,
  createJob,
  getJobStatus,
  getJobResultDownload,
  updateJobStatus,
  addJobResult,
  addJobLog
} from "../Controllers/pdf.controller.js";
import { requireAuth } from "../Middleware/requireAuth.js";

const { PrismaClient } = pkg;

export default async function pdfRouter (fastify, opts) {
  console.log("Registering pdfRouter with prefix:", opts.prefix); // Should log /api/v1
  const prisma = new PrismaClient();

  fastify.addHook("onReady", async () => {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
      console.log("S3 bucket check completed");
    } catch (err) {
      console.log("S3 bucket creation failed (ignored):", err.message);
    }
  });

  fastify.post("/uploads/sessions", { handler: createUploadSession });
  fastify.get("/check", { handler: async (request, reply) => {
    return { status: "ok" };
  } });
  fastify.put("/uploads/sessions/:id/complete", { handler: completeUploadSession });
  fastify.post("/jobs", { /* preHandler: requireAuth, */ handler: createJob });
  fastify.get("/jobs/:jobId", { handler: getJobStatus });
  fastify.get("/jobs/:jobId/results/:resultId/download", { handler: getJobResultDownload });
  fastify.put("/jobs/:jobId/status", { handler: updateJobStatus });
  fastify.post("/jobs/:jobId/results", { handler: addJobResult });
  fastify.post("/jobs/:jobId/logs", { /* preHandler: requireAuth, */ handler: addJobLog });
};