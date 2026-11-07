export type StorageUploadInput = {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
};

export type StoredObjectMetadata = {
  size: number;
  contentType: string | undefined;
  metadata: Record<string, string>;
};

export interface PrivateObjectStorage {
  upload(input: StorageUploadInput): Promise<void>;
  delete(key: string): Promise<void>;
  getObjectMetadata(key: string): Promise<StoredObjectMetadata>;
  /**
   * อ่านไฟล์ออกมาเป็น bytes
   *
   * ใช้เมื่อต้องส่งไฟล์ต่อไปยังปลายทางที่เข้าถึง storage ของเราไม่ได้
   * เช่น Telegram ซึ่งอยู่คนละเครือข่ายกับ MinIO ในเครื่องพัฒนา
   * การส่ง signed URL ให้ปลายทางไปดึงเองไม่ปลอดภัยเท่า เพราะ URL นั้น
   * ใครถือก็เปิดได้ตลอดอายุของมัน
   */
  download(key: string): Promise<Buffer>;
  getSignedUrl(input: {
    key: string;
    fileName: string;
    disposition: "inline" | "attachment";
  }): Promise<string>;
  objectExists(key: string): Promise<boolean>;
}
