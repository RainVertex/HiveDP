import type { ChatResources } from "./en";

export const tr: ChatResources = {
  page: {
    defaultTitle: "Asistan",
    loading: "Yükleniyor…",
    openConversations: "Konuşmaları aç",
  },
  conversations: {
    heading: "Konuşmalar",
    newChat: "Yeni sohbet",
    empty: "Henüz konuşma yok. Başlamak için bir mesaj gönderin.",
    deleteConversation: "Konuşmayı sil",
    confirmDelete: "Silmeyi onayla",
    cancelDelete: "Silmeyi iptal et",
  },
  widget: {
    newChat: "Yeni sohbet",
    openFullView: "Tam ekranda aç",
  },
  composer: {
    placeholder: "Çalışmalarınız, takımlarınız, talepleriniz hakkında sorun…",
    widgetPlaceholder: "Herhangi bir şey sorun…",
    send: "Gönder",
    stop: "Durdur",
    stopDisabledTooltip: "gönderim devam ediyor, tamamlanmasını bekleyin veya geri alın",
    attachImage: "Görsel ekle",
    attachDisabledTooltip:
      "Görsel girişi yapılandırılmamış. Bir yöneticinin görüntü modeli seçmesi gerekiyor.",
    attachmentLimit: "Ek sınırına ulaşıldı",
    removeAttachment: "Görseli kaldır",
  },
  welcome: {
    title: "Asistana Hoş Geldiniz",
    body: "Çalışmalarınız, takımlarınız, katalog varlıkları veya uygulamada okunabilir herhangi bir şey hakkında soru sorabilirsiniz.",
  },
  message: {
    youFallback: "Siz",
    assistantFallback: "Asistan",
    imageAlt: "Eklenen görsel {{index}}",
  },
  reasoning: {
    streaming: "Düşünüyor - {{seconds}}s",
    done: "Düşündü - {{seconds}}s",
  },
  toolCall: {
    args: "args:",
    result: "result:",
    error: "error:",
  },
  mcpOauth: {
    prompt: "Bu araçları kullanmak için bir hesap bağlayın:",
    authorize: "{{label}} bağla",
  },
};
