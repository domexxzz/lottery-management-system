import type { Role } from "@prisma/client";
import { can, type Permission } from "@/lib/auth/permissions";
import { MENU_ITEMS, menuFor } from "@/lib/navigation";

/**
 * คู่มือการใช้งานระบบสำหรับผู้ช่วย AI
 *
 * หลักการออกแบบ
 * 1. ความถูกต้องมาก่อน: "ใครทำอะไรได้" สร้างจาก Permission Matrix (permissions.ts)
 *    และ "ใครเห็นเมนูไหน" สร้างจากรายการเมนู (navigation.ts) ซึ่งเป็นแหล่งเดียวกับที่ระบบใช้บังคับสิทธิ์จริง
 *    ถ้าวันหนึ่งสิทธิ์หรือเมนูเปลี่ยน คู่มือจะเปลี่ยนตามเองโดยไม่ต้องแก้ข้อความ
 * 2. คำตอบแนะนำระบบเป็นข้อความตายตัว ไม่ผ่านโมเดล จึงไม่มีทางแต่งเมนูหรือปุ่มที่ไม่มีอยู่จริง
 *    และใช้ได้แม้ยังไม่ได้ตั้งค่าคีย์ของผู้ช่วย
 * 3. คำถามวิธีใช้แบบพิมพ์เอง (เช่น "ปิดงวดยังไง") ส่งคู่มือฉบับเดียวกันให้โมเดลเป็นแหล่งอ้างอิง
 *
 * หน้าจอแสดงข้อความดิบ (white-space: pre-wrap) จึงใช้การขึ้นบรรทัด • และตัวเลขข้อ ไม่ใช้ Markdown
 */

export type GuideTopic = "owner" | "admin" | "agent" | "workflow";
export type GuideReply = { reply: string; suggestions: string[] };

/** ข้อความบนปุ่มลัดและคำที่ส่งเมื่อกด */
export const GUIDE_TRIGGER = "แนะนำระบบ";
/** ประโยคแรกของเมนูคู่มือ ใช้จำว่าข้อความก่อนหน้าคือคำถาม "อยากให้อธิบายตรงไหน" */
export const GUIDE_MENU_QUESTION = "อยากให้อธิบายตรงไหนเพิ่มครับ หรือว่าทั้งหมดเลย";

/** ปุ่มเลือกหัวข้อ — ข้อความบนปุ่มคือข้อความที่ส่งจริง จึงจับคู่ได้แน่นอนเสมอ */
const TOPIC_CHIPS: { label: string; topics: GuideTopic[] }[] = [
  { label: "อธิบายทั้งหมด", topics: ["owner", "admin", "agent", "workflow"] },
  { label: "ส่วนของ Owner", topics: ["owner"] },
  { label: "ส่วนของ Admin", topics: ["admin"] },
  { label: "ส่วนของ Agent", topics: ["agent"] },
  { label: "ขั้นตอนเปิดงวดถึงปิดงวด", topics: ["workflow"] },
];

const ROLE_OF: Record<Exclude<GuideTopic, "workflow">, Role> = { owner: "OWNER", admin: "ADMIN", agent: "AGENT" };

const ROLE_TITLE: Record<Exclude<GuideTopic, "workflow">, string> = {
  owner: "Owner (เจ้าของกิจการ)",
  admin: "Admin (ผู้ดูแลงานประจำวัน)",
  agent: "Agent (ตัวแทนขาย)",
};

const ROLE_SUMMARY: Record<Exclude<GuideTopic, "workflow">, string> = {
  owner: "เห็นข้อมูลทุกอย่างในระบบ และเป็นคนตัดสินใจขั้นสุดท้ายเรื่องเงิน เช่น อนุมัติการแก้ผลรางวัลและปิดบัญชีงวด",
  admin: "ทำงานประจำวันแทน Owner ตั้งแต่เปิดงวด ตรวจหลักฐาน ลงผลรางวัล จนคำนวณการเงิน แต่เรื่องที่กระทบเงินที่ประกาศไปแล้วต้องให้ Owner อนุมัติ",
  agent: "รับบิลจากลูกค้าและดูบิลของตัวเอง เห็นเฉพาะข้อมูลของตัวเองเท่านั้น ไม่เห็นของ Agent คนอื่น",
};

