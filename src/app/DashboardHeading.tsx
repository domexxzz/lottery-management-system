import { DashboardIcon, type DashboardIconName } from "./DashboardIcon";

export function DashboardHeading({
  icon, eyebrow, title, children,
}: {
  icon: DashboardIconName;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-intro">
      <span className="dashboard-intro-icon"><DashboardIcon name={icon} /></span>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}
