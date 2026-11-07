"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppDropdown } from "../AppDropdown";

type Option = { id: string; label: string };

export function BillFilters({
  query,
  drawId,
  agentId,
  status,
  winnerOnly,
  draws,
  agents,
  statuses,
}: {
  query: string;
  drawId: string;
  agentId: string;
  status: string;
  winnerOnly: boolean;
  draws: Option[];
  agents: Option[] | null;
  statuses: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.delete("page");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return (
    <form method="get" className="bill-filters">
      {winnerOnly && <input type="hidden" name="winner" value="1" />}
      <label htmlFor="q">
        ค้นหา
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="เลขบิลหรือชื่อบิล"
        />
      </label>

      <label htmlFor="draw">
        งวด
        <AppDropdown id="draw" name="draw" value={drawId} onValueChange={(value) => update("draw", value)} options={[{ value: "", label: "ทุกงวด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.label }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" />
      </label>

      {agents !== null && (
        <label htmlFor="agent">
          Agent
          <AppDropdown id="agent" name="agent" value={agentId} onValueChange={(value) => update("agent", value)} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]} searchable={agents.length > 6} searchPlaceholder="ค้นหา Agent" />
        </label>
      )}

      <label htmlFor="status">
        สถานะ
        <AppDropdown id="status" name="status" value={status} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "ทุกสถานะ" }, ...statuses.map((option) => ({ value: option.id, label: option.label }))]} />
      </label>
    </form>
  );
}
