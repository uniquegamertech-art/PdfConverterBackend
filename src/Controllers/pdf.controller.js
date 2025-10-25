import pkg from '@prisma/client';
import { PutObjectCommand, CreateBucketCommand, HeadObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const { PrismaClient } = pkg;

import { getRabbitChannel } from "../Utils/lavinmqclient.js";
import { s3 } from "../s3.js";
import { logger } from "../Utils/logger.js";

const prisma = new PrismaClient();

export const createUploadSession = async (req, reply) => {
  const { filename, size } = req.body;
  if (!filename) return reply.badRequest("filename required");
  // basic size guard
  if (size && size > 1024 * 1024 * 1024) return reply.status(413).send({ error: "file too large" });

  const sessionId = uuidv4();
  const key = `uploads/${sessionId}/${filename}`;



  // Generate pre-signed URL for direct S3 upload
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: 3600, // URL valid for 1 hour
  });
console.log(uploadUrl)
  const session = await prisma.uploadSession.create({
    data: { id: sessionId, objectKey: key, size: size || 0, status: "created" },
  });

  return reply.code(201).send({ sessionId: session.id, key, uploadUrl });
};

// Simple "complete" endpoint - assume file was uploaded to objectKey by client
export const completeUploadSession = async (req, reply) => {
  const { id } = req.params;
  const session = await prisma.uploadSession.findUnique({ where: { id } });
  if (!session) return reply.notFound();
  // optional: head object to verify exists
  try {
    await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: session.objectKey }));
  } catch (err) {
    return reply.status(400).send({ error: "uploaded object not found" });
  }
  await prisma.uploadSession.update({ where: { id }, data: { status: "uploaded" } });
  return reply.send({ sessionId: id });
};

// Create job (enqueue)
export const createJob = async (req, reply) => {
  const { sessionId, outputs = [{ format: "docx" }] } = req.body;
  if (!sessionId) return reply.badRequest("sessionId required");
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId } });
  if (!session) return reply.notFound("upload session not found");

  const jobId = uuidv4();
  const job = await prisma.job.create({
    data: {
      id: jobId,
      sessionId,
      status: "queued",
      outputs: JSON.stringify(outputs),
    },
  });
  logger.info(`Created job: jobId=${jobId}, sessionId=${sessionId}, objectKey=${session.objectKey}, formats=${JSON.stringify(outputs)}`);

  const libFormats = ["docx", "pptx"];
  const libOutputs = outputs.filter(o => libFormats.includes(o.format.toLowerCase()));
  const popOutputs = outputs.filter(o => !libFormats.includes(o.format.toLowerCase()));

  try {
    const rabbitChannel = await getRabbitChannel(); // Await the channel

    if (libOutputs.length > 0) {
      const jobData = {
        jobId,
        s3InputKey: session.objectKey,
        outputs: libOutputs,
        bucket: process.env.S3_BUCKET || 'pdf-converter-files',
      };
      rabbitChannel.sendToQueue('libreoffice-queue', Buffer.from(JSON.stringify(jobData)), {
        persistent: true,
      });
      logger.debug(`Enqueued libreoffice job: jobId=${jobId}, outputs=${JSON.stringify(libOutputs)}`);
    }

    if (popOutputs.length > 0) {
      const jobData = {
        jobId,
        s3InputKey: session.objectKey,
        outputs: popOutputs,
        bucket: process.env.S3_BUCKET || 'pdf-converter-files',
      };
      rabbitChannel.sendToQueue('poppler-queue', Buffer.from(JSON.stringify(jobData)), {
        persistent: true,
      });
      logger.debug(`Enqueued poppler job: jobId=${jobId}, outputs=${JSON.stringify(popOutputs)}`);
    }

    return reply.code(202).send({ jobId, location: `/api/v1/jobs/${jobId}` });
  } catch (err) {
    logger.error(`Failed to enqueue job: jobId=${jobId}`, err);
    return reply.status(500).send({ error: "Failed to enqueue job", message: err.message });
  }
};

