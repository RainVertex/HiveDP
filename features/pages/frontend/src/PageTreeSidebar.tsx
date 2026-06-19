// Sidebar rendering a section's page tree with create, rename, move, and delete.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "@internal/i18n";
import type { PageDto, PageScope, PageSection, PageType } from "@feature/pages-shared";
import { usePagesApi } from "./client";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  DashboardIcon,
  EllipsisIcon,
  FilePageIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GlobeIcon,
  PencilIcon,
  PersonIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";
import { searchKnownRoutes, type KnownRoute } from "./knownRoutes";

export interface PageTreeCurrentUser {
  id: string;
  role: string;
}

export interface PageTreeSidebarProps {
  section: PageSection;
  currentUser: PageTreeCurrentUser;
}

interface TreeNode {
  page: PageDto;
  children: TreeNode[];
}

function buildTree(pages: PageDto[]): TreeNode[] {
  const byParent = new Map<string | null, PageDto[]>();
  for (const p of pages) {
    const arr = byParent.get(p.parentId) ?? [];
    arr.push(p);
    byParent.set(p.parentId, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order);
  const build = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((page) => ({ page, children: build(page.id) }));
  return build(null);
}

function expandedKey(section: PageSection): string {
  return `mep:pagetree-expanded:${section}`;
}

function loadExpanded(section: PageSection): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(expandedKey(section));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((s): s is string => typeof s === "string"));
  } catch {
    return new Set();
  }
}

function saveExpanded(section: PageSection, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(expandedKey(section), JSON.stringify(Array.from(set)));
  } catch {
    // Persisting expanded state is best-effort.
  }
}

export function PageTreeSidebar({ section, currentUser }: PageTreeSidebarProps) {
  return <SectionTree key={section} section={section} currentUser={currentUser} />;
}

interface CreateRequest {
  parentId: string | null;
  forceScope?: PageScope;
}

