import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDeletionLog, type DeletionKind } from "@/lib/audit/deletions";
import { DashboardIcon } from "../../DashboardIcon";
import { DeletionFilters } from "./DeletionFilters";
import "../audit.css";
import "./deletions.css";

const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Bangkok" });
const KIND_LABEL: Record<DeletionKind, string> = { DRAW: "ลบงวด", BILL: "ลบบิล" };
const ROLE_LABEL: Record<string, string> = { OWNER: "เจ้าของกิจการ", ADMIN: "ผู้ดูแลระบบ", AGENT: "ตัวแทน" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const dynamic = "force-dynamic";

/**
 * ประวัติการลบงวดและบิล — Owner เท่านั้น
 *
 * Admin ลบบิลได้ และ Owner ลบงวดได้ ซึ่งลบบิลกับยอดเงินที่ผูกอยู่ไปด้วยทั้งหมด
 * หน้านี้จึงต้องอยู่นอกมือคนที่ลบได้ส่วนใหญ่ ไม่งั้นคนลบก็ตรวจตัวเอง
 */
export default async function DeletionLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "audit.viewDeletions")) redirect("/");

  const query = await searchParams;
  const rawKind = first(query.kind);
  const kind: DeletionKind | "ALL" = rawKind === "DRAW" || rawKind === "BILL" ? rawKind : "ALL";
  const from = first(query.from);
  const to = first(query.to);

  const entries = await listDeletionLog(actor, { kind, from, to });
  const drawCount = entries.filter((entry) => entry.kind === "DRAW").length;
  const billCount = entries.length - drawCount;

  return <main className="workspace-page audit-page deletion-page">
    <header className="page-hero">
      <div className="page-hero-copy">
        <Link href="/audit" className="back-link">← กลับหน้าประวัติการตรวจ</Link>
        <p className="page-eyebrow">Deletion Log · Owner only</p>
        <h1>ประวัติการลบงวดและบิล</h1>
        <p>ใครลบอะไร เมื่อไร และพาอะไรหายไปด้วย · การลบงวดลบบิล รายการแทง ผลรางวัล และ Settlement ทิ้งถาวรพร้อมกัน</p>
      </div>
      <span className="audit-readonly"><DashboardIcon name="lock" /> เห็นเฉพาะเจ้าของกิจการ<small>กู้คืนจากหน้านี้ไม่ได้ เป็นบันทึกอย่างเดียว</small></span>
    </header>

    <DeletionFilters kind={kind} from={from ?? ""} to={to ?? ""} />

    <section className="deletion-summary" aria-label="สรุปจำนวนรายการ">
      <article><span>รายการที่พบ</span><strong>{entries.length}</strong></article>
      <article><span>ลบงวด</span><strong>{drawCount}</strong></article>
      <article><span>ลบบิล</span><strong>{billCount}</strong></article>
    </section>

    {entries.length === 0
      ? <p className="audit-empty">ไม่พบการลบงวดหรือบิลในช่วงที่เลือก</p>
      : <section className="deletion-list" aria-label="รายการลบ">
        {entries.map((entry) => <article key={entry.id} className={`deletion-row is-${entry.kind.toLowerCase()}`}>
          <div className="deletion-when">
            <span className={`deletion-kind ${entry.kind.toLowerCase()}`}>{KIND_LABEL[entry.kind]}</span>
            <time dateTime={entry.deletedAt.toISOString()}>{DATE_TIME.format(entry.deletedAt)}</time>
          </div>

          <div className="deletion-what">
            <strong>{entry.title}</strong>
            <small>
              {entry.statusBefore ? `สถานะก่อนลบ ${entry.statusBefore}` : "ไม่ทราบสถานะก่อนลบ"}
              {" · "}
              <code>{entry.entityId}</code>
            </small>
            {entry.reason && <p className="deletion-reason">{entry.reason}</p>}
          </div>

          <div className="deletion-who">
            <span>ลบโดย</span>
            {entry.actorName
              ? <><strong>{entry.actorName}</strong><small>{ROLE_LABEL[entry.actorRole ?? ""] ?? entry.actorRole ?? "—"}{entry.actorLogin ? ` · @${entry.actorLogin}` : ""}</small></>
              : <><strong className="deletion-unknown">บัญชีที่ถูกลบไปแล้ว</strong><small>ไม่มีข้อมูลผู้ใช้เหลืออยู่</small></>}
            {entry.ipAddress && <small className="deletion-ip">IP {entry.ipAddress}</small>}
          </div>

          <div className="deletion-impact">
            <span>หายไปพร้อมกัน</span>
            {entry.impact.length === 0
              ? <small>ไม่มีข้อมูลผูกอยู่</small>
              : <ul>{entry.impact.map((item) => <li key={item.label}><b>{item.value}</b> {item.label}</li>)}</ul>}
          </div>
        </article>)}
      </section>}

    <p className="deletion-note">
      บันทึกนี้เขียนพร้อมกับการลบในทรานแซกชันเดียวกัน ถ้าการลบสำเร็จก็ต้องมีแถวที่นี่เสมอ
      และแก้หรือลบแถวจากหน้าจอไม่ได้
    </p>
  </main>;
}
