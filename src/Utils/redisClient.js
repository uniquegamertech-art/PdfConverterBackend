import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  username: process.env.REDIS_USERNAME,  // still required on Redis Cloud
  password: process.env.REDIS_PASSWORD,
  // ❌ no tls here
});

redisClient.on("connect", () => console.log("✅ Connected to Redis (no TLS)"));
redisClient.on("error", (err) => console.error("❌ Redis error:", err));

export default redisClient;