/** คำอธิบายเมนู เรียงตามรายการเมนูจริง — เมนูที่ไม่มีคำอธิบายจะแสดงแค่ชื่อ */
const MENU_HELP: Record<string, string> = {
  "/": "สรุปยอดขาย จ่ายรางวัล คอม และยอดสุทธิ งานที่รอทำ และ Agent ขายดี 5 อันดับแรก กรองตามงวด เดือน หรือช่วงวันที่ได้",
  "/bills": "รายการบิลของงวดปัจจุบันเป็นค่าเริ่มต้น สลับดูงวดย้อนหลังหรือทุกงวดได้ กดเข้าไปดูรายละเอียด พิมพ์บิล หรือพิมพ์สลิป",
  "/draws": "รายการงวดทั้งหมด เปิดเข้าไปดูรายละเอียดและผลรางวัลของงวดนั้น",
  "/reports": "รายงานยอดขายและผลงานรายงวด ดาวน์โหลดเป็นไฟล์ได้",
  "/evidence": "คิวหลักฐานที่ Agent แนบมา รอยืนยันหรือตีกลับ",
  "/audit": "ประวัติว่าใครบันทึก แก้ไข หรืออนุมัติอะไร เมื่อไร ใช้ตรวจย้อนหลัง",
  "/analytics": "ดูพฤติกรรมลูกค้า เลขที่คนซื้อเยอะ และแนวโน้มยอดขาย",
  "/chat": "ถามยอดขาย งานค้าง หรือวิธีใช้ระบบได้ด้วยภาษาพูด",
  "/messages": "ส่งข้อความคุยกันภายในทีม",
  "/prize-types": "ประเภทรางวัลและอัตราจ่ายที่ใช้คิดเงิน",
  "/agents": "ผลงานของ Agent ทุกคน ดูแบบการ์ดหรือตาราง มีคีย์ลัดวันนี้ งวดนี้ เดือนนี้ และกดดูโปรไฟล์รายคนได้",
  "/users": "สร้างบัญชี Admin และ Agent ตั้งรหัสผ่านใหม่ ระงับสิทธิ์ หรือลบบัญชี",
};

/**
 * ความสามารถที่ผูกกับสิทธิ์จริงในระบบ
 *
 * แต่ละข้อแสดงเฉพาะบทบาทที่มีสิทธิ์นั้นจริง (ตาม can()) ข้อที่ไม่มีสิทธิ์จะไปอยู่ในหัวข้อ "ทำไม่ได้"
 * when: ระบุเพิ่มเมื่อสิทธิ์เดียวกันมีเงื่อนไขต่างกันตามบทบาท
 */
type Capability = {
  permission: Permission;
  title: string;
  how: string;
  /** ข้อความในหัวข้อ "ทำเองไม่ได้" ของบทบาทที่ไม่มีสิทธิ์ */
  denied?: string;
  /**
   * แสดงในหัวข้อ "ทำเองไม่ได้" เฉพาะบทบาทที่มีสิทธิ์นี้
   * กันข้อที่ไม่เกี่ยวกับงานของบทบาทนั้น เช่น ไม่ต้องบอก Agent ว่าอนุมัติคำขอยกเลิกไม่ได้ ในเมื่อเสนอเองก็ไม่ได้
   */
  deniedOnlyIf?: Permission;
  when?: (role: Role) => string | null;
};

