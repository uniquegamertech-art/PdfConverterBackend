// Utils/logger.js (updated for better metadata handling)
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getRequestId } from "./requestContext.js";

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp, stack, splat }) => {
      const requestId = getRequestId() || "N/A";
      let logMessage = stack || message;
      if (splat && splat.length > 0) {
        logMessage += " " + splat.map((s) => (typeof s === "object" ? JSON.stringify(s) : s)).join(" ");
      }
      return `${timestamp} [${level.toUpperCase()}] [req:${requestId}] ${logMessage}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.colorize({ all: true }),
    }),
    new DailyRotateFile({
      filename: "logs/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),
    new DailyRotateFile({
      filename: "logs/combined-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),
    new DailyRotateFile({
      filename: "logs/access-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "http",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d",
    }),
  ],
});

export { logger };