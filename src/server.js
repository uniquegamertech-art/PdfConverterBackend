import dotenv from "dotenv";
dotenv.config();

import fastify from "fastify";

console.log(process.env.REDIS_HOST)
import MongoStore from "connect-mongo";
import { MongoClient } from "mongodb";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import session from "@fastify/session";
import cookie from "@fastify/cookie";
import { requestContextHook } from "./Utils/requestContext.js";
import redisClient from "./Utils/redisClient.js";
import { connectDB } from "./DB/connectDB.js";
import authRouter from "./Routers/auth.router.js";
import fs from 'fs';

import { errorHandler, notFoundHandler } from "./Middleware/errorHandler.js";
import { config } from "./Utils/config.js";
import { logger } from "./Utils/logger.js";
import mongoose from "mongoose";





import sensible from "fastify-sensible"; // Corrected import



import pdfRouter from "./Routers/pdf.router.js";



const app = fastify({
  logger: false,
  trustProxy: 1,
});
const mongoUrl = config.MONGO_URL;
if (process.NODE_ENV === "development") {
  logger.debug("Running in development mode");
}

// Request context hook (CLS for requestId)
app.addHook("onRequest", requestContextHook);

// Manual request logging (replaces morgan)
app.addHook("onResponse", (request, reply, done) => {
  const remoteAddr = request.ip;
  const date = new Date().toUTCString();
  const method = request.method;
  const url = request.url;
  const httpVersion = request.raw.httpVersion;
  const status = reply.statusCode;
  const resLength = reply.getHeader("content-length") || "-";
  const referrer = request.headers.referer || request.headers.referrer || "-";
  const userAgent = request.headers["user-agent"] || "-";
  const log = `${remoteAddr} - - [${date}] "${method} ${url} HTTP/${httpVersion}" ${status} ${resLength} "${referrer}" "${userAgent}"`;
  logger.http(log);
  done();
});
await app.register(helmet);
await app.register(sensible);
/* await app.register(cors, {
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost:5173",
      "http://127.0.0.1:5173",  // Add this exact match
      "http://localhost:8080",
      "http://127.0.0.1:8080"   // If using the other port
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  // Add if needed for cookies/auth responses
  exposedHeaders: ["Set-Cookie", "Authorization"],
}); */
await app.register(rateLimit, {
  timeWindow: 15 * 60 * 1000,
  max: 100,
  errorResponseBuilder: (request, context) => {
    logger.warn(`Rate limit exceeded for IP: ${request.ip}`);
    return { message: "Too many requests, slow down." };
  },
});
await app.register(cookie);
app.addHook("preHandler", async (request, reply) => {
  console.log(`[preHandler] Cookies for ${request.url}:`, request.cookies);
});

// ----------------- Session Store -----------------
const mongoClient = new MongoClient(mongoUrl);
await mongoClient.connect();
logger.info("MongoClient connected for sessions.");

const sessionTTL = 60 * 60 * 24 * 30; // 30 days (seconds)

const store = MongoStore.create({
  client: mongoClient,
  collectionName: "sessions",
  ttl: sessionTTL,
  autoRemove: "native",
});

await app.register(session, {
  secret: config.SESSION_SECRET,
  saveUninitialized: false,
  rolling: false, // Equivalent to resave: false
  store,
  cookie: {
    maxAge: sessionTTL * 1000,
    secure: true,
    httpOnly: true,
    sameSite: "none",
    path: "/",
  },
});
// ----------------- Routes -----------------
await app.register(pdfRouter, { prefix: "/api/v1" });
await app.register(authRouter, { prefix: "/api/v1/auth" });
app.ready().then(() => {
  console.log(app.printRoutes());
});
// ----------------- Error Handlers -----------------
app.setNotFoundHandler(notFoundHandler);
app.setErrorHandler(errorHandler);





// ----------------- Server -----------------
let server;

