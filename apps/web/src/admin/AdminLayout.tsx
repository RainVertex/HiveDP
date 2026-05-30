import { NavLink, Outlet } from "react-router-dom";
import { useCurrentUser } from "../auth";

const navItems = [
  { to: "/admin/ai-models", label: "AI / Models" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/audit", label: "Audit log" },
  { to: "/admin/jobs", label: "Jobs" },
];

export function AdminLayout() {
  const me = useCurrentUser();

  if (me.role !== "admin") {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-app-text mb-2">Forbidden</h1>
        <p className="text-sm text-app-text-muted">
          You need the <strong>admin</strong> role to access this section.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="w-56 shrink-0 border-r border-app-border bg-app-surface">
        <div className="p-4 text-xs font-semibold uppercase tracking-wide text-app-text-muted">
          Admin
        </div>
        <nav className="px-2 pb-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-app-primary text-white"
                    : "text-app-text hover:bg-app-surface-hover"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