const CAPABILITIES: Capability[] = [
  {
    permission: "user.manage",
    title: "จัดการบัญชีผู้ใช้",
    how: "เมนู \"จัดการผู้ใช้งาน\" → สร้างบัญชี Agent หรือ Admin บัญชี Agent ระบบตั้งชื่อผู้ใช้และรหัส Agent ให้อัตโนมัติเรียง A1, A2, A3 … ใส่แค่ชื่อที่แสดงกับรหัสผ่าน (ตั้งอะไรก็ได้) ลืมรหัสผ่านก็กด \"ตั้งรหัสผ่านใหม่\" ได้ทุกเมื่อ และระงับสิทธิ์หรือลบบัญชีได้จากหน้าเดียวกัน",
    denied: "สร้าง ลบ หรือตั้งรหัสผ่านให้บัญชีผู้ใช้ (Owner ทำ)",
    deniedOnlyIf: "report.viewAllAgents",
  },
  {
    permission: "draw.manage",
    title: "เปิดงวดและตั้งเลขอั้น",
    how: "เมนู \"งวด\" → สร้างงวด เลือกวันออกรางวัลได้เฉพาะวันที่ 1 หรือ 16 ระบบเสนอเวลาให้ (เปิดรับก่อนวันงวด 5 วัน ปิดรับก่อนวันงวด 1 วัน เวลา 14:00 น.) ปรับเวลาเองได้ตอนสร้าง (แก้ได้ก่อนกดยืนยันเท่านั้น) ในหน้างวดตั้งเลขเต็ม (ไม่รับเลขนั้น) หรือเลขอั้น (รับแต่จ่ายอัตราลดลง) ได้ และถ้าต้องการหยุดรับบิลก่อนเวลา กด \"ปิดงวดตอนนี้\" ในหน้ารายการงวด",
    denied: "เปิดงวด ตั้งเลขอั้น หรือสั่งปิดรับ (Owner หรือ Admin ทำ)",
  },
  {
    permission: "bill.create",
    title: "รับบิล",
    how: "เมนู \"รายการบิล\" → \"สร้างบิลใหม่\" → เลือกงวด ใส่ชื่อลูกค้า เลือกประเภท ใส่เลขและยอดแทง แล้วกด \"ยืนยันบิล\" ระบบออกเลขบิลให้ทันที (นับแยกราย Agent ต่อเดือน) ถ้าเลขติดเลขเต็มระบบจะไม่รับ ถ้าติดเลขอั้นจะจ่ายตามอัตราที่ลดลง",
    when: (role) => (role === "AGENT" ? "Agent รับบิลในชื่อของตัวเอง" : "Owner และ Admin เลือกได้ว่ารับบิลในชื่อ Agent คนไหน"),
  },
  {
    permission: "evidence.upload",
    title: "แนบหลักฐาน",
    how: "ตอนสร้างบิลกด \"แนบหลักฐาน\" เช่น รูปโพยหรือสลิปโอนเงิน ถ้าหลักฐานถูกตีกลับ ให้เปิดบิล → กด \"เปลี่ยนไฟล์\" เลือกไฟล์ใหม่ → กด \"ส่งหลักฐานที่แก้ไขแล้วเข้าตรวจใหม่\"",
  },
  {
    permission: "bill.editBeforeCutoff",
    title: "ยกเลิกบิลก่อนปิดรับ",
    how: "เปิดบิล (กด \"ดูรายละเอียด\") → ใส่เหตุผล → กด \"ยกเลิกบิล\" ทำได้จนถึงเวลาปิดรับของงวด",
    when: (role) => (role === "AGENT" ? "Agent ยกเลิกได้เฉพาะบิลของตัวเอง" : null),
  },
  {
    permission: "evidence.review",
    title: "ตรวจหลักฐาน",
    how: "เมนู \"ตรวจหลักฐาน\" → เปิดดูรูปที่ Agent แนบ แล้วกดยืนยัน หรือตีกลับพร้อมเหตุผลให้ Agent แก้",
    denied: "ยืนยันหรือตีกลับหลักฐาน (Owner หรือ Admin ทำ)",
  },
  {
    permission: "bill.proposeChangeAfterCutoff",
    title: "เสนอยกเลิกบิลหลังปิดรับ",
    how: "หลังปิดรับแล้วยกเลิกบิลเองไม่ได้ ให้เปิดบิล → ใส่เหตุผล → กด \"เสนอยกเลิกให้ผู้มีอำนาจอนุมัติ\" แล้วรอ Owner อนุมัติ",
    denied: "ยกเลิกบิลหลังปิดรับ (ต้องแจ้ง Admin หรือ Owner)",
  },
  {
    permission: "bill.approveChangeAfterCutoff",
    title: "ยกเลิกบิลหลังปิดรับ",
    how: "เปิดบิลที่ปิดรับแล้ว → ใส่เหตุผล → กด \"อนุมัติและยกเลิกบิล\" ใช้ได้ทั้งบิลที่ Admin เสนอมา (ดูจำนวนคำขอได้ที่การ์ด \"คำขอแก้ไข\" หน้าภาพรวม) และยกเลิกเองโดยตรง ถ้าเป็นคนเสนอเองจะอนุมัติเองไม่ได้ ส่วนบิลที่คำนวณผลแล้วยกเลิกไม่ได้",
    denied: "อนุมัติการยกเลิกบิลหลังปิดรับ (Owner ทำ)",
    deniedOnlyIf: "bill.proposeChangeAfterCutoff",
  },
  {
    permission: "result.enter",
    title: "ลงผลรางวัล",
    how: "เมนู \"งวด\" → เปิดงวดที่ปิดรับแล้ว → กรอกผลเอง หรือกด \"ดึงผลจาก GLO\" ให้ระบบเติมให้ ตรวจให้ถูกทุกช่อง แล้วกด \"บันทึกผลทั้งหมดและคำนวณ\" ผลยืนยันทันที และเมื่อผลครบทุกรางวัล ระบบคำนวณการเงินต่อให้ในครั้งเดียว",
    denied: "ลงผลรางวัล (Owner หรือ Admin ทำ)",
  },
  {
    permission: "result.proposeCorrection",
    title: "เสนอแก้ผลรางวัลที่ประกาศแล้ว",
    how: "ในหน้างวด กด \"แก้ผลที่ประกาศแล้ว\" ใส่ผลที่ถูกและเหตุผล แล้วกด \"ส่งคำขอแก้ผล\" ผลเดิมยังใช้อยู่จนกว่าจะมีคนอนุมัติ",
  },
  {
    permission: "result.approveCorrection",
    title: "อนุมัติการแก้ผลรางวัล",
    how: "ในหน้างวด รายการที่ขึ้นว่า \"รออนุมัติการแก้ผล\" กด \"อนุมัติผล\" หรือ \"ตีกลับ\" คนเสนอกับคนอนุมัติต้องไม่ใช่คนเดียวกัน อนุมัติแล้วระบบคำนวณการเงินใหม่ให้อัตโนมัติ",
    denied: "อนุมัติการแก้ผลรางวัล (Owner ทำ)",
    deniedOnlyIf: "result.enter",
  },
  {
    permission: "settlement.calculate",
    title: "คำนวณการเงินของงวด",
    how: "ปกติไม่ต้องกด ระบบคำนวณให้ทันทีเมื่อบันทึกผลครบ ถ้าต้องการคำนวณซ้ำ กด \"คำนวณใหม่\" ในส่วนสรุปการเงิน ผลลัพธ์เท่าเดิมเสมอเพราะใช้อัตราจ่ายที่ล็อกไว้ตอนยืนยันบิล",
    denied: "คำนวณการเงินของงวด (Owner หรือ Admin ทำ)",
    deniedOnlyIf: "result.enter",
  },
  {
    permission: "settlement.approve",
    title: "ปิดบัญชีงวด",
    how: "หลังคำนวณแล้ว ดูสรุปการเงินในหน้างวดให้ถูกต้อง แล้วกด \"อนุมัติและปิดบัญชีงวด\" เมื่อปิดแล้วงวดนั้นแก้ไขอะไรไม่ได้อีก",
    denied: "ปิดบัญชีงวด (Owner ทำ)",
    deniedOnlyIf: "result.enter",
  },
];

