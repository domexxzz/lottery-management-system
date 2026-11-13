import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Role } from "@prisma/client";
import { can } from "@/lib/auth/permissions";
import { MENU_ITEMS, menuFor } from "@/lib/navigation";
import { GUIDE_MENU_QUESTION, faqSection, fullGuide, guideEntries, isHowToQuestion, parseGuideSelection, renderGuideAnswer, resolveGuideTurn, roleSection, workflowSection } from "./system-guide";

type Turn = { role: "user" | "assistant"; content: string };
const user = (content: string): Turn => ({ role: "user", content });
const assistant = (content: string): Turn => ({ role: "assistant", content });
const menuReply = () => resolveGuideTurn([user("แนะนำระบบ")])!.reply;

describe("บทสนทนาแนะนำระบบ", () => {
  test.each(["แนะนำระบบ", "แนะนำระบบครับ", " แนะนำระบบหน่อย ", "แนะนำการใช้งานระบบ", "คู่มือการใช้งาน", "วิธีใช้ระบบค่ะ"])(
    "\"%s\" → ถามกลับว่าอยากให้อธิบายตรงไหน",
    (text) => {
      const turn = resolveGuideTurn([user(text)]);
      expect(turn?.reply.startsWith(GUIDE_MENU_QUESTION)).toBe(true);
      expect(turn?.suggestions).toEqual(["อธิบายทั้งหมด", "ส่วนของ Owner", "ส่วนของ Admin", "ส่วนของ Agent", "ขั้นตอนเปิดงวดถึงปิดงวด"]);
    },
  );

  test.each(["ทั้งหมด", "ทั้งหมดเลย", "ทั้งหมดเลยครับ", "อธิบายทุกส่วน", "ALL", "อธิบายทั้งหมด"])(
    "ตอบ \"%s\" หลังเมนู → อธิบายครบ Owner, Admin, Agent แล้วต่อด้วยกระบวนการทำงาน",
    (text) => {
      const turn = resolveGuideTurn([user("แนะนำระบบ"), assistant(menuReply()), user(text)])!;
      const order = ["■ Owner", "■ Admin", "■ Agent", "■ กระบวนการทำงาน"].map((heading) => turn.reply.indexOf(heading));
      expect(order.every((position) => position >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(turn.suggestions).toEqual([]);
    },
  );

  test("เลือกหลายส่วนพร้อมกันได้ และไม่แถมส่วนที่ไม่ได้ขอ", () => {
    const turn = resolveGuideTurn([assistant(menuReply()), user("ขอส่วน owner กับ แอดมิน")])!;
    expect(turn.reply).toContain("■ Owner");
    expect(turn.reply).toContain("■ Admin");
    expect(turn.reply).not.toContain("■ Agent");
    expect(turn.reply).not.toContain("■ กระบวนการทำงาน");
    expect(turn.suggestions).toContain("ส่วนของ Agent");
    expect(turn.suggestions).not.toContain("ส่วนของ Owner");
  });

  test("คำว่าเปิดงวด ปิดงวด หรือขั้นตอน หลังเมนู → ได้กระบวนการทำงาน", () => {
    const turn = resolveGuideTurn([assistant(menuReply()), user("ขั้นตอนเปิดงวดจนปิดงวด")])!;
    expect(turn.reply.startsWith("■ กระบวนการทำงาน")).toBe(true);
  });

  test("กดปุ่มหัวข้อได้ทุกเมื่อ ไม่ต้องอยู่หลังเมนู", () => {
    expect(resolveGuideTurn([user("ส่วนของ Agent")])!.reply.startsWith("■ Agent")).toBe(true);
  });

  test("ไม่แย่งคำถามทั่วไปไปจากผู้ช่วย", () => {
    // "ทั้งหมด" ที่ไม่ได้ตอบเมนู คือคำถามเรื่องข้อมูล เช่น "ยอดขายทั้งหมด"
    expect(resolveGuideTurn([user("ยอดขายทั้งหมดเท่าไหร่")])).toBeNull();
    expect(resolveGuideTurn([assistant("ยอดขายรอบนี้ 10,000.00 บาท"), user("ทั้งหมดล่ะ")])).toBeNull();
    // หลังเมนูแต่ถามยาวเรื่องอื่น ให้ผู้ช่วยตอบ
    expect(resolveGuideTurn([assistant(menuReply()), user("ไม่เป็นไร ขอดูยอดขายของ Agent ทุกคนในงวดล่าสุดแยกตามประเภทรางวัลหน่อย")])).toBeNull();
    expect(resolveGuideTurn([assistant(menuReply()), user("โอเค")])).toBeNull();
  });
});

const ROLES: { topic: "owner" | "admin" | "agent"; role: Role }[] = [
  { topic: "owner", role: "OWNER" },
  { topic: "admin", role: "ADMIN" },
  { topic: "agent", role: "AGENT" },
];

/** บรรทัดในหัวข้อหนึ่งของส่วนบทบาท จนถึงบรรทัดว่าง */
function block(section: string, heading: string): string[] {
  const lines = section.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

describe("คู่มือตรงกับสิทธิ์และเมนูจริงของระบบ", () => {
  test.each(ROLES)("เมนูของ $role ตรงกับแถบเมนูจริงทุกตัว ไม่ขาดไม่เกิน", ({ topic, role }) => {
    const listed = block(roleSection(topic), "เมนูที่เห็น").map((line) => line.replace(/^• /, "").split(" — ")[0]);
    expect(listed).toEqual(menuFor(role).map((item) => item.label));
  });

  test("Agent ไม่เห็นเมนูของฝ่ายบริหาร", () => {
    const menus = block(roleSection("agent"), "เมนูที่เห็น").join("\n");
    for (const label of ["ภาพรวม —", "รายงาน", "ตรวจหลักฐาน", "จัดการผู้ใช้งาน", "ผู้ช่วยล็อตเตอรี่", "ภาพรวม Agent"]) {
      expect(menus).not.toContain(label);
    }
  });

  test("Admin ทำงานประจำได้ แต่เรื่องอนุมัติเงินต้องให้ Owner", () => {
    const section = roleSection("admin");
    const allowed = block(section, "ทำอะไรได้ และทำยังไง").join("\n");
    const denied = block(section, "ทำเองไม่ได้").join("\n");
    expect(allowed).toContain("ลงผลรางวัล:");
    expect(allowed).toContain("ตรวจหลักฐาน:");
    expect(allowed).toContain("เปิดงวดและตั้งเลขอั้น:");
    expect(allowed).toContain("ลบบิลก่อนปิดรับ:");
    expect(allowed).not.toContain("ปิดบัญชีงวด:");
    expect(denied).toContain("ปิดบัญชีงวด (Owner ทำ)");
    expect(denied).toContain("อนุมัติการแก้ผลรางวัล (Owner ทำ)");
    expect(denied).toContain("สร้าง ลบ หรือตั้งรหัสผ่านให้บัญชีผู้ใช้ (Owner ทำ)");
    // ตรงกับ Permission Matrix
    expect(can("ADMIN", "settlement.approve")).toBe(false);
    expect(can("ADMIN", "result.approveCorrection")).toBe(false);
    expect(can("ADMIN", "user.manage")).toBe(false);
  });

  test("Agent รับบิล แนบหลักฐาน และลบบิลของตัวเองก่อนปิดรับได้เท่านั้น", () => {
    const section = roleSection("agent");
    const allowed = block(section, "ทำอะไรได้ และทำยังไง").join("\n");
    expect(allowed).toContain("รับบิล:");
    expect(allowed).toContain("แนบหลักฐาน:");
    expect(allowed).toContain("ลบบิลก่อนปิดรับ:");
    expect(allowed).toContain("Agent ลบได้เฉพาะบิลของตัวเอง");
    for (const forbidden of ["ลงผลรางวัล:", "ตรวจหลักฐาน:", "ปิดบัญชีงวด:", "เปิดงวดและตั้งเลขอั้น:"]) {
      expect(allowed).not.toContain(forbidden);
    }
    // เฉพาะเรื่องที่ Agent น่าจะลองทำ ไม่รกด้วยงานอนุมัติที่ไม่เกี่ยวกับ Agent
    expect(block(section, "ทำเองไม่ได้")).toEqual([
      "• เปิดงวด ตั้งเลขอั้น หรือสั่งปิดรับ (Owner หรือ Admin ทำ)",
      "• ยืนยันหรือตีกลับหลักฐาน (Owner หรือ Admin ทำ)",
      "• ลงผลรางวัล (Owner หรือ Admin ทำ)",
    ]);
    expect(block(section, "ข้อควรรู้")).toContain("• ค่าคอมมิชชันคิด 30% จากยอดขายรวม");
  });

  test("Owner ไม่มีหัวข้อ \"ทำเองไม่ได้\" เพราะมีสิทธิ์ครบทุกข้อในคู่มือ", () => {
    expect(roleSection("owner")).not.toContain("ทำเองไม่ได้");
  });

  test("ความสามารถทุกข้อของทุกบทบาทตรงกับ can() — ไม่มีข้อที่อ้างเกินสิทธิ์จริง", () => {
    const pairs: [Role, string, Parameters<typeof can>[1]][] = [
      ["AGENT", "รับบิล:", "bill.create"],
      ["AGENT", "ลงผลรางวัล:", "result.enter"],
      ["ADMIN", "คำนวณการเงินของงวด:", "settlement.calculate"],
      ["OWNER", "จัดการบัญชีผู้ใช้:", "user.manage"],
      ["OWNER", "ปิดบัญชีงวด:", "settlement.approve"],
    ];
    for (const [role, title, permission] of pairs) {
      const topic = role.toLowerCase() as "owner" | "admin" | "agent";
      // จับทั้งบรรทัด "1. ชื่อข้อ:" เพื่อไม่ให้ "ยกเลิกบิล…" ไปตรงกับ "เสนอยกเลิกบิล…"
      const allowed = block(roleSection(topic), "ทำอะไรได้ และทำยังไง");
      const listed = allowed.some((line) => new RegExp(`^\\d+\\. ${title}`).test(line));
      expect(listed, `${role} ${title}`).toBe(can(role, permission));
    }
  });
});

/** อ่านซอร์สของหน้าจอทั้งหมด ใช้ยืนยันว่าชื่อปุ่มและเมนูที่คู่มืออ้างมีอยู่จริง */
function sourceText(): string {
  const roots = [join(process.cwd(), "src", "app"), join(process.cwd(), "src", "lib")];
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|css)$/.test(name) && !name.includes(".test.") && !path.includes("system-guide")) parts.push(readFileSync(path, "utf8"));
    }
  };
  roots.forEach(walk);
  return parts.join("\n");
}