// Get job status
export const getJobStatus = async (req, reply) => {
  const { jobId } = req.params;

  // defensive: accept either prisma.job or prisma.Job depending on how client is exposed
  const JobModel = prisma.job ?? prisma.Job;
  logger.debug(`Prisma job accessor: ${!!JobModel}`);

  if (!JobModel) {
    logger.error("Prisma client does not expose Job model. Available keys: %o", Object.getOwnPropertyNames(prisma));
    return reply.internalServerError("Prisma client misconfigured");
  }

  try {
    const job = await JobModel.findUnique({ 
      where: { id: jobId }, 
      include: { 
        results: true,  // This will include JobResult records
        logs: true      // This will include JobLog records
      } 
    });
    if (!job) return reply.notFound();
    
    // Transform the response to match what the frontend expects
    return reply.send({
      jobId: job.id,
      status: job.status,
      outputs: job.outputs,
      results: job.results.map(result => ({
        id: result.id,
        jobId: result.jobId,
        outputKey: result.outputKey,
        format: result.outputKey.split('.').pop(), // Extract format from filename
        meta: result.meta,
        createdAt: result.createdAt
      })),
      logs: job.logs.map(log => ({
        id: log.id,
        jobId: log.jobId,
        level: log.level,
        message: log.message,
        createdAt: log.createdAt
      })),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt
    });
  } catch (err) {
    logger.error("Failed to get job", { jobId, err: String(err).slice(0, 2000) });
    return reply.internalServerError("Failed to get job");
  }
};

// Get pre-signed download URL for a job result
export const getJobResultDownload = async (req, reply) => {
  const { jobId, resultId } = req.params;

  try {
    // Verify job exists
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.notFound("Job not found");

    // Verify result exists
    const result = await prisma.jobResult.findUnique({ where: { id: resultId } });
    if (!result || result.jobId !== jobId) return reply.notFound("Result not found");

  
    // Generate pre-signed URL for downloading the file
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: result.outputKey,
    });

    const downloadUrl = await getSignedUrl(s3, command, {
      expiresIn: 3600, // URL valid for 1 hour
    });

    logger.info(`Generated pre-signed download URL for jobId=${jobId}, resultId=${resultId}, outputKey=${result.outputKey}`);
    return reply.send({ downloadUrl });
  } catch (err) {
    logger.error("Failed to generate download URL", { jobId, resultId, err: String(err).slice(0, 2000) });
    return reply.internalServerError("Failed to generate download URL");
  }
};

// Update job status
export const updateJobStatus = async (req, reply) => {
  const { jobId } = req.params;
  const { status, startedAt, finishedAt } = req.body;

  if (!["queued", "processing", "completed", "failed"].includes(status)) {
    return reply.badRequest("Invalid status");
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.notFound("Job not found");

    const updateData = { status };
    if (startedAt) updateData.startedAt = new Date(startedAt);
    if (finishedAt) updateData.finishedAt = new Date(finishedAt);

    await prisma.job.update({
      where: { id: jobId },
      data: updateData,
    });
    logger.info(`Updated job status: jobId=${jobId}, status=${status}`);
    return reply.send({ jobId, status });
  } catch (err) {
    logger.error("Failed to update job status", { jobId, err: String(err).slice(0, 2000) });
    return reply.internalServerError("Failed to update job status");
  }
};

// Add job result
export const addJobResult = async (req, reply) => {
  const { jobId } = req.params;
  const { outputKey, format, meta } = req.body; // meta is optional in your schema

  if (!outputKey || !format) {
    return reply.badRequest("outputKey and format are required");
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.notFound("Job not found");

    const result = await prisma.jobResult.create({
      data: {
        jobId,
        outputKey,
        meta: meta || null, // Handle optional meta field
      },
    });
    logger.info(`Added JobResult: jobId=${jobId}, outputKey=${outputKey}, format=${format}`);
    return reply.code(201).send({ 
      id: result.id, 
      jobId, 
      outputKey, 
      format, // Note: format isn't stored in DB, but we return it for the response
      meta: result.meta 
    });
  } catch (err) {
    logger.error("Failed to add JobResult", { jobId, err: String(err).slice(0, 2000) });
    return reply.internalServerError("Failed to add JobResult");
  }
};

// Add job log
export const addJobLog = async (req, reply) => {
  const { jobId } = req.params;
  const { level, message } = req.body; // Match your schema field order

  if (!message || !["info", "warn", "error"].includes(level)) {
    return reply.badRequest("message and valid level (info, warn, error) are required");
  }

  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.notFound("Job not found");

    const logEntry = await prisma.jobLog.create({
      data: {
        jobId,
        level,
        message,
      },
    });
    logger.info(`Added JobLog: jobId=${jobId}, level=${level}, message=${message.slice(0, 100)}`);
    return reply.code(201).send({ 
      id: logEntry.id, 
      jobId, 
      level, 
      message, 
      createdAt: logEntry.createdAt 
    });
  } catch (err) {
    logger.error("Failed to add JobLog", { jobId, err: String(err).slice(0, 2000) });
    return reply.internalServerError("Failed to add JobLog");
  }
};