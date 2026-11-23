import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { ChangePasswordForm } from "./ChangePasswordForm";

/*
 * ทุกหน้าในแอปนี้ผูกกับ session ของผู้ใช้ จึงต้องไม่ถูกทำเป็น static
 *
 * นอกจากเรื่องความถูกต้องแล้ว ยังตัดงาน static generation ตอน build ออกด้วย
 * ซึ่งเป็นขั้นที่กินหน่วยความจำจนถูก OOM killer ฆ่าบนเครื่อง build ขนาดเล็ก
 */
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return <ChangePasswordForm forced={actor.mustChangePassword} />;
}