const startServer = async () => {
  await connectDB();

  // --- Database Seeding Logic ---

  (async () => {
    try {
      await redisClient.set("test-key", "hello");
      const value = await redisClient.get("test-key");
      console.log("Redis test value:", value); // should log "hello"
    } catch (err) {
      console.error("Redis test failed:", err);
    }
  })();
/*   const httpsOptions = {
    key: fs.readFileSync('/usr/src/app/server.key'),   // Or full path if moved
    cert: fs.readFileSync('/usr/src/app/server.crt')
  }; */
  const port = parseInt(process.env.PORT || "3001", 10); // Parse to integer for safety
  app.listen({ port, host: "0.0.0.0"/* , https: httpsOptions */ });
  logger.info(
    `🚀 Server running in ${process.env.NODE_ENV} mode on port ${process.env.PORT}`
  );
  if (process.env.NODE_ENV === "development") {
    logger.debug(`http://localhost:${process.env.PORT}`);
  }
};

startServer();

// ----------------- Graceful Shutdown -----------------
async function cleanup() {
  logger.info("Starting cleanup process...");

  logger.debug("Closing Fastify server...");
  try {
    await app.close();
    logger.info("Fastify server closed.");
  } catch (error) {
    logger.error("Failed to close Fastify server:", error);
  }

  if (mongoose.connection.readyState !== 0) {
    logger.debug("Disconnecting Mongoose...");
    try {
      await mongoose.disconnect();
      logger.info("Mongoose disconnected.");
    } catch (error) {
      logger.error("Failed to disconnect Mongoose:", error);
    }
  }

  if (mongoClient) {
    logger.debug("Closing Mongo client...");
    try {
      await mongoClient.close(true);
      logger.info("MongoStore client disconnected.");
    } catch (error) {
      logger.error("Failed to close Mongo client:", error);
    }
  }



  logger.info("All connections closed successfully.");
}

async function flushLogger() {
  logger.debug("Flushing logs...");
  return new Promise((resolve) => {
    const transports = logger.transports.filter((t) => t.close);
    let pendingTransports = transports.length;

    if (pendingTransports === 0) {
      logger.debug("No transports to flush.");
      return resolve();
    }

    let closedCount = 0;
    const onTransportClosed = () => {
      closedCount++;
      if (closedCount === pendingTransports) {
        logger.debug("All transports flushed.");
        resolve();
      }
    };

    transports.forEach((transport) => {
      transport.close(onTransportClosed);
    });

    setTimeout(() => {
      logger.warn("Flush logger timeout reached.");
      resolve();
    }, 1000);
  });
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, async () => {
    logger.warn(`Received ${signal}, starting graceful shutdown...`);

    const timeout = setTimeout(() => {
      logger.error("Force exiting after 10s...");
      process.exit(1);
    }, 20000);

    try {
      logger.info("Starting cleanup process...");
      await cleanup();
      logger.info("✅ Cleanup complete, exiting.");

      logger.info("Flushing logs...");
      await flushLogger();
      logger.info("Logs flushed successfully.");

      clearTimeout(timeout);
      console.log("Graceful shutdown completed.");

      setTimeout(() => process.exit(0), 100);
    } catch (err) {
      logger.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    }
  });
});

["uncaughtException", "unhandledRejection"].forEach((event) => {
  process.on(event, async (err) => {
    logger.error(`Fatal error due to ${event}:`, err);

    const timeout = setTimeout(() => {
      console.log("Force exiting after 10s...");
      process.exit(1);
    }, 10000);

    try {
      await cleanup();
      logger.info("Emergency cleanup completed.");
      await flushLogger();
      clearTimeout(timeout);
      process.exit(1);
    } catch (e) {
      logger.error("Error during forced shutdown:", e);
      try {
        await flushLogger();
      } catch (flushError) {
        console.error("Failed to flush logs during emergency shutdown:", flushError);
      }
      clearTimeout(timeout);
      process.exit(1);
    }
  });
});