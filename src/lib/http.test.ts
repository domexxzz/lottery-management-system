import { describe, expect, test } from "vitest";
import { assertSameOrigin } from "./http";

describe("assertSameOrigin", () => {
  test("ยอมรับคำขอจาก host เดียวกัน", () => {
    const request = new Request("https://backoffice.example/api/test", { headers: { origin: "https://backoffice.example", host: "backoffice.example" } });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  test("ปฏิเสธ cross-site และคำขอที่ไม่มี Origin", () => {
    expect(() => assertSameOrigin(new Request("https://backoffice.example/api/test", { headers: { origin: "https://evil.example", host: "backoffice.example" } }))).toThrow(/เว็บไซต์อื่น/);
    expect(() => assertSameOrigin(new Request("https://backoffice.example/api/test", { headers: { host: "backoffice.example" } }))).toThrow(/ต้นทาง/);
  });
});
