export const en = {
  page: {
    defaultTitle: "Assistant",
    loading: "Loading…",
    openConversations: "Open conversations",
  },
  conversations: {
    heading: "Conversations",
    newChat: "New chat",
    empty: "No conversations yet. Send a message to start one.",
    deleteConversation: "Delete conversation",
    confirmDelete: "Confirm delete",
    cancelDelete: "Cancel delete",
  },
  widget: {
    newChat: "New chat",
    openFullView: "Open in full view",
  },
  composer: {
    placeholder: "Ask about your work, teams, requests…",
    widgetPlaceholder: "Ask anything…",
    send: "Send",
    stop: "Stop",
    stopDisabledTooltip: "submission in progress — wait for it to complete or roll back",
    attachImage: "Attach image",
    attachDisabledTooltip: "Image input is not configured. An admin must select a vision model.",
    attachmentLimit: "Attachment limit reached",
    removeAttachment: "Remove image",
  },
  welcome: {
    title: "Welcome to the Assistant",
    body: "Ask about your work, teams, catalog entities, or anything readable in the app.",
  },
  message: {
    youFallback: "You",
    assistantFallback: "Assistant",
    imageAlt: "Attached image {{index}}",
  },
  reasoning: {
    streaming: "Reasoning - {{seconds}}s",
    done: "Reasoned - {{seconds}}s",
  },
  toolCall: {
    args: "args:",
    result: "result:",
    error: "error:",
  },
  mcpOauth: {
    prompt: "Connect an account to use these tools:",
    authorize: "Connect {{label}}",
  },
};

export type ChatResources = typeof en;
