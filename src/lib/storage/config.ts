import { z } from "zod";

const booleanValue = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

const schema = z
  .object({
    STORAGE_PROVIDER: z.enum(["minio", "s3"]),
    STORAGE_ENDPOINT: z.string().url().optional(),
    STORAGE_REGION: z.string().trim().min(1),
    STORAGE_BUCKET: z.string().trim().min(3),
    STORAGE_ACCESS_KEY: z.string().trim().min(1).optional(),
    STORAGE_SECRET_KEY: z.string().trim().min(1).optional(),
    STORAGE_FORCE_PATH_STYLE: booleanValue.default(false),
    STORAGE_SIGNED_URL_TTL: z.coerce.number().int().min(60).max(3600).default(300),
    ATTACHMENT_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(20).default(5),
    ATTACHMENT_MAX_FILES_PER_BILL: z.coerce.number().int().min(1).max(20).default(5),
    ATTACHMENT_MAX_IMAGE_PIXELS: z.coerce.number().int().min(1_000_000).max(80_000_000).default(40_000_000),
    BILL_ORDER_EVIDENCE_REQUIRED: booleanValue.default(true),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_PROVIDER === "minio" && !value.STORAGE_ENDPOINT) {
      ctx.addIssue({ code: "custom", path: ["STORAGE_ENDPOINT"], message: "MinIO ต้องกำหนด STORAGE_ENDPOINT" });
    }
    if ((value.STORAGE_ACCESS_KEY && !value.STORAGE_SECRET_KEY) || (!value.STORAGE_ACCESS_KEY && value.STORAGE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["STORAGE_ACCESS_KEY"], message: "ต้องกำหนด Access Key และ Secret Key เป็นคู่กัน" });
    }
    if (value.STORAGE_PROVIDER === "minio" && (!value.STORAGE_ACCESS_KEY || !value.STORAGE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["STORAGE_ACCESS_KEY"], message: "MinIO ต้องกำหนด Access Key และ Secret Key" });
    }
  });

export type StorageConfig = {
  provider: "minio" | "s3";
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKey: string | undefined;
  secretKey: string | undefined;
  forcePathStyle: boolean;
  signedUrlTtl: number;
  maxFileSizeBytes: number;
  maxFilesPerBill: number;
  maxImagePixels: number;
  requireOrderEvidence: boolean;
};

let cached: StorageConfig | undefined;

export function getStorageConfig(): StorageConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · ");
    throw new Error(`ตั้งค่า Private File Storage ไม่ครบ: ${details} — ดู .env.example`);
  }
  cached = {
    provider: parsed.data.STORAGE_PROVIDER,
    endpoint: parsed.data.STORAGE_ENDPOINT,
    region: parsed.data.STORAGE_REGION,
    bucket: parsed.data.STORAGE_BUCKET,
    accessKey: parsed.data.STORAGE_ACCESS_KEY,
    secretKey: parsed.data.STORAGE_SECRET_KEY,
    forcePathStyle: parsed.data.STORAGE_FORCE_PATH_STYLE,
    signedUrlTtl: parsed.data.STORAGE_SIGNED_URL_TTL,
    maxFileSizeBytes: parsed.data.ATTACHMENT_MAX_FILE_SIZE_MB * 1024 * 1024,
    maxFilesPerBill: parsed.data.ATTACHMENT_MAX_FILES_PER_BILL,
    maxImagePixels: parsed.data.ATTACHMENT_MAX_IMAGE_PIXELS,
    requireOrderEvidence: parsed.data.BILL_ORDER_EVIDENCE_REQUIRED,
  };
  return cached;
}

export function resetStorageConfigForTests(): void {
  cached = undefined;
}
