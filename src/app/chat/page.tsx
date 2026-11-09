import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { quickActionsFor } from "@/lib/chat/quick-actions";
import { listOwnerConversations } from "@/lib/chat/history";
import { isOwnerChatConfigured } from "@/lib/chat/typhoon";
import { prisma } from "@/lib/db";
import { OwnerChatbot } from "../OwnerChatbot";

export const dynamic = "force-dynamic";

export default async function OwnerChatPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (actor.role !== "GODMODE" && actor.role !== "OWNER") redirect("/");

  // ปุ่มลัดขึ้นกับสถานะงวดล่าสุด จึงต้องรู้สถานะก่อนเรนเดอร์
  const [latestDraw, initialConversations] = await Promise.all([
    prisma.draw.findFirst({
      where: orgScope(actor),
      orderBy: { cutoffAt: "desc" },
      select: { status: true },
    }),
    listOwnerConversations(actor),
  ]);

  return (
    <main className="owner-chat-page-shell">
      <div className="owner-chat-layout">
        <OwnerChatbot
          ownerName={actor.displayName}
          configured={isOwnerChatConfigured()}
          quickActions={quickActionsFor(latestDraw?.status ?? null)}
          initialConversations={initialConversations}
        />
      </div>
    </main>
  );
}
