import type { TeamsResources } from "./en";

export const tr: TeamsResources = {
  page: {
    teamsTitle: "Takımlar",
    teamsDescription: "Kişiler, roller, sahiplik.",
    teamTitle: "Takım",
  },
  actions: {
    delete: "Sil",
    leave: "Ayrıl",
    remove: "Çıkar",
    transfer: "Aktar",
    cancel: "İptal",
  },
  status: {
    loading: "Yükleniyor…",
  },
  empty: {
    noTeams: "Henüz takım yok.",
    noMatches: "Eşleşme yok",
  },
  errors: {
    failedToLoadTeams: "Takımlar yüklenemedi",
    failedToLoad: "Yüklenemedi",
    updateFailed: "Güncelleme başarısız",
    addFailed: "Ekleme başarısız",
    removeFailed: "Çıkarma başarısız",
    transferFailed: "Aktarma başarısız",
    deleteFailed: "Silme başarısız",
  },
  members: {
    sectionTitle: "Üyeler ({{count}})",
    addMemberTitle: "Üye ekle",
    roleLead: "lider",
    roleMember: "üye",
    alreadyAdded: "zaten eklendi",
    removeAriaLabel: "{{name}} kişisini kaldır",
  },
  transfer: {
    sectionTitle: "Sahipliği aktar",
    description:
      "Bu takıma ait tüm katalog varlıklarını ve projeleri başka bir takıma taşıyın. Takımın kaynakları varsa silmeden önce bu işlem gereklidir.",
    selectTargetPlaceholder: "— Hedef takımı seçin —",
  },
  confirm: {
    deleteTeam: '"{{name}}" geçici olarak silinsin mi? 30 gün içinde geri yüklenebilir.',
    transferResult: "{{count}} varlık {{slug}} takımına aktarıldı.",
  },
  filter: {
    showAllOrgs: "Tüm organizasyonlardaki takımları göster",
  },
  teamMeta: {
    member_one: "{{count}} üye",
    member_other: "{{count}} üye",
    lead_one: "Lider",
    lead_other: "Liderler",
    noLead: "lider yok",
  },
  userPicker: {
    defaultPlaceholder: "Ad veya e-posta ile arayın…",
  },
};
