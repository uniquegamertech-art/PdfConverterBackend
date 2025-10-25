// ./Utils/config.js (no changes)
import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();
console.log(process.env)
console.log("Loaded env:", process.env.MONGO_URL, process.env.SESSION_SECRET);

const envSchema = z.object({
 
  MONGO_URL: z.string().url(),
  SESSION_SECRET: z.string().min(5),
 
  
});

export const config = envSchema.parse(process.env);