function SectionTree({
  section,
  currentUser,
}: {
  section: PageSection;
  currentUser: PageTreeCurrentUser;
}) {
  const { t } = useTranslation("pages");
  const api = usePagesApi();
  const me = currentUser;
  const isAdmin = me.role === "admin";
  const [pages, setPages] = useState<PageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(section));
  const [renameId, setRenameId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [createReq, setCreateReq] = useState<CreateRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .list(section)
      .then((res) => {
        if (!cancelled) setPages(res.items);
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to load pages", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, section]);

  const tree = useMemo(() => buildTree(pages), [pages]);
  const siblingsByParent = useMemo(() => {
    const map = new Map<string | null, PageDto[]>();
    for (const p of pages) {
      const arr = map.get(p.parentId) ?? [];
      arr.push(p);
      map.set(p.parentId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
    return map;
  }, [pages]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveExpanded(section, next);
      return next;
    });
  };

  const canEdit = (page: PageDto): boolean => {
    if (page.scope === "SHARED") return isAdmin;
    return page.ownerUserId === me.id;
  };

  const submitCreate = async (input: CreateModalSubmit, req: CreateRequest) => {
    try {
      const created = await api.create({
        section,
        parentId: req.parentId,
        title: input.title,
        isFolder: input.isFolder,
        type: input.type,
        url: input.url,
        scope: req.forceScope ?? input.scope,
      });
      setPages((prev) => [...prev, created]);
      if (input.isFolder) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(created.id);
          saveExpanded(section, next);
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to create page", err);
    } finally {
      setCreateReq(null);
    }
  };

  const renamePage = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const original = pages.find((p) => p.id === id);
    if (!original) return;
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, title: trimmed } : p)));
    try {
      await api.update(id, { title: trimmed });
    } catch (err) {
      console.error("Failed to rename page", err);
      setPages((prev) => prev.map((p) => (p.id === id ? original : p)));
    }
  };

  const deletePage = async (id: string) => {
    const target = pages.find((p) => p.id === id);
    if (!target) return;
    if (!window.confirm(t("confirm.delete", { title: target.title }))) return;
    const snapshot = pages;
    const toRemove = collectDescendants(pages, id);
    setPages((prev) => prev.filter((p) => !toRemove.has(p.id)));
    try {
      await api.delete(id);
    } catch (err) {
      console.error("Failed to delete page", err);
      setPages(snapshot);
    }
  };

  const movePage = async (id: string, direction: "up" | "down") => {
    const target = pages.find((p) => p.id === id);
    if (!target) return;
    const siblings = (siblingsByParent.get(target.parentId) ?? []).filter(
      (s) => s.scope === target.scope,
    );
    const idx = siblings.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const neighbour = siblings[swapIdx]!;
    const body = direction === "up" ? { beforeId: neighbour.id } : { afterId: neighbour.id };
    try {
      const updated = await api.move(id, body);
      setPages((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      console.error("Failed to move page", err);
    }
  };

  return (
    <aside className="w-full h-full border-r border-app-border bg-app-surface flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <h2 className="text-sm font-semibold text-app-text">{t(`section.${section}`)}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCreateReq({ parentId: null })}
            title={t("tree.newPage")}
            aria-label={t("tree.newPage")}
            className="flex h-7 w-7 items-center justify-center rounded text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-2 py-2 text-sm"
        aria-label={t("tree.navAriaLabel", { section })}
      >
        {loading && <div className="px-2 py-1 text-app-text-muted">{t("tree.loading")}</div>}
        {!loading && tree.length === 0 && (
          <div className="px-2 py-1 text-app-text-muted">{t("tree.empty")}</div>
        )}
        {!loading && (
          <ul className="space-y-0.5">
            {tree.map((node) => (
              <NodeRow
                key={node.page.id}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                onCreateInside={(parentId, scope) => setCreateReq({ parentId, forceScope: scope })}
                onRename={(id) => setRenameId(id)}
                onDelete={deletePage}
                onMoveUp={(id) => movePage(id, "up")}
                onMoveDown={(id) => movePage(id, "down")}
                canEdit={canEdit}
                renameId={renameId}
                onRenameSubmit={(id, title) => {
                  setRenameId(null);
                  void renamePage(id, title);
                }}
                onRenameCancel={() => setRenameId(null)}
                menuOpenId={menuOpenId}
                onMenuToggle={(id) => setMenuOpenId((prev) => (prev === id ? null : id))}
              />
            ))}
          </ul>
        )}
      </nav>

      {createReq && (
        <CreatePageModal
          isAdmin={isAdmin}
          forceScope={createReq.forceScope}
          onCancel={() => setCreateReq(null)}
          onSubmit={(input) => void submitCreate(input, createReq)}
        />
      )}
    </aside>
  );
}

function collectDescendants(pages: PageDto[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const p of pages) {
      if (p.parentId && frontier.includes(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        next.push(p.id);
      }
    }
    frontier = next;
  }
  return ids;
}

interface NodeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onCreateInside: (parentId: string, scope: PageScope) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  canEdit: (page: PageDto) => boolean;
  renameId: string | null;
  onRenameSubmit: (id: string, title: string) => void;
  onRenameCancel: () => void;
  menuOpenId: string | null;
  onMenuToggle: (id: string) => void;
}

function pageHref(page: PageDto): string {
  if (page.type === "DASHBOARD") return `/p/${page.id}`;
  return page.url ?? "/";
}

// Seeded system pages carry stable ids like __page_catalog__; their default titles are localizable.
const SYSTEM_PAGE_RE = /^__page_(.+)__$/;

