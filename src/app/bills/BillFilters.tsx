"use client";

type Option = { id: string; label: string };

export function BillFilters({
  query,
  drawId,
  agentId,
  status,
  draws,
  agents,
  statuses,
}: {
  query: string;
  drawId: string;
  agentId: string;
  status: string;
  draws: Option[];
  agents: Option[] | null;
  statuses: Option[];
}) {
  function submitSelectedFilter(event: React.ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form method="get" className="bill-filters">
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
        รอบ
        <select id="draw" name="draw" defaultValue={drawId} onChange={submitSelectedFilter}>
          <option value="">ทุกรอบ</option>
          {draws.map((draw) => (
            <option key={draw.id} value={draw.id}>
              {draw.label}
            </option>
          ))}
        </select>
      </label>

      {agents !== null && (
        <label htmlFor="agent">
          Agent
          <select id="agent" name="agent" defaultValue={agentId} onChange={submitSelectedFilter}>
            <option value="">ทุก Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label htmlFor="status">
        สถานะ
        <select id="status" name="status" defaultValue={status} onChange={submitSelectedFilter}>
          <option value="">ทุกสถานะ</option>
          {statuses.map((statusOption) => (
            <option key={statusOption.id} value={statusOption.id}>
              {statusOption.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
