import { Link } from "react-router-dom";
import { BotIcon, ChartIcon, CubeIcon, PlugIcon, PulseIcon } from "./icons";

interface Tool {
  to: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const tools: Tool[] = [
  { to: "/catalog", label: "Catalog", description: "Services & APIs", icon: <CubeIcon /> },
  { to: "/agents", label: "Agents", description: "Automation", icon: <BotIcon /> },
  {
    to: "/observability",
    label: "Observability",
    description: "Health signals",
    icon: <PulseIcon />,
  },
  { to: "/dora-metrics", label: "DORA", description: "Delivery metrics", icon: <ChartIcon /> },
  {
    to: "/integrations",
    label: "Integrations",
    description: "Connected tools",
    icon: <PlugIcon />,
  },
];

export function ToolkitWidget() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tools.map((tool) => (
        <Link
          key={tool.to}
          to={tool.to}
          className="flex flex-col gap-1 rounded-lg border border-app-border bg-app-bg p-3 hover:border-app-primary hover:bg-app-surface-hover transition-colors"
        >
          <span className="text-app-primary">{tool.icon}</span>
          <span className="text-sm font-medium text-app-text">{tool.label}</span>
          <span className="text-xs text-app-text-muted">{tool.description}</span>
        </Link>
      ))}
    </div>
  );
}
