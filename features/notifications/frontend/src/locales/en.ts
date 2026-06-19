export const en = {
  page: {
    title: "Notifications",
    description: "In-app inbox.",
    markAllRead: "Mark all read",
    unreadOnly: "Unread only",
    loading: "Loading…",
    empty: "No notifications.",
    errorLoad: "Failed to load",
    markRead: "Mark read",
    unreadSrOnly: "(unread)",
  },
  bell: {
    ariaLabel: "Notifications",
    ariaLabelWithCount: "Notifications ({{count}} unread)",
    buttonLabel: "Inbox",
    heading: "Notifications",
    markAllRead: "Mark all read",
    viewAll: "View all",
    loading: "Loading…",
    empty: "You're all caught up.",
    unreadSrOnly: "(unread)",
  },
  summary: {
    memberAdded: "Added to team",
    memberRemoved: "Removed from team",
    taskAssigned: "Assigned to: {{title}}",
    taskAssignedInProject: "Assigned to: {{title}} in {{project}}",
    taskCommented: "{{author}} commented on: {{title}}",
  },
  bellSummary: {
    memberAdded: "You were added to a team.",
    memberRemoved: "You were removed from a team.",
    taskAssigned: "Assigned to: {{title}}",
    taskCommented: "{{author}} commented on: {{title}}",
  },
  fallback: {
    aTask: "a task",
    someone: "Someone",
  },
};

export type NotificationsResources = typeof en;