function NodeRow(props: NodeRowProps) {
  const { t } = useTranslation("pages");
  const {
    node,
    depth,
    expanded,
    onToggle,
    onCreateInside,
    onRename,
    onDelete,
    onMoveUp,
    onMoveDown,
    canEdit,
    renameId,
    onRenameSubmit,
    onRenameCancel,
    menuOpenId,
    onMenuToggle,
  } = props;
  const { page } = node;
  const systemMatch = SYSTEM_PAGE_RE.exec(page.id);
  const systemKey = systemMatch
    ? (`systemPages.${systemMatch[1]}` as Parameters<typeof t>[0])
    : null;
  // Localize a seeded page only while its title is still the original English, so user renames win.
  const displayTitle =
    systemKey && page.title === t(systemKey, { lng: "en" }) ? t(systemKey) : page.title;
  const isFolder = page.isFolder;
  const isOpen = expanded.has(page.id);
  const isRenaming = renameId === page.id;
  const isMenuOpen = menuOpenId === page.id;
  const indent = depth * 12;
  const editable = canEdit(page);

  const rowBase = "group relative flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors";
  const rowIdle = "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text";
  const rowActive = "bg-app-primary-soft text-app-primary-soft-foreground font-medium";

  const ScopeBadge = page.scope === "SHARED" ? GlobeIcon : PersonIcon;
  const scopeTitle = page.scope === "SHARED" ? t("scope.shared") : t("scope.personal");
  const PageIcon = isFolder
    ? isOpen
      ? FolderOpenIcon
      : FolderIcon
    : page.type === "DASHBOARD"
      ? DashboardIcon
      : FilePageIcon;

  return (
    <li>
      <div className={rowBase} style={{ paddingLeft: 6 + indent }}>
        {isFolder ? (
          <button
            type="button"
            onClick={() => onToggle(page.id)}
            aria-expanded={isOpen}
            aria-label={isOpen ? t("node.collapse") : t("node.expand")}
            className="flex h-5 w-5 shrink-0 items-center justify-center text-app-text-muted hover:text-app-text"
          >
            <span
              className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
              style={{ display: "inline-flex" }}
            >
              <ChevronRightIcon />
            </span>
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" aria-hidden />
        )}

        {isRenaming ? (
          <RenameInput
            initial={page.title}
            onSubmit={(title) => onRenameSubmit(page.id, title)}
            onCancel={onRenameCancel}
          />
        ) : isFolder ? (
          <button
            type="button"
            onClick={() => onToggle(page.id)}
            className={`flex flex-1 items-center gap-1.5 truncate text-left ${rowIdle.replace("hover:bg-app-surface-hover", "")}`}
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center text-app-text-muted"
              title={scopeTitle}
            >
              <ScopeBadge />
            </span>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-app-text-muted">
              <PageIcon />
            </span>
            <span className="truncate">{displayTitle}</span>
          </button>
        ) : (
          <NavLink
            to={pageHref(page)}
            end
            className={({ isActive }) =>
              `flex flex-1 items-center gap-1.5 truncate ${
                isActive ? rowActive : "text-app-text-muted hover:text-app-text"
              }`
            }
          >
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center text-app-text-muted"
              title={scopeTitle}
            >
              <ScopeBadge />
            </span>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-app-text-muted">
              <PageIcon />
            </span>
            <span className="truncate">{displayTitle}</span>
          </NavLink>
        )}

        {!isRenaming && editable && (
          <div
            className="relative opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100"
            data-open={isMenuOpen}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMenuToggle(page.id);
              }}
              aria-label={t("node.pageActions")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
            >
              <EllipsisIcon />
            </button>
            {isMenuOpen && (
              <ActionMenu
                page={page}
                onClose={() => onMenuToggle(page.id)}
                onCreateInside={onCreateInside}
                onRename={() => {
                  onMenuToggle(page.id);
                  onRename(page.id);
                }}
                onDelete={() => {
                  onMenuToggle(page.id);
                  onDelete(page.id);
                }}
                onMoveUp={() => {
                  onMenuToggle(page.id);
                  onMoveUp(page.id);
                }}
                onMoveDown={() => {
                  onMenuToggle(page.id);
                  onMoveDown(page.id);
                }}
              />
            )}
          </div>
        )}
      </div>

      {isFolder && isOpen && node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <NodeRow key={child.page.id} {...props} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function RenameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onSubmit(value)}
      className="flex-1 rounded border border-app-border bg-app-bg px-1.5 py-0.5 text-sm text-app-text focus:border-app-primary focus:outline-none"
    />
  );
}

