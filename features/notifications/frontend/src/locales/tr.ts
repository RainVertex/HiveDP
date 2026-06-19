import type { NotificationsResources } from "./en";

export const tr: NotificationsResources = {
  page: {
    title: "Bildirimler",
    description: "Uygulama içi gelen kutusu.",
    markAllRead: "Tümünü okundu işaretle",
    unreadOnly: "Yalnızca okunmayanlar",
    loading: "Yükleniyor…",
    empty: "Bildirim yok.",
    errorLoad: "Yüklenemedi",
    markRead: "Okundu işaretle",
    unreadSrOnly: "(okunmamış)",
  },
  bell: {
    ariaLabel: "Bildirimler",
    ariaLabelWithCount: "Bildirimler ({{count}} okunmamış)",
    buttonLabel: "Gelen kutusu",
    heading: "Bildirimler",
    markAllRead: "Tümünü okundu işaretle",
    viewAll: "Tümünü gör",
    loading: "Yükleniyor…",
    empty: "Tüm bildirimlerinizi okudunuz.",
    unreadSrOnly: "(okunmamış)",
  },
  summary: {
    memberAdded: "Takıma eklendi",
    memberRemoved: "Takımdan çıkarıldı",
    taskAssigned: "Atandı: {{title}}",
    taskAssignedInProject: "Atandı: {{title}} ({{project}} projesinde)",
    taskCommented: "{{author}}, {{title}} görevine yorum yaptı",
  },
  bellSummary: {
    memberAdded: "Bir takıma eklendiniz.",
    memberRemoved: "Bir takımdan çıkarıldınız.",
    taskAssigned: "Atandı: {{title}}",
    taskCommented: "{{author}}, {{title}} görevine yorum yaptı",
  },
  fallback: {
    aTask: "bir görev",
    someone: "Biri",
  },
};
