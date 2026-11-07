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
    /*
     * บังคับคีย์ทั้งสองตัวกับทุก provider ไม่ใช่เฉพาะ MinIO
     *
     * เดิม s3 ไม่ถูกบังคับเลย พอคีย์หาย credentials() คืน undefined
     * แล้ว AWS SDK ไปไล่หา credential จากที่อื่น (ตัวแปร AWS_* หรือ
     * instance metadata) ซึ่งบนเครื่องที่ไม่ได้ตั้งไว้จะไม่เจอ
     * การตั้งค่าที่ไม่ครบจึงผ่านด่านนี้ไปได้ แล้วไประเบิดตอนอัปโหลดจริง
     * เป็น 500 ที่ไม่บอกอะไรเลย กว่าจะรู้ว่าลืมใส่คีย์ก็ต้องไปไล่ log เอง
     *
     * ล้มตั้งแต่ตอนอ่านค่าพร้อมบอกชื่อตัวแปรที่ขาด หาสาเหตุง่ายกว่ากันมาก
     */
    /*
     * บน production ห้าม endpoint ชี้กลับมาที่เครื่องตัวเอง
     *
     * ค่า dev ของโปรเจกต์นี้คือ http://127.0.0.1:9000 ซึ่งเป็น MinIO ในเครื่อง
     * ถ้าคัดค่านั้นขึ้นเซิร์ฟเวอร์ไปด้วย การตั้งค่าจะผ่านด่านทุกข้อ หน้าเว็บ
     * ขึ้นปกติ แล้วไปล้มตอนผู้ใช้กดแนบไฟล์จริงด้วย connect ECONNREFUSED
     * ซึ่งผู้ใช้เห็นแค่ 500 เปล่า ๆ
     *
     * จับตั้งแต่ตอนอ่านค่าแล้วบอกตรง ๆ ว่าน่าจะคัดค่า dev มา
     */
    const host = (() => {
      try { return value.STORAGE_ENDPOINT ? new URL(value.STORAGE_ENDPOINT).hostname : ""; }
      catch { return ""; }
    })();
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    if (process.env.NODE_ENV === "production" && isLoopback) {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_ENDPOINT"],
        message: `STORAGE_ENDPOINT ชี้ไปที่ ${host} ซึ่งเป็นเครื่องตัวเอง บน production ต้องเป็นที่อยู่ของ S3 จริง (คัดค่าจาก .env ของเครื่อง dev มาหรือเปล่า)`,
      });
    }

    const missingKeys = [
      !value.STORAGE_ACCESS_KEY ? "STORAGE_ACCESS_KEY" : null,
      !value.STORAGE_SECRET_KEY ? "STORAGE_SECRET_KEY" : null,
    ].filter(Boolean);
    if (missingKeys.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_ACCESS_KEY"],
        message: `ต้องกำหนด ${missingKeys.join(" และ ")} ให้ครบ`,
      });
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