const ROLE_EXTRA: Partial<Record<Exclude<GuideTopic, "workflow">, string[]>> = {
  agent: [
    "เข้าระบบมาจะเจอหน้ารายการบิลของงวดปัจจุบันทันที",
    "ดูได้ว่าแต่ละบิลถูกหรือไม่ถูกรางวัล ยอดได้เสีย และพิมพ์บิลหรือพิมพ์สลิปให้ลูกค้าได้",
    "ประกาศเลขอั้นและเลขเต็มของงวดจะขึ้นให้เห็นบนหน้ารายการบิล",
    "ค่าคอมมิชชันคิด 30% จากยอดขายรวม",
  ],
};

function bullet(text: string): string {
  return `• ${text}`;
}

/** ส่วนอธิบายบทบาทหนึ่ง: ภาพรวม เมนูที่เห็น สิ่งที่ทำได้และวิธีทำ และสิ่งที่ต้องให้คนอื่นทำ */
export function roleSection(topic: Exclude<GuideTopic, "workflow">): string {
  const role = ROLE_OF[topic];
  const menus = menuFor(role);
  const allowed = CAPABILITIES.filter((capability) => can(role, capability.permission));
  const denied = CAPABILITIES.filter(
    (capability) =>
      !can(role, capability.permission) &&
      capability.denied &&
      (!capability.deniedOnlyIf || can(role, capability.deniedOnlyIf)),
  );
  const extra = ROLE_EXTRA[topic] ?? [];

  const lines = [
    `■ ${ROLE_TITLE[topic]}`,
    ROLE_SUMMARY[topic],
    "",
    "เมนูที่เห็น",
    ...menus.map((menu) => bullet(MENU_HELP[menu.href] ? `${menu.label} — ${MENU_HELP[menu.href]}` : menu.label)),
    "",
    "ทำอะไรได้ และทำยังไง",
    ...allowed.map((capability, index) => {
      const note = capability.when?.(role);
      return `${index + 1}. ${capability.title}: ${capability.how}${note ? ` (${note})` : ""}`;
    }),
  ];
  if (extra.length > 0) lines.push("", "ข้อควรรู้", ...extra.map(bullet));
  if (denied.length > 0) {
    lines.push("", "ทำเองไม่ได้", ...denied.map((capability) => bullet(capability.denied!)));
  }
  return lines.join("\n");
}

/** กระบวนการทำงานของหนึ่งงวด ตั้งแต่เปิดจนปิดบัญชี */
export function workflowSection(): string {
  return [
    "■ กระบวนการทำงาน ตั้งแต่เปิดงวดจนปิดงวด",
    "1. เปิดงวด (Owner หรือ Admin): เมนู \"งวด\" เลือกวันที่ 1 หรือ 16 ระบบตั้งเวลาเปิดรับและปิดรับให้",
    "2. ตั้งเลขอั้น เลขเต็ม (ถ้ามี): ประกาศให้ Agent เห็นบนหน้ารายการบิลทันที และมีผลกับทั้งบิลเดิมและบิลใหม่ของงวด",
    "3. รับบิล (Agent, Admin, Owner): ช่วงเปิดรับ กด \"สร้างบิลใหม่\" แล้วยืนยันบิล บิลที่ยืนยันแล้วยังกด \"ยกเลิกบิล\" ได้ถ้ายังไม่ถึงเวลาปิดรับ",
    "4. ตรวจหลักฐาน (Admin หรือ Owner): ยืนยัน หรือตีกลับให้ Agent แก้",
    "5. ปิดรับ: ระบบปิดให้อัตโนมัติเมื่อถึงเวลา หรือ Owner/Admin กด \"ปิดงวดตอนนี้\" ในหน้ารายการงวดเพื่อปิดก่อนเวลา บิลทั้งหมดถูกล็อก หลังจากนี้ Admin ยกเลิกเองไม่ได้ ต้องเสนอให้ Owner อนุมัติ",
    "6. ลงผลรางวัล (Admin หรือ Owner): กรอกเองหรือกด \"ดึงผลจาก GLO\" ตรวจให้ถูก แล้วกด \"บันทึกผลทั้งหมดและคำนวณ\"",
    "7. คำนวณการเงิน (อัตโนมัติ): เมื่อผลครบทุกรางวัล ระบบตัดสินว่าบิลไหนถูกหรือไม่ถูก และสรุปยอดขาย จ่ายรางวัล ค่าคอม และยอดสุทธิของแต่ละ Agent ให้ทันที",
    "8. ตรวจดูยอด (Admin หรือ Owner): ดูสรุปการเงินในหน้างวดว่ายอดของแต่ละ Agent ถูกต้อง ถ้าพบว่าผลรางวัลผิด ให้เสนอแก้ผล → Owner อนุมัติ → ระบบคำนวณใหม่ให้",
    "9. ปิดบัญชีงวด (Owner): กด \"อนุมัติและปิดบัญชีงวด\" ปิดแล้วแก้ไขไม่ได้อีก",
    "",
    "สถานะของงวด: เปิดรับ → ปิดรับ → กรอกผล → รอปิดบัญชี → ปิดบัญชีแล้ว",
    "สถานะของบิล: ยืนยันแล้ว → ปิดรับแล้ว → คำนวณแล้ว (ถูกรางวัล หรือ ไม่ถูกรางวัล) หรือ ยกเลิก",
    "หน้ารายการบิลนับงวดเป็น \"งวดปัจจุบัน\" ไปจนถึง 2 วันหลังวันออกรางวัล แล้วจึงย้ายไป \"งวดย้อนหลัง\"",
  ].join("\n");
}

