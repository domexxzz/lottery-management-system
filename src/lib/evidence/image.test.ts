import { afterEach, beforeEach, describe, expect, test } from "vitest";
import sharp from "sharp";
import { resetStorageConfigForTests } from "@/lib/storage/config";
import { validateAndProcessEvidenceImage } from "./image";

beforeEach(() => {
  process.env.STORAGE_PROVIDER = "minio";
  process.env.STORAGE_ENDPOINT = "http://127.0.0.1:9000";
  process.env.STORAGE_REGION = "us-east-1";
  process.env.STORAGE_BUCKET = "bill-private";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.ATTACHMENT_MAX_FILE_SIZE_MB = "5";
  process.env.ATTACHMENT_MAX_IMAGE_PIXELS = "40000000";
  resetStorageConfigForTests();
});

afterEach(() => resetStorageConfigForTests());

describe("validateAndProcessEvidenceImage", () => {
  test("decode รูปจริง แปลงเป็น WEBP และไม่คง EXIF", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#168b98" } })
      .withMetadata({ exif: { IFD0: { Copyright: "private" } } })
      .png()
      .toBuffer();
    const result = await validateAndProcessEvidenceImage({ bytes: png, fileName: "proof.png", declaredMimeType: "image/png" });
    expect(result.mimeType).toBe("image/webp");
    expect(result.originalChecksum).toMatch(/^[0-9a-f]{64}$/);
    const metadata = await sharp(result.body).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
  });

  test("ปฏิเสธไฟล์ปลอมที่เปลี่ยนนามสกุล", async () => {
    await expect(validateAndProcessEvidenceImage({
      bytes: Buffer.from("not-an-image"),
      fileName: "fake.jpg",
      declaredMimeType: "image/jpeg",
    })).rejects.toThrow(/รองรับเฉพาะไฟล์/);
  });

  test("ปฏิเสธ MIME และนามสกุลที่ไม่ตรงกับ magic bytes", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
    await expect(validateAndProcessEvidenceImage({ bytes: png, fileName: "wrong.jpg", declaredMimeType: "image/jpeg" })).rejects.toThrow(/นามสกุล/);
  });
});
