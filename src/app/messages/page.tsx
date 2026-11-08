import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { MessengerScreen } from "./MessengerScreen";
import "./messages.css";

/*
 * ทุกหน้าในแอปนี้ผูกกับ session จึงต้องไม่ถูกทำเป็น static
 * เหตุผลเดียวกับหน้าอื่น ดูคอมเมนต์ใน src/app/page.tsx
 */
export const dynamic = "force-dynamic";

/**
 * หน้าสนทนาภายในองค์กร
 *
 * เปิดได้ทุกบทบาท ส่วนกฎว่าใครคุยกับใครได้บังคับที่ชั้น service
 * ไม่ใช่ที่หน้านี้ เพราะหน้าจอไม่ใช่ทางเข้าเดียวของ API
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  // ?user= มาจากปุ่มส่งข้อความในหน้าโปรไฟล์ Agent
  const query = await searchParams;
  const raw = query.user;
  const openWithUserId = Array.isArray(raw) ? raw[0] : raw;

  return (
    <MessengerScreen
      myName={actor.displayName}
      myRole={actor.role}
      openWithUserId={openWithUserId}
    />
  );
}