/**
 * คำถามที่พบบ่อย: เรื่องที่คนมักเข้าใจผิด หรือที่ผู้ช่วยเคยเดาผิดตอนทดสอบ
 * ทุกข้อตรวจกับโค้ดจริงแล้ว เช่น ค่าคอมเป็นค่าคงที่ 30% ไม่มีหน้าจอให้ตั้งรายคน
 */
const FAQ_ITEMS: { title: string; text: string }[] = [
  {
    title: "ปิดงวดยังไง ปิดรับกับปิดบัญชีต่างกันยังไง",
    text: "\"ปิดงวด\" มี 2 แบบ: ปิดรับ คือหยุดรับบิล (ระบบปิดเองตามเวลา หรือ Owner/Admin กด \"ปิดงวดตอนนี้\" ในหน้ารายการงวด) และปิดบัญชี คือจบงวดหลังคำนวณเงินแล้ว (Owner กด \"อนุมัติและปิดบัญชีงวด\" ในหน้างวด)",
  },
  {
    title: "ตั้งหรือแก้เวลาเปิดรับ ปิดรับของงวด",
    text: "เวลาเปิดรับและปิดรับตั้งตอนสร้างงวด ระบบเสนอปิดรับ 14:00 น. ก่อนวันงวด 1 วันเป็นค่าเริ่มต้น เปลี่ยนได้ก่อนกดยืนยันสร้างงวด หลังสร้างแล้วยังไม่มีหน้าจอแก้เวลา ถ้าอยากปิดเร็วขึ้นให้กด \"ปิดงวดตอนนี้\"",
  },
  {
    title: "ตั้งเลขอั้น เลขเต็มตรงไหน ตอนไหน",
    text: "เลขอั้นและเลขเต็มตั้งในหน้ารายละเอียดงวด (เมนู \"งวด\" → เปิดงวดนั้น) หลังสร้างงวดแล้ว โดย Owner หรือ Admin เลขเต็มคือไม่รับเลขนั้นเลย เลขอั้นคือรับแต่จ่ายอัตราลดลง ประกาศจะขึ้นให้ Agent เห็นบนหน้ารายการบิลทันที",
  },
  {
    title: "ค่าคอมมิชชันของ Agent ตั้งรายคนได้ไหม",
    text: "ค่าคอมมิชชันของ Agent คิด 30% จากยอดขายรวม เท่ากันทุกคน ระบบยังไม่มีหน้าจอให้ตั้งค่าคอมรายคน",
  },
  {
    title: "ลืมรหัสผ่าน หรืออยากเปลี่ยนรหัสผ่านให้ผู้ใช้",
    text: "ผู้ใช้ที่ลืมรหัสผ่าน ให้ Owner เข้าเมนู \"จัดการผู้ใช้งาน\" แล้วกด \"ตั้งรหัสผ่านใหม่\" ที่แถวของบัญชีนั้น พิมพ์รหัสใหม่แล้วบันทึก จะเห็นรหัสทันทีพร้อมปุ่มคัดลอกไว้ส่งให้เจ้าของบัญชี Admin ทำแทนไม่ได้ และระบบไม่มีการส่งรหัสทางอีเมล",
  },
  {
    title: "อัตราจ่ายรางวัลดูที่ไหน",
    text: "อัตราจ่ายของแต่ละประเภทรางวัลดูได้ที่เมนู \"Rulebook รางวัล\" อัตราจ่ายของแต่ละบิลถูกล็อกไว้ตอนยืนยันบิล",
  },
  {
    title: "Agent ทำอะไรในเมนูงวดได้บ้าง",
    text: "Agent เห็นเมนู \"งวด\" และเปิดดูรายละเอียดงวดได้ แต่ลงผล ตั้งเลขอั้น หรือปิดงวดไม่ได้",
  },
  {
    title: "คำขอแก้ผลรางวัลดูที่ไหน การ์ดคำขอแก้ไขคืออะไร",
    text: "คำขอแก้ผลรางวัลดูได้ในหน้างวด ตรงรายการที่ขึ้นว่า \"รออนุมัติการแก้ผล\" ส่วนการ์ด \"คำขอแก้ไข\" ในหน้าภาพรวมนับคำขอยกเลิกบิลที่รอพิจารณา",
  },
  { title: "เลขบิลนับยังไง", text: "เลขบิลนับแยกราย Agent และเริ่มนับใหม่ทุกเดือน" },
  {
    title: "ลบบัญชีที่มีบิลแล้วเป็นยังไง",
    text: "ลบบัญชีที่มีบิลแล้ว ระบบจะซ่อนบัญชีและห้ามเข้าใช้ แต่บิลและรายงานเดิมยังอยู่ครบ",
  },
];

export function faqSection(): string {
  return ["■ คำถามที่พบบ่อย", ...FAQ_ITEMS.map((item) => bullet(item.text))].join("\n");
}

