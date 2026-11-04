"use client";

type DrawOption = { id: string; label: string };

export function DrawPicker({
  selectedId,
  draws,
}: {
  selectedId: string;
  draws: DrawOption[];
}) {
  return (
    <form method="get" className="draw-picker">
      <label htmlFor="draw">
        เลือกรอบ
        <select
          id="draw"
          name="draw"
          defaultValue={selectedId}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {draws.map((draw) => (
            <option key={draw.id} value={draw.id}>
              {draw.label}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
