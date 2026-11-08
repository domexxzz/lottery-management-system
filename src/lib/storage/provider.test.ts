import { describe, expect, test } from "vitest";
import { AppError } from "@/lib/errors";
import { S3StorageProvider } from "./provider";
import type { StorageConfig } from "./config";

/**
 * การแปลข้อผิดพลาดจากที่เก็บไฟล์
 *
 * ถ้าข้อนี้หลุด ผู้ใช้จะกลับไปเห็น 500 เปล่า ๆ ตอนกดแนบไฟล์ แล้วสาเหตุจริง
 * ไปอยู่ใน log ที่ผู้ใช้ไม่มีทางเห็น ซึ่งเคยทำให้ไล่หาสาเหตุนานมาแล้ว
 */

const config: StorageConfig = {
  provider: "s3",
  endpoint: "https://example.test",
  region: "ap-southeast-2",
  bucket: "bill-private",
  accessKey: "AK",
  secretKey: "SK",
  forcePathStyle: true,
  signedUrlTtl: 300,
  maxFileSizeBytes: 1024,
  maxFilesPerBill: 5,
  maxImagePixels: 1_000_000,
  requireOrderEvidence: true,
};

/** ยัด error ของ AWS SDK เข้าไปโดยไม่ต้องยิงเน็ตจริง */
function providerThatFailsWith(code: string) {
  const provider = new S3StorageProvider(config);
  (provider as unknown as { client: { send: () => Promise<never> } }).client = {
    send: async () => {
      throw Object.assign(new Error("from storage"), { Code: code, name: code });
    },
  };
  return provider;
}

describe("แปลข้อผิดพลาดของที่เก็บไฟล์ให้บอกสาเหตุ", () => {
  test.each([
    ["InvalidAccessKeyId", "STORAGE_ACCESS_KEY"],
    ["SignatureDoesNotMatch", "STORAGE_SECRET_KEY"],
    ["NoSuchBucket", "STORAGE_BUCKET"],
  ])("%s บอกชื่อตัวแปรที่ต้องไปแก้", async (code, expected) => {
    const provider = providerThatFailsWith(code);
    await expect(
      provider.upload({ key: "k", body: Buffer.from("x"), contentType: "text/plain" }),
    ).rejects.toThrow(expected);
  });

  test("AccessDenied บอกว่าเป็นเรื่องสิทธิ์ ไม่ใช่คีย์ผิด", async () => {
    const provider = providerThatFailsWith("AccessDenied");
    await expect(
      provider.upload({ key: "k", body: Buffer.from("x"), contentType: "text/plain" }),
    ).rejects.toThrow(/ไม่มีสิทธิ์เขียนไฟล์/);
  });

  test("แปลเป็น AppError จึงไม่ถูก apiError กลบเป็นข้อความกลาง ๆ", async () => {
    const provider = providerThatFailsWith("InvalidAccessKeyId");
    await expect(
      provider.upload({ key: "k", body: Buffer.from("x"), contentType: "text/plain" }),
    ).rejects.toBeInstanceOf(AppError);
  });

  test("รหัสที่ไม่รู้จักถูกโยนต่อตามเดิม ไม่กลืนข้อมูลการวินิจฉัย", async () => {
    const provider = providerThatFailsWith("SomethingElse");
    await expect(
      provider.upload({ key: "k", body: Buffer.from("x"), contentType: "text/plain" }),
    ).rejects.toThrow("from storage");
  });
});