function sectionFor(topic: GuideTopic): string {
  return topic === "workflow" ? workflowSection() : roleSection(topic);
}

const ALL_INTRO = [
  "ระบบนี้มีผู้ใช้ 3 บทบาทหลัก คือ Owner, Admin และ Agent แต่ละคนเห็นเมนูและทำได้ไม่เท่ากัน ระบบตรวจสิทธิ์ทุกครั้งที่กด ไม่ใช่แค่ซ่อนปุ่ม",
  "(นอกจากนี้มี Godmode สำหรับผู้ดูแลระบบ ซึ่งทำได้ทุกอย่างเหมือน Owner)",
].join("\n");

/** คู่มือฉบับเต็ม: ใช้ทั้งตอบ "อธิบายทั้งหมด" และเป็นแหล่งอ้างอิงให้โมเดล */
export function fullGuide(): string {
  return [ALL_INTRO, sectionFor("owner"), sectionFor("admin"), sectionFor("agent"), sectionFor("workflow"), faqSection()].join("\n\n");
}

export function guideMenu(): GuideReply {
  return {
    reply: [
      GUIDE_MENU_QUESTION,
      "",
      "• ส่วนของ Owner — เจ้าของกิจการทำอะไรได้บ้าง",
      "• ส่วนของ Admin — งานประจำวันของผู้ดูแล",
      "• ส่วนของ Agent — การรับบิลของตัวแทน",
      "• ขั้นตอนเปิดงวดถึงปิดงวด — งานทั้งรอบเรียงตามลำดับ",
      "",
      "กดปุ่มด้านล่าง หรือพิมพ์ตอบมาได้เลยครับ",
    ].join("\n"),
    suggestions: TOPIC_CHIPS.map((chip) => chip.label),
  };
}

function topicReply(topics: GuideTopic[]): GuideReply {
  const all = topics.length === 4;
  const body = all ? fullGuide() : topics.map(sectionFor).join("\n\n");
  const closing = all
    ? "ถามต่อได้เลยครับ เช่น \"ปิดงวดยังไง\" หรือ \"Agent ยกเลิกบิลเองได้ไหม\""
    : "อยากให้อธิบายส่วนไหนต่อครับ";
  return {
    reply: `${body}\n\n${closing}`,
    suggestions: all ? [] : TOPIC_CHIPS.filter((chip) => !chip.topics.every((topic) => topics.includes(topic))).map((chip) => chip.label),
  };
}

/** ตัดช่องว่างและคำลงท้ายสุภาพ เพื่อจับคำสั่งสั้น ๆ ได้แม่น */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.!?…,"'“”]+/g, "")
    .replace(/(ครับผม|ครับ|ค่ะ|คะ|จ้า|จ้ะ|นะ|หน่อย|ด้วย)+$/u, "");
}

const MENU_TRIGGERS = new Set(
  ["แนะนำระบบ", "แนะนำการใช้งาน", "แนะนำการใช้งานระบบ", "สอนใช้ระบบ", "สอนใช้งานระบบ", "วิธีใช้ระบบ", "วิธีใช้งานระบบ", "คู่มือ", "คู่มือการใช้งาน", "คู่มือระบบ", "help"].map(normalize),
);

const TOPIC_WORDS: { topic: GuideTopic | "all"; words: string[] }[] = [
  { topic: "all", words: ["ทั้งหมด", "ทุกส่วน", "ทุกอย่าง", "ทุกเรื่อง", "all"] },
  { topic: "owner", words: ["owner", "โอนเนอร์", "เจ้าของ"] },
  { topic: "admin", words: ["admin", "แอดมิน", "แอดมิด"] },
  { topic: "agent", words: ["agent", "เอเจนต์", "เอเจนท์", "เอเย่นต์", "ตัวแทน"] },
  { topic: "workflow", words: ["กระบวนการ", "ขั้นตอน", "เปิดงวด", "ปิดงวด", "workflow", "flow", "โฟลว์"] },
];

/** หัวข้อจากคำตอบอิสระหลังเมนู เช่น "ทั้งหมดเลย" หรือ "owner กับ admin" */
function topicsFromReply(text: string): GuideTopic[] {
  const normalized = normalize(text);
  const found = TOPIC_WORDS.filter((entry) => entry.words.some((word) => normalized.includes(normalize(word)))).map((entry) => entry.topic);
  if (found.includes("all")) return ["owner", "admin", "agent", "workflow"];
  return (["owner", "admin", "agent", "workflow"] as const).filter((topic) => found.includes(topic));
}

/**
 * ตอบคำถามแนะนำระบบแบบตายตัว หรือคืน null ให้โมเดลตอบตามปกติ
 *
 * - "แนะนำระบบ" (หรือคำใกล้เคียง) → ถามกลับว่าอยากให้อธิบายตรงไหน
 * - กดปุ่มหัวข้อ → ตอบหัวข้อนั้นทันที
 * - ตอบอิสระหลังเมนู เช่น "ทั้งหมด", "ส่วน admin" → ตอบหัวข้อนั้น
 * - นอกนั้นเป็นคำถามทั่วไป ให้โมเดลตอบโดยใช้คู่มือเป็นแหล่งอ้างอิง
 */
