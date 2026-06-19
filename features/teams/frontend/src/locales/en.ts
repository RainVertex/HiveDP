export const en = {
  page: {
    teamsTitle: "Teams",
    teamsDescription: "People, roles, ownership.",
    teamTitle: "Team",
  },
  actions: {
    delete: "Delete",
    leave: "Leave",
    remove: "Remove",
    transfer: "Transfer",
    cancel: "Cancel",
  },
  status: {
    loading: "Loading…",
  },
  empty: {
    noTeams: "No teams yet.",
    noMatches: "No matches",
  },
  errors: {
    failedToLoadTeams: "Failed to load teams",
    failedToLoad: "Failed to load",
    updateFailed: "Update failed",
    addFailed: "Add failed",
    removeFailed: "Remove failed",
    transferFailed: "Transfer failed",
    deleteFailed: "Delete failed",
  },
  members: {
    sectionTitle: "Members ({{count}})",
    addMemberTitle: "Add a member",
    roleLead: "lead",
    roleMember: "member",
    alreadyAdded: "already added",
    removeAriaLabel: "Remove {{name}}",
  },
  transfer: {
    sectionTitle: "Transfer ownership",
    description:
      "Move all catalog entities and projects owned by this team to another team. Required before deletion if this team owns resources.",
    selectTargetPlaceholder: "— Select target team —",
  },
  confirm: {
    deleteTeam: 'Soft-delete "{{name}}"? It can be restored within 30 days.',
    transferResult: "Transferred {{count}} entities to {{slug}}.",
  },
  filter: {
    showAllOrgs: "Show teams from all organizations",
  },
  teamMeta: {
    member_one: "{{count}} member",
    member_other: "{{count}} members",
    lead_one: "Lead",
    lead_other: "Leads",
    noLead: "no lead",
  },
  userPicker: {
    defaultPlaceholder: "Search by name or email…",
  },
};

export type TeamsResources = typeof en;
