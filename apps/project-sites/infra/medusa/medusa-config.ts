import { defineConfig, loadEnv, Modules } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

const REDIS_URL = process.env.REDIS_URL!;
const BACKEND_URL = process.env.MEDUSA_BACKEND_URL || "https://medusa.projectsites.dev";

const resolveRedisUrl = (db: number): string => {
  const u = new URL(REDIS_URL);
  u.pathname = `/${db}`;
  return u.toString();
};

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: REDIS_URL,
    workerMode: (process.env.MEDUSA_WORKER_MODE as "shared" | "worker" | "server") || "server",
    http: {
      storeCors: process.env.STORE_CORS || BACKEND_URL,
      adminCors: process.env.ADMIN_CORS || BACKEND_URL,
      authCors: process.env.AUTH_CORS || BACKEND_URL,
      jwtSecret: process.env.JWT_SECRET || "temp-jwt-secret-change-me",
      cookieSecret: process.env.COOKIE_SECRET || "temp-cookie-secret-change-me",
    },
    port: parseInt(process.env.PORT || "9000", 10),
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
    backendUrl: process.env.MEDUSA_BACKEND_URL || BACKEND_URL,
  },
  modules: [
    {
      resolve: "@medusajs/medusa/cache-redis",
      key: Modules.CACHE,
      options: {
        redisUrl: process.env.CACHE_REDIS_URL || resolveRedisUrl(1),
      },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      key: Modules.EVENT_BUS,
      options: {
        redisUrl: process.env.EVENTS_REDIS_URL || resolveRedisUrl(2),
      },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      key: Modules.WORKFLOW_ENGINE,
      options: {
        redisUrl: process.env.WORKFLOW_REDIS_URL || resolveRedisUrl(3),
      },
    },
    {
      resolve: "@medusajs/medusa/locking-redis",
      key: Modules.LOCKING,
      options: {
        redisUrl: process.env.LOCKING_REDIS_URL || resolveRedisUrl(4),
      },
    },
    {
      resolve: "@medusajs/medusa/file-s3",
      key: Modules.FILE,
      options: {
        fileUrl: process.env.S3_FILE_URL || `${BACKEND_URL}/uploads`,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        region: process.env.S3_REGION || "auto",
        bucket: process.env.S3_BUCKET!,
        endpoint: process.env.S3_ENDPOINT!,
      },
    },
    {
      resolve: "@medusajs/medusa/payment-stripe",
      key: Modules.PAYMENT,
      options: {
        apiKey: process.env.STRIPE_API_KEY || "sk_test_placeholder",
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "whsec_placeholder",
      },
    },
  ],
});