export function resolveGuideTurn(messages: readonly { role: string; content: string }[]): GuideReply | null {
  const latest = messages.at(-1);
  if (!latest || latest.role !== "user") return null;
  const text = latest.content.trim();

  if (MENU_TRIGGERS.has(normalize(text))) return guideMenu();

  const chip = TOPIC_CHIPS.find((item) => item.label === text);
  if (chip) return topicReply(chip.topics);

  const previous = messages.at(-2);
  const afterMenu = previous?.role === "assistant" && previous.content.startsWith(GUIDE_MENU_QUESTION);
  // คำตอบหลังเมนูต้องสั้น ถ้ายาวคือผู้ใช้ถามเรื่องอื่นต่อ ให้โมเดลตอบ
  if (afterMenu && normalize(text).length <= 40) {
    const topics = topicsFromReply(text);
    if (topics.length > 0) return topicReply(topics);
  }
  return null;
}

/** คำที่บอกว่าเป็นคำถามวิธีใช้งานหรือเรื่องสิทธิ์ */
const HOW_TO_PATTERN = /(ยังไง|ยังงัย|อย่างไร|ทำไง|ทำงัย|วิธี|ขั้นตอน|ตรงไหน|ที่ไหน|ปุ่ม|เมนู|ได้ไหม|ได้มั้ย|ได้มั๊ย|ได้หรือเปล่า|ได้รึเปล่า|ได้หรือไม่|ทำอะไรได้|สิทธิ์|ใครเป็นคน|ใครทำ|ต่างกัน|คืออะไร|หมายถึงอะไร|ใช้งาน)/;
/** คำที่บอกว่าถามตัวเลขหรือข้อมูลธุรกิจ ซึ่งต้องตอบจากข้อมูลจริง ไม่ใช่จากคู่มือ */
const DATA_PATTERN = /(ยอด|กำไร|ขาดทุน|เท่าไหร่|เท่าไร|กี่คน|กี่ใบ|กี่บิล|กี่รายการ|กี่บาท|กี่งวด|เปอร์เซ็นต์|ใครถูก|ถูกกี่|ขายดี|เลขไหน|ลูกค้าคนไหน|ลูกค้ากี่|สรุป|แนวโน้ม|ความเสี่ยง|เสี่ยง|งานค้าง|รออนุมัติกี่|เหลือเวลา|เมื่อไร|เมื่อไหร่)/;

/**
 * แยกคำถามวิธีใช้งานออกจากคำถามข้อมูล
 *
 * คำถามวิธีใช้งานตอบด้วยคู่มืออย่างเดียว ไม่ปนข้อมูลธุรกิจ เพราะทดสอบกับโมเดลจริงแล้วพบว่า
 * เมื่อบริบทมีข้อมูลเยอะ โมเดลมักเติมปุ่ม ช่องกรอก หรือขั้นตอนที่ไม่มีอยู่จริง
 * ถ้าคำถามมีทั้งสองแบบ ให้ถือเป็นคำถามข้อมูล (ทางเดิม ซึ่งยังแนบคู่มือไปด้วย)
 */
export function isHowToQuestion(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  return HOW_TO_PATTERN.test(normalized) && !DATA_PATTERN.test(normalized);
}

/* ------------------------------------------------------------------ ตอบคำถามวิธีใช้แบบยกจากคู่มือ */

/**
 * หนึ่งหัวข้อในคู่มือที่ยกไปตอบได้ทั้งก้อน
 *
 * ทดสอบกับโมเดลจริงแล้วพบว่า แม้สั่งให้ตอบจากคู่มือเท่านั้นและตั้ง temperature ต่ำ
 * โมเดลยังแต่งเรื่องเอง เช่น "ระบบส่งลิงก์รีเซ็ตรหัสผ่านทางอีเมล" หรือ "Admin ตั้งรหัสผ่านใหม่ได้"
 * คำตอบวิธีใช้จึงให้โมเดลทำแค่ "เลือกหัวข้อ" แล้วระบบยกข้อความในคู่มือมาตอบตรง ๆ
 * โมเดลจึงไม่มีโอกาสเขียนข้อเท็จจริงที่ผิดได้เลย
 */
export type GuideEntry = { id: string; title: string; text: string; long?: boolean };

const ROLE_LABEL: Record<"OWNER" | "ADMIN" | "AGENT", string> = { OWNER: "Owner", ADMIN: "Admin", AGENT: "Agent" };
const GUIDE_ROLES = ["OWNER", "ADMIN", "AGENT"] as const;

