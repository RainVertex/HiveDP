// TanStack column defs and metadata for the catalog table.
import type { ColumnDef } from "@tanstack/react-table";
import type { CatalogEntity, Team } from "@internal/shared-types";
import {
  DateCell,
  KindBadge,
  LifecycleBadge,
  NameCell,
  OwnerCell,
  RepoCell,
  TagsCell,
} from "./cells";
import { StarCell } from "./StarCell";

export interface CatalogRow extends CatalogEntity {
  ownerTeams: Team[];
}

export type CatalogColumnId =
  | "star"
  | "name"
  | "kind"
  | "lifecycle"
  | "owner"
  | "tags"
  | "repoUrl"
  | "description"
  | "updatedAt"
  | "createdAt";

export const PINNED_COLUMN: CatalogColumnId = "name";

export interface CatalogColumnMeta {
  label: string;
  groupable: boolean;
  filterKind: "facet" | "text" | "none";
  defaultVisible: boolean;
}

export const COLUMN_META: Record<CatalogColumnId, CatalogColumnMeta> = {
  star: { label: "Star", groupable: false, filterKind: "none", defaultVisible: true },
  name: { label: "Name", groupable: false, filterKind: "text", defaultVisible: true },
  kind: { label: "Kind", groupable: true, filterKind: "facet", defaultVisible: true },
  lifecycle: { label: "Lifecycle", groupable: true, filterKind: "facet", defaultVisible: true },
  owner: { label: "Owner", groupable: true, filterKind: "facet", defaultVisible: true },
  tags: { label: "Tags", groupable: true, filterKind: "facet", defaultVisible: true },
  repoUrl: { label: "Repository", groupable: false, filterKind: "text", defaultVisible: false },
  description: {
    label: "Description",
    groupable: false,
    filterKind: "text",
    defaultVisible: false,
  },
  updatedAt: { label: "Updated", groupable: false, filterKind: "none", defaultVisible: true },
  createdAt: { label: "Created", groupable: false, filterKind: "none", defaultVisible: false },
};

export const COLUMN_ORDER: CatalogColumnId[] = [
  "star",
  "name",
  "kind",
  "lifecycle",
  "owner",
  "tags",
  "repoUrl",
  "description",
  "updatedAt",
  "createdAt",
];

const arrIncludesAny = (rowValue: unknown, _id: string, filterValue: unknown) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  if (Array.isArray(rowValue)) return rowValue.some((v) => filterValue.includes(v));
  return filterValue.includes(rowValue);
};

const tagsGroupingFn = (originalRow: CatalogRow): string => {
  const tags = originalRow.tags;
  return tags && tags.length > 0 ? tags[0]! : "(no tags)";
};

export function buildColumns(): ColumnDef<CatalogRow>[] {
  return [
    {
      id: "star",
      header: "",
      enableGrouping: false,
      enableColumnFilter: false,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <StarCell entityId={row.original.id} entityName={row.original.name} />;
      },
    },
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      enableGrouping: false,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: "includesString",
      cell: ({ row }) => (
        <NameCell
          id={row.original.id}
          name={row.original.name}
          description={row.original.description}
          staleSince={row.original.staleSince}
        />
      ),
    },
    {
      id: "kind",
      accessorKey: "kind",
      header: "Kind",
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      cell: ({ getValue, row }) => {
        if (row.getIsGrouped()) return null;
        return <KindBadge value={getValue() as CatalogRow["kind"]} />;
      },
    },
    {
      id: "lifecycle",
      accessorKey: "lifecycle",
      header: "Lifecycle",
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      cell: ({ getValue, row }) => {
        if (row.getIsGrouped()) return null;
        return <LifecycleBadge value={getValue() as CatalogRow["lifecycle"]} />;
      },
    },
    {
      id: "owner",
      accessorFn: (row) =>
        row.ownerTeams && row.ownerTeams.length > 0
          ? row.ownerTeams.map((t) => t.name)
          : ["(no owner)"],
      header: "Owner",
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      getGroupingValue: (row) =>
        row.ownerTeams && row.ownerTeams.length > 0 ? row.ownerTeams[0]!.name : "(no owner)",
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <OwnerCell teams={row.original.ownerTeams ?? []} />;
      },
    },
    {
      id: "tags",
      accessorFn: (row) => row.tags ?? [],
      header: "Tags",
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      getGroupingValue: tagsGroupingFn,
      // Sort by first tag (case-insensitive); rows with no tags sink to the bottom in asc order.
      sortingFn: (a, b) => {
        const at = (a.original.tags ?? [])[0]?.toLowerCase() ?? "";
        const bt = (b.original.tags ?? [])[0]?.toLowerCase() ?? "";
        if (!at && !bt) return 0;
        if (!at) return 1;
        if (!bt) return -1;
        return at.localeCompare(bt);
      },
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <TagsCell tags={row.original.tags ?? []} />;
      },
    },
    {
      id: "repoUrl",
      accessorKey: "repoUrl",
      header: "Repository",
      enableGrouping: false,
      enableColumnFilter: true,
      enableSorting: false,
      filterFn: "includesString",
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <RepoCell url={row.original.repoUrl} />;
      },
    },
    {
      id: "description",
      accessorKey: "description",
      header: "Description",
      enableGrouping: false,
      enableColumnFilter: true,
      enableSorting: false,
      filterFn: "includesString",
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        const d = row.original.description;
        return d ? (
          <div className="max-w-[20rem] truncate text-app-text-muted" title={d}>
            {d}
          </div>
        ) : (
          <span className="text-app-text-muted">—</span>
        );
      },
    },
    {
      id: "updatedAt",
      accessorKey: "updatedAt",
      header: "Updated",
      enableGrouping: false,
      enableColumnFilter: false,
      enableSorting: true,
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <DateCell value={row.original.updatedAt} />;
      },
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Created",
      enableGrouping: false,
      enableColumnFilter: false,
      enableSorting: true,
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <DateCell value={row.original.createdAt} />;
      },
    },
  ];
}

export function distinctValues(rows: CatalogRow[], columnId: CatalogColumnId): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    switch (columnId) {
      case "kind":
        set.add(r.kind);
        break;
      case "lifecycle":
        set.add(r.lifecycle);
        break;
      case "owner":
        if (r.ownerTeams && r.ownerTeams.length > 0) {
          for (const t of r.ownerTeams) set.add(t.name);
        } else {
          set.add("(no owner)");
        }
        break;
      case "tags":
        if (r.tags && r.tags.length > 0) {
          for (const t of r.tags) set.add(t);
        } else {
          set.add("(no tags)");
        }
        break;
      default:
        break;
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
