import { describe, expect, test } from "vitest";
import type { Role } from "@prisma/client";
import { menuFor } from "./navigation";

describe("เมนูเปลี่ยนรหัสผ่าน", () => {
  test.each(["OWNER", "ADMIN", "AGENT"] satisfies Role[])("%s เห็นเมนูเปลี่ยนรหัสผ่าน", (role) => {
    expect(menuFor(role)).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/change-password", label: "เปลี่ยนรหัสผ่าน" }),
    ]));
  });
});