export function guideEntries(): GuideEntry[] {
  const capabilities = CAPABILITIES.map((capability) => {
    const allowed = GUIDE_ROLES.filter((role) => can(role, capability.permission));
    const denied = GUIDE_ROLES.filter((role) => !can(role, capability.permission));
    const notes = allowed.map((role) => capability.when?.(role)).filter((note): note is string => Boolean(note));
    return {
      id: `cap:${capability.permission}`,
      title: capability.title,
      text: [
        `■ ${capability.title}`,
        `ใครทำได้: ${allowed.map((role) => ROLE_LABEL[role]).join(", ")}${denied.length ? ` · ทำไม่ได้: ${denied.map((role) => ROLE_LABEL[role]).join(", ")}` : ""}`,
        `วิธีทำ: ${capability.how}`,
        ...[...new Set(notes)].map(bullet),
      ].join("\n"),
    };
  });
  const faqs = FAQ_ITEMS.map((item, index) => ({ id: `faq:${index + 1}`, title: item.title, text: `■ ${item.title}\n${item.text}` }));
  const menus = MENU_ITEMS.filter((item) => MENU_HELP[item.href]).map((item) => {
    const who = GUIDE_ROLES.filter((role) => item.roles.includes(role)).map((role) => ROLE_LABEL[role]);
    return {
      id: `menu:${item.href}`,
      title: `เมนู "${item.label}" มีอะไร ใครเห็น`,
      text: `■ เมนู "${item.label}"\nใครเห็น: ${who.join(", ")}\n${MENU_HELP[item.href]}`,
    };
  });
  const roles = (["owner", "admin", "agent"] as const).map((topic) => ({
    id: `role:${topic}`,
    title: `${ROLE_TITLE[topic]} ทำอะไรได้บ้าง (ภาพรวมทั้งบทบาท)`,
    text: roleSection(topic),
    long: true,
  }));
  return [
    ...capabilities,
    ...faqs,
    ...menus,
    ...roles,
    { id: "workflow", title: "ขั้นตอนทั้งหมดตั้งแต่เปิดงวด รับบิล ปิดรับ ลงผล จนปิดบัญชีงวด", text: workflowSection(), long: true },
  ];
}

/** รายการหัวข้อให้โมเดลเลือก: รหัส ชื่อหัวข้อ และตัวอย่างเนื้อหาสั้น ๆ */
export function guideEntryCatalog(): string {
  return guideEntries()
    .map((entry) => {
      const preview = entry.long ? "" : ` — ${entry.text.split("\n").slice(1).join(" ").slice(0, 140)}`;
      return `${entry.id} | ${entry.title}${preview}`;
    })
    .join("\n");
}

/** อ่านรหัสหัวข้อจากคำตอบของโมเดล ทนต่อข้อความเกินมาหรือ JSON ที่ห่อด้วยข้อความอื่น */
export function parseGuideSelection(raw: string): string[] {
  const known = new Set(guideEntries().map((entry) => entry.id));
  const match = raw.match(/\{[\s\S]*\}/);
  let ids: unknown[] = [];
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { ids?: unknown };
      if (Array.isArray(parsed.ids)) ids = parsed.ids;
    } catch {
      ids = [];
    }
  }
  if (ids.length === 0) ids = raw.match(/(cap:[a-zA-Z.]+|faq:\d+|menu:\/[a-z-]*|role:(owner|admin|agent)|workflow)/g) ?? [];
  // ทดสอบจริงพบว่าโมเดลมักตัดคำนำหน้าทิ้ง เช่น ตอบ "result.proposeCorrection" แทน "cap:result.proposeCorrection"
  // จึงเติมคำนำหน้าให้เมื่อรหัสที่ได้ไม่มีในรายการแต่รูปแบบที่เติมแล้วมีอยู่จริง
  const resolve = (id: string): string | null => {
    const trimmed = id.trim();
    if (known.has(trimmed)) return trimmed;
    for (const prefix of ["cap:", "faq:", "role:", "menu:"]) {
      if (known.has(`${prefix}${trimmed}`)) return `${prefix}${trimmed}`;
    }
    return null;
  };
  const resolved = ids.map((id) => (typeof id === "string" ? resolve(id) : null)).filter((id): id is string => id !== null);
  return [...new Set(resolved)];
}

const NOT_IN_GUIDE = [
  "ในคู่มือยังไม่มีเรื่องนี้ครับ",
  "ผมตอบเรื่องวิธีใช้งานได้เฉพาะที่มีในคู่มือ เพื่อไม่ให้แนะนำขั้นตอนที่ไม่มีอยู่จริง",
  "กดปุ่ม \"แนะนำระบบ\" เพื่อดูหัวข้อทั้งหมด หรือถามเรื่องอื่นได้เลยครับ",
].join("\n");

/**
 * สร้างคำตอบจากหัวข้อที่เลือก โดยยกข้อความในคู่มือมาทั้งก้อน
 *
 * หัวข้อยาว (ภาพรวมบทบาท ขั้นตอนทั้งงวด) แสดงได้ทีละหนึ่ง และแสดงเมื่อถูกเลือกเป็นอันดับแรกเท่านั้น
 * หัวข้อสั้นแสดงได้สูงสุด 3 หัวข้อ เพื่อให้คำตอบกระชับ
 */
export function renderGuideAnswer(ids: readonly string[]): string {
  const byId = new Map(guideEntries().map((entry) => [entry.id, entry]));
  const chosen = ids.map((id) => byId.get(id)).filter((entry): entry is GuideEntry => Boolean(entry));
  if (chosen.length === 0) return NOT_IN_GUIDE;
  const picked = chosen[0]!.long ? [chosen[0]!] : chosen.filter((entry) => !entry.long).slice(0, 3);
  return ["จากคู่มือการใช้งานครับ", "", picked.map((entry) => entry.text).join("\n\n"), "", "ถามต่อได้เลยครับ หรือกดปุ่ม \"แนะนำระบบ\" เพื่อดูทุกหัวข้อ"].join("\n");
}
