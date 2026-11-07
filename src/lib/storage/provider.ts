import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getStorageConfig, type StorageConfig } from "./config";
import type { PrivateObjectStorage, StorageUploadInput, StoredObjectMetadata } from "./types";

function credentials(config: StorageConfig): S3ClientConfig["credentials"] {
  if (!config.accessKey || !config.secretKey) return undefined;
  return { accessKeyId: config.accessKey, secretAccessKey: config.secretKey };
}

function safeDownloadName(fileName: string): string {
  return fileName.replace(/[\r\n"\\/]/g, "_").slice(0, 160) || "evidence.webp";
}

abstract class S3CompatibleStorage implements PrivateObjectStorage {
  protected readonly client: S3Client;

  constructor(protected readonly config: StorageConfig, clientConfig: S3ClientConfig) {
    this.client = new S3Client(clientConfig);
  }

  async upload(input: StorageUploadInput): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "private, no-store",
      Metadata: input.metadata,
    }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async getObjectMetadata(key: string): Promise<StoredObjectMetadata> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
    return {
      size: result.ContentLength ?? 0,
      contentType: result.ContentType,
      metadata: result.Metadata ?? {},
    };
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const body = result.Body;
    if (!body) throw new Error(`ไม่พบเนื้อไฟล์ใน storage: ${key}`);
    return Buffer.from(await body.transformToByteArray());
  }

  async getSignedUrl(input: { key: string; fileName: string; disposition: "inline" | "attachment" }): Promise<string> {
    const name = safeDownloadName(input.fileName);
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ResponseContentDisposition: `${input.disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      ResponseCacheControl: "private, no-store",
    });
    return getSignedUrl(this.client, command, { expiresIn: this.config.signedUrlTtl });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.getObjectMetadata(key);
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (error instanceof NotFound || status === 404) return false;
      throw error;
    }
  }
}

export class MinioStorageProvider extends S3CompatibleStorage {
  constructor(config: StorageConfig) {
    super(config, {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: credentials(config),
    });
  }
}

export class S3StorageProvider extends S3CompatibleStorage {
  constructor(config: StorageConfig) {
    super(config, {
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: credentials(config),
    });
  }
}

let provider: PrivateObjectStorage | undefined;

export function getStorageProvider(): PrivateObjectStorage {
  if (provider) return provider;
  const config = getStorageConfig();
  provider = config.provider === "minio" ? new MinioStorageProvider(config) : new S3StorageProvider(config);
  return provider;
}

export function resetStorageProviderForTests(): void {
  provider = undefined;
}
