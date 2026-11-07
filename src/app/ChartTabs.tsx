"use client";

import { DashboardIcon, type DashboardIconName } from "./DashboardIcon";

export function ChartTabs<View extends string>({
  panelId, options, selected, onSelect,
}: {
  panelId: string;
  options: readonly { id: View; label: string; icon: DashboardIconName }[];
  selected: View;
  onSelect: (view: View) => void;
}) {
  return (
    <div role="tablist" className="chart-tabs" aria-label="เลือกประเภทกราฟ">
      {options.map(({ id, label, icon }, index) => (
        <button key={id} id={`${panelId}-${id}`} type="button" role="tab" aria-selected={id === selected}
          aria-controls={panelId} tabIndex={id === selected ? 0 : -1} onClick={() => onSelect(id)}
          onKeyDown={(event) => {
            const last = options.length - 1;
            const targets: Record<string, number | undefined> = {
              ArrowRight: index === last ? 0 : index + 1,
              ArrowLeft: index === 0 ? last : index - 1,
              Home: 0,
              End: last,
            };
            const target = targets[event.key];
            if (target === undefined) return;
            const next = options[target];
            if (!next) return;
            event.preventDefault();
            document.getElementById(`${panelId}-${next.id}`)?.focus();
            onSelect(next.id);
          }}>
          <DashboardIcon name={icon} />
          {label}
        </button>
      ))}
    </div>
  );
}
