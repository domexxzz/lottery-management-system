import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

function applicationComponents(): { path: string; source: string }[] {
  const roots = [join(process.cwd(), "src", "app"), join(process.cwd(), "src", "components")];
  const files: { path: string; source: string }[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(name) && !name.includes(".test.")) files.push({ path, source: readFileSync(path, "utf8") });
    }
  };
  roots.forEach(walk);
  return files;
}

describe("มาตรฐานปฏิทินทั้งระบบ", () => {
  test("ไม่มี native date, datetime-local, month หรือ time picker หลงเหลือในหน้าจอ", () => {
    const nativePicker = /type\s*=\s*["'](?:date|datetime-local|month|time)["']/;
    const offenders = applicationComponents().filter((file) => nativePicker.test(file.source)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