function ActionMenu({
  page,
  onClose,
  onCreateInside,
  onRename,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  page: PageDto;
  onClose: () => void;
  onCreateInside: (parentId: string, scope: PageScope) => void;
  onRename: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { t } = useTranslation("pages");

  useEffect(() => {
    function handler() {
      onClose();
    }
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [onClose]);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border border-app-border bg-app-surface py-1 shadow-lg"
    >
      <MenuItem icon={<PencilIcon />} label={t("menu.rename")} onClick={onRename} />
      <MenuItem icon={<ArrowUpIcon />} label={t("menu.moveUp")} onClick={onMoveUp} />
      <MenuItem icon={<ArrowDownIcon />} label={t("menu.moveDown")} onClick={onMoveDown} />
      {page.isFolder && (
        <>
          <div className="my-1 border-t border-app-border" aria-hidden />
          <MenuItem
            icon={<PlusIcon />}
            label={t("menu.newPageInside")}
            onClick={() => {
              onCreateInside(page.id, page.scope);
            }}
          />
        </>
      )}
      <div className="my-1 border-t border-app-border" aria-hidden />
      <MenuItem icon={<TrashIcon />} label={t("menu.delete")} onClick={onDelete} destructive />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
        destructive
          ? "text-app-danger hover:bg-app-danger/10"
          : "text-app-text-muted hover:bg-app-surface-hover hover:text-app-text"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

interface CreateModalSubmit {
  title: string;
  type: PageType;
  isFolder: boolean;
  url?: string;
  scope: PageScope;
}

function CreatePageModal({
  isAdmin,
  forceScope,
  onCancel,
  onSubmit,
}: {
  isAdmin: boolean;
  forceScope?: PageScope;
  onCancel: () => void;
  onSubmit: (input: CreateModalSubmit) => void;
}) {
  const { t } = useTranslation("pages");
  const [kind, setKind] = useState<"DASHBOARD" | "LINK" | "FOLDER" | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<PageScope>(forceScope ?? (isAdmin ? "SHARED" : "PERSONAL"));

  const canSubmit =
    title.trim().length > 0 && (kind === "DASHBOARD" || kind === "FOLDER" || url.trim().length > 0);

  const submit = () => {
    if (!canSubmit || !kind) return;
    onSubmit({
      title: title.trim(),
      type: kind === "LINK" ? "LINK" : "DASHBOARD",
      isFolder: kind === "FOLDER",
      url: kind === "LINK" ? url.trim() : undefined,
      scope,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-app-border bg-app-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
          <h3 className="text-sm font-semibold text-app-text">
            {kind === null ? t("modal.promptTitle") : t("modal.newPageTitle")}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("modal.close")}
            className="text-app-text-muted hover:text-app-text"
          >
            ×
          </button>
        </div>

        {kind === null && (
          <div className="grid gap-2 p-4">
            <KindOption
              icon={<DashboardIcon />}
              title={t("kind.dashboardTitle")}
              description={t("kind.dashboardDescription")}
              onClick={() => setKind("DASHBOARD")}
            />
            <KindOption
              icon={<FilePageIcon />}
              title={t("kind.linkTitle")}
              description={t("kind.linkDescription")}
              onClick={() => setKind("LINK")}
            />
            <KindOption
              icon={<FolderPlusIcon />}
              title={t("kind.folderTitle")}
              description={t("kind.folderDescription")}
              onClick={() => setKind("FOLDER")}
            />
          </div>
        )}

        {kind !== null && (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-app-text-muted" htmlFor="page-title">
                {kind === "FOLDER" ? t("modal.labelFolderName") : t("modal.labelPageTitle")}
              </label>
              <input
                id="page-title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) submit();
                  if (e.key === "Escape") onCancel();
                }}
                className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-primary focus:outline-none"
              />
            </div>

            {kind === "LINK" && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-app-text-muted" htmlFor="page-url">
                  {t("modal.labelTargetUrl")}
                </label>
                <UrlCombobox
                  value={url}
                  onChange={setUrl}
                  isAdmin={isAdmin}
                  onPickSuggestion={(route) => {
                    setUrl(route.path);
                    if (title.trim() === "") setTitle(t(route.labelKey));
                  }}
                  onSubmit={() => {
                    if (canSubmit) submit();
                  }}
                  onEscape={onCancel}
                />
              </div>
            )}

            {isAdmin && !forceScope && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-app-text-muted">
                  {t("modal.labelVisibility")}
                </span>
                <div className="flex gap-2">
                  <ScopeChoice
                    selected={scope === "SHARED"}
                    icon={<GlobeIcon />}
                    label={t("visibility.sharedLabel")}
                    hint={t("visibility.sharedHint")}
                    onClick={() => setScope("SHARED")}
                  />
                  <ScopeChoice
                    selected={scope === "PERSONAL"}
                    icon={<PersonIcon />}
                    label={t("visibility.personalLabel")}
                    hint={t("visibility.personalHint")}
                    onClick={() => setScope("PERSONAL")}
                  />
                </div>
              </div>
            )}

            {forceScope && (
              <p className="text-xs text-app-text-muted">
                {forceScope === "SHARED"
                  ? t("modal.forceScopeShared")
                  : t("modal.forceScopePersonal")}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-app-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-sm text-app-text hover:bg-app-surface-hover"
          >
            {t("modal.cancel")}
          </button>
          {kind !== null && (
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-md bg-app-primary px-3 py-1.5 text-sm font-medium text-app-primary-foreground hover:bg-app-primary-hover disabled:opacity-50"
            >
              {t("modal.create")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KindOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-md border border-app-border bg-app-bg p-3 text-left transition-colors hover:border-app-primary hover:bg-app-surface-hover"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-app-primary">
        {icon}
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-app-text">{title}</span>
        <span className="text-xs text-app-text-muted">{description}</span>
      </div>
    </button>
  );
}

function ScopeChoice({
  selected,
  icon,
  label,
  hint,
  onClick,
}: {
  selected: boolean;
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col items-start gap-1 rounded-md border p-2 text-left transition-colors ${
        selected
          ? "border-app-primary bg-app-primary-soft"
          : "border-app-border bg-app-bg hover:bg-app-surface-hover"
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-app-text">
        <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
        {label}
      </span>
      <span className="text-xs text-app-text-muted">{hint}</span>
    </button>
  );
}

interface UrlComboboxProps {
  value: string;
  onChange: (next: string) => void;
  isAdmin: boolean;
  onPickSuggestion: (route: KnownRoute) => void;
  onSubmit: () => void;
  onEscape: () => void;
}

function UrlCombobox({
  value,
  onChange,
  isAdmin,
  onPickSuggestion,
  onSubmit,
  onEscape,
}: UrlComboboxProps) {
  const { t } = useTranslation("pages");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchKnownRoutes(value, { isAdmin, limit: 8 }), [value, isAdmin]);

  useEffect(() => {
    setHighlight(0);
  }, [matches]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (route: KnownRoute) => {
    onPickSuggestion(route);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      onEscape();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      if (open && matches.length > 0) {
        e.preventDefault();
        pick(matches[highlight]!);
        return;
      }
      onSubmit();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id="page-url"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={t("modal.urlPlaceholder")}
        className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-primary focus:outline-none"
      />
      {open && matches.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border border-app-border bg-app-surface shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((route, idx) => (
            <li key={route.path}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => pick(route)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  idx === highlight
                    ? "bg-app-primary-soft text-app-primary-soft-foreground"
                    : "text-app-text hover:bg-app-surface-hover"
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{t(route.labelKey)}</span>
                  <span className="text-xs text-app-text-muted">{route.path}</span>
                </span>
                {route.adminOnly && (
                  <span className="text-[10px] uppercase tracking-wide text-app-text-muted">
                    {t("badge.admin")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
