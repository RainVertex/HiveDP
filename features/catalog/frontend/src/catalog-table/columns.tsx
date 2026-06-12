// TanStack column defs and metadata for the catalog table.
import type { ColumnDef } from "@tanstack/react-table";
import type { CatalogListItem } from "@internal/shared-types";
import { useTranslation } from "@internal/i18n";
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

export type CatalogRow = CatalogListItem;

export type CatalogColumnId =
  | "star"
  | "name"
  | "kind"
  | "lifecycle"
  | "org"
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
  org: { label: "Org", groupable: true, filterKind: "facet", defaultVisible: true },
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
  "org",
  "owner",
  "tags",
  "repoUrl",
  "description",
  "updatedAt",
  "createdAt",
];

/** Returns COLUMN_META with labels resolved from the catalog namespace. */
export function useLocalizedColumnMeta(): Record<CatalogColumnId, CatalogColumnMeta> {
  const { t } = useTranslation("catalog");
  const result = {} as Record<CatalogColumnId, CatalogColumnMeta>;
  for (const id of COLUMN_ORDER) {
    result[id] = {
      ...COLUMN_META[id],
      label: t(`columnMeta.${id}`),
    };
  }
  return result;
}

const arrIncludesAny = (rowValue: unknown, _id: string, filterValue: unknown) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  if (Array.isArray(rowValue)) return rowValue.some((v) => filterValue.includes(v));
  return filterValue.includes(rowValue);
};

export function buildColumns(
  noOwnerLabel: string,
  noTagsLabel: string,
  headers: Record<CatalogColumnId, string>,
): ColumnDef<CatalogRow>[] {
  const tagsGroupingFn = (originalRow: CatalogRow): string => {
    if (!originalRow.accessible) return noTagsLabel;
    const tags = originalRow.tags;
    return tags && tags.length > 0 ? tags[0]! : noTagsLabel;
  };
  return [
    {
      id: "star",
      header: "",
      enableGrouping: false,
      enableColumnFilter: false,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        if (row.getIsGrouped() || row.original.accessible === false) return null;
        return <StarCell entityId={row.original.id} entityName={row.original.name} />;
      },
    },
    {
      id: "name",
      accessorKey: "name",
      header: headers.name,
      enableGrouping: false,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: "includesString",
      cell: ({ row }) => (
        <NameCell
          id={row.original.id}
          name={row.original.name}
          description={row.original.description}
          staleSince={row.original.accessible ? row.original.staleSince : null}
          locked={row.original.accessible === false}
        />
      ),
    },
    {
      id: "kind",
      accessorKey: "kind",
      header: headers.kind,
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
      header: headers.lifecycle,
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
      id: "org",
      accessorKey: "accountLogin",
      header: headers.org,
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      cell: ({ getValue, row }) => {
        if (row.getIsGrouped()) return null;
        return <span className="text-app-text-muted">{getValue() as string}</span>;
      },
    },
    {
      id: "owner",
      accessorFn: (row) =>
        row.accessible && row.ownerTeams && row.ownerTeams.length > 0
          ? row.ownerTeams.map((t) => t.name)
          : row.accessible
            ? [noOwnerLabel]
            : [],
      header: headers.owner,
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      getGroupingValue: (row) =>
        row.accessible && row.ownerTeams && row.ownerTeams.length > 0
          ? row.ownerTeams[0]!.name
          : noOwnerLabel,
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <OwnerCell teams={row.original.accessible ? (row.original.ownerTeams ?? []) : []} />;
      },
    },
    {
      id: "tags",
      accessorFn: (row) => (row.accessible ? (row.tags ?? []) : []),
      header: headers.tags,
      enableGrouping: true,
      enableColumnFilter: true,
      enableSorting: true,
      filterFn: arrIncludesAny,
      getGroupingValue: tagsGroupingFn,
      // Sort by first tag (case-insensitive); rows with no tags sink to the bottom in asc order.
      sortingFn: (a, b) => {
        const at = (a.original.accessible ? (a.original.tags ?? []) : [])[0]?.toLowerCase() ?? "";
        const bt = (b.original.accessible ? (b.original.tags ?? []) : [])[0]?.toLowerCase() ?? "";
        if (!at && !bt) return 0;
        if (!at) return 1;
        if (!bt) return -1;
        return at.localeCompare(bt);
      },
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <TagsCell tags={row.original.accessible ? (row.original.tags ?? []) : []} />;
      },
    },
    {
      id: "repoUrl",
      accessorFn: (row) => (row.accessible ? (row.repoUrl ?? "") : ""),
      header: headers.repoUrl,
      enableGrouping: false,
      enableColumnFilter: true,
      enableSorting: false,
      filterFn: "includesString",
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <RepoCell url={row.original.accessible ? row.original.repoUrl : null} />;
      },
    },
    {
      id: "description",
      accessorKey: "description",
      header: headers.description,
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
      accessorFn: (row) => (row.accessible ? row.updatedAt : ""),
      header: headers.updatedAt,
      enableGrouping: false,
      enableColumnFilter: false,
      enableSorting: true,
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <DateCell value={row.original.accessible ? row.original.updatedAt : null} />;
      },
    },
    {
      id: "createdAt",
      accessorFn: (row) => (row.accessible ? row.createdAt : ""),
      header: headers.createdAt,
      enableGrouping: false,
      enableColumnFilter: false,
      enableSorting: true,
      cell: ({ row }) => {
        if (row.getIsGrouped()) return null;
        return <DateCell value={row.original.accessible ? row.original.createdAt : null} />;
      },
    },
  ];
}

export function distinctValues(
  rows: CatalogRow[],
  columnId: CatalogColumnId,
  noOwnerLabel: string,
  noTagsLabel: string,
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    switch (columnId) {
      case "kind":
        set.add(r.kind);
        break;
      case "lifecycle":
        set.add(r.lifecycle);
        break;
      case "org":
        set.add(r.accountLogin);
        break;
      case "owner":
        if (r.accessible && r.ownerTeams && r.ownerTeams.length > 0) {
          for (const t of r.ownerTeams) set.add(t.name);
        } else {
          set.add(noOwnerLabel);
        }
        break;
      case "tags":
        if (r.accessible && r.tags && r.tags.length > 0) {
          for (const t of r.tags) set.add(t);
        } else {
          set.add(noTagsLabel);
        }
        break;
      default:
        break;
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