describe("ชื่อปุ่มและเมนูในคู่มือมีอยู่จริงบนหน้าจอ", () => {
  const source = sourceText();
  // ทุกข้อความที่อยู่ในเครื่องหมายคำพูดในคู่มือคือชื่อปุ่ม เมนู หรือป้ายบนหน้าจอที่ผู้ใช้ต้องไปหา
  const quoted = [...new Set([...`${fullGuide()}\n${workflowSection()}`.matchAll(/"([^"\n]{2,60})"/g)].map((match) => match[1]!))];

  test("พบชื่อที่อ้างในคู่มือ", () => {
    expect(quoted.length).toBeGreaterThan(15);
  });

  test.each(quoted)("\"%s\" มีอยู่ในหน้าจอจริง", (label) => {
    expect(source.includes(label)).toBe(true);
  });

  test("ไม่บอกให้กดปุ่มที่ไม่มีหน้าจอรองรับ", () => {
    // การตรวจสอบยอดราย Agent มีในระบบหลังบ้าน แต่ยังไม่มีปุ่มบนหน้าจอ
    expect(fullGuide()).not.toContain("กด \"ตรวจสอบยอด\"");
  });

  test("ทุกเมนูในระบบมีคำอธิบายในคู่มือ", () => {
    const guide = fullGuide();
    for (const item of MENU_ITEMS) expect(guide).toContain(`${item.label} — `);
  });
});

describe("แยกคำถามวิธีใช้งานออกจากคำถามข้อมูล", () => {
  test.each([
    "ปิดงวดยังไง",
    "Agent ยกเลิกบิลเองได้ไหม",
    "ลงผลรางวัลตรงไหน",
    "Admin ทำอะไรได้บ้าง",
    "เลขอั้นกับเลขเต็มต่างกันยังไง",
    "สร้างบัญชีตัวแทนใหม่ ทำไง",
    "ใครเป็นคนอนุมัติแก้ผลรางวัล",
  ])("\"%s\" เป็นคำถามวิธีใช้งาน", (question) => {
    expect(isHowToQuestion(question)).toBe(true);
  });

  test.each([
    "ยอดขายงวดนี้เท่าไหร่",
    "งวดไหนกำไรมากสุด",
    "Agent คนไหนขายดี",
    "มีลูกค้าถูกรางวัลกี่คน",
    "เลขไหนเสี่ยงสุด",
    "ปิดรับเมื่อไร",
    "สรุปรอบล่าสุดให้หน่อย",
    // มีทั้งคำถามวิธีใช้และตัวเลข ให้ไปทางข้อมูล ซึ่งยังแนบคู่มือไปด้วย
    "ดูยอดขายของ Agent ได้ที่เมนูไหน และตอนนี้ยอดเท่าไหร่",
  ])("\"%s\" เป็นคำถามข้อมูล ตอบจากข้อมูลจริง", (question) => {
    expect(isHowToQuestion(question)).toBe(false);
  });
});

describe("คำถามที่พบบ่อย", () => {
  test("ระบุข้อเท็จจริงที่ผู้ช่วยเคยเดาผิด", () => {
    const faq = faqSection();
    expect(faq).toContain("ค่าคอมมิชชันของ Agent คิด 30% จากยอดขายรวม เท่ากันทุกคน ระบบยังไม่มีหน้าจอให้ตั้งค่าคอมรายคน");
    expect(faq).toContain("หลังสร้างแล้วยังไม่มีหน้าจอแก้เวลา");
    expect(faq).toContain("Agent เห็นเมนู \"งวด\"");
    expect(fullGuide()).toContain("■ คำถามที่พบบ่อย");
  });
});

describe("ตอบคำถามวิธีใช้แบบยกข้อความจากคู่มือ", () => {
  const entries = guideEntries();

  test("รหัสหัวข้อไม่ซ้ำ และทุกหัวข้อมีเนื้อหา", () => {
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    for (const entry of entries) expect(entry.text.trim().length).toBeGreaterThan(entry.title.length);
  });

  test("บรรทัด \"ใครทำได้\" ตรงกับ Permission Matrix ทุกหัวข้อ", () => {
    const labels = { OWNER: "Owner", ADMIN: "Admin", AGENT: "Agent" } as const;
    for (const entry of entries.filter((item) => item.id.startsWith("cap:"))) {
      const permission = entry.id.slice(4) as Parameters<typeof can>[1];
      const allowed = (["OWNER", "ADMIN", "AGENT"] as const).filter((role) => can(role, permission)).map((role) => labels[role]);
      expect(entry.text.split("\n")[1], entry.id).toMatch(new RegExp(`^ใครทำได้: ${allowed.join(", ")}( ·|$)`));
    }
  });

  test("อ่านรหัสจาก JSON ปกติ JSON ที่มีข้อความห่อ และรหัสที่ไม่มีอยู่จริงถูกตัดทิ้ง", () => {
    expect(parseGuideSelection('{"ids":["faq:5","cap:user.manage"]}')).toEqual(["faq:5", "cap:user.manage"]);
    expect(parseGuideSelection('ได้ครับ ```json\n{"ids":["role:admin"]}\n```')).toEqual(["role:admin"]);
    expect(parseGuideSelection('{"ids":["cap:made.up","faq:999","workflow"]}')).toEqual(["workflow"]);
    expect(parseGuideSelection("ตอบ faq:1 และ cap:settlement.approve")).toEqual(["faq:1", "cap:settlement.approve"]);
    // โมเดลตัดคำนำหน้าทิ้ง (พบจากการทดสอบจริง) ยังอ่านได้
    expect(parseGuideSelection('{"ids":["result.proposeCorrection","evidence.upload"]}')).toEqual(["cap:result.proposeCorrection", "cap:evidence.upload"]);
    expect(parseGuideSelection('{"ids":[]}')).toEqual([]);
    expect(parseGuideSelection("ไม่รู้")).toEqual([]);
  });

  test("คำตอบคือข้อความในคู่มือทุกตัวอักษร", () => {
    const answer = renderGuideAnswer(["faq:5"]);
    const entry = entries.find((item) => item.id === "faq:5")!;
    expect(answer).toContain(entry.text);
    expect(answer).toContain("Admin ทำแทนไม่ได้ และระบบไม่มีการส่งรหัสทางอีเมล");
  });

  test("หัวข้อสั้นแสดงได้ไม่เกิน 3 หัวข้อ และหัวข้อยาวแสดงเดี่ยว ๆ", () => {
    const short = renderGuideAnswer(["faq:1", "faq:2", "faq:3", "faq:4"]);
    expect(short).toContain("■ ปิดงวดยังไง");
    expect(short).not.toContain("■ ค่าคอมมิชชันของ Agent");
    expect(renderGuideAnswer(["role:admin", "faq:1"])).not.toContain("■ ปิดงวดยังไง");
    expect(renderGuideAnswer(["faq:1", "role:admin"])).not.toContain("■ Admin (ผู้ดูแลงานประจำวัน)");
  });

  test("ไม่มีหัวข้อที่ตอบได้ → บอกตรง ๆ ว่าคู่มือยังไม่มี ไม่เดา", () => {
    expect(renderGuideAnswer([]).startsWith("ในคู่มือยังไม่มีเรื่องนี้ครับ")).toBe(true);
  });

  test("ชื่อปุ่มและเมนูในทุกหัวข้อมีอยู่จริงบนหน้าจอ", () => {
    const source = sourceText();
    const quoted = new Set(entries.flatMap((entry) => [...entry.text.matchAll(/"([^"\n]{2,60})"/g)].map((match) => match[1]!)));
    for (const label of quoted) expect(source.includes(label), label).toBe(true);
  });
});
