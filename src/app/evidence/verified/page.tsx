import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { EvidenceReviewScreen } from "../EvidenceReviewScreen";
import "../review.css";
import "../../bills/[id]/evidence.css";

export const dynamic = "force-dynamic";

export default async function VerifiedEvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "evidence.review")) redirect("/");
  return <EvidenceReviewScreen actor={actor} params={await searchParams} mode="verified" />;
}
