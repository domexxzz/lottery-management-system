import { createHash } from "node:crypto";
import { extname } from "node:path";
import sharp, { type Metadata } from "sharp";
import { ValidationError } from "@/lib/errors";
import { getStorageConfig } from "@/lib/storage/config";

const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

type AllowedFormat = keyof typeof MIME_BY_FORMAT;

function signatureFormat(bytes: Buffer): AllowedFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function extensionMatches(fileName: string, format: AllowedFormat): boolean {
  const extension = extname(fileName).toLowerCase();
  if (format === "jpeg") return extension === ".jpg" || extension === ".jpeg";
  return extension === `.${format}`;
}

export type ProcessedEvidenceImage = {
  body: Buffer;
  mimeType: "image/webp";
  originalChecksum: string;
  width: number;
  height: number;
};

export async function validateAndProcessEvidenceImage(input: {
  bytes: Buffer;
  fileName: string;
  declaredMimeType: string;
}): Promise<ProcessedEvidenceImage> {
  const config = getStorageConfig();
  if (input.bytes.length === 0) throw new ValidationError("ไฟล์รูปว่างเปล่า");
  if (input.bytes.length > config.maxFileSizeBytes) {
    throw new ValidationError(`รูปต้องมีขนาดไม่เกิน ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB`);
  }

  const format = signatureFormat(input.bytes);
  if (!format) throw new ValidationError("รองรับเฉพาะไฟล์ JPG, JPEG, PNG และ WEBP ที่เป็นรูปจริง");
  if (!extensionMatches(input.fileName, format)) throw new ValidationError("นามสกุลไฟล์ไม่ตรงกับเนื้อหาไฟล์จริง");
  if (input.declaredMimeType !== MIME_BY_FORMAT[format]) throw new ValidationError("MIME Type ไม่ตรงกับเนื้อหาไฟล์จริง");

  let metadata: Metadata;
  try {
    metadata = await sharp(input.bytes, { failOn: "error", limitInputPixels: config.maxImagePixels }).metadata();
  } catch {
    throw new ValidationError("ไม่สามารถอ่านรูปได้ หรือรูปมีขนาดพิกเซลผิดปกติ");
  }
  if (!metadata.width || !metadata.height) throw new ValidationError("รูปไม่มีขนาดที่ถูกต้อง");
  if (metadata.width * metadata.height > config.maxImagePixels) throw new ValidationError("รูปมีจำนวนพิกเซลเกินขีดจำกัดความปลอดภัย");

  const body = await sharp(input.bytes, { failOn: "error", limitInputPixels: config.maxImagePixels })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90, effort: 4 })
    .toBuffer();

  return {
    body,
    mimeType: "image/webp",
    originalChecksum: createHash("sha256").update(input.bytes).digest("hex"),
    width: metadata.width,
    height: metadata.height,
  };
}
