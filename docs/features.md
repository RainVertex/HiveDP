# Feature Kataloğu

Bu belge, `features/` altındaki her feature'ın ne yaptığını ve API'sinin nereye mount edildiğini listeler. Katman kuralları ve wiring mekanizması (featureManifest / featureRoutes) için [architecture.md](architecture.md)'ye bakın.

Shell'in mount ettiği feature listesi tek yerdedir: `apps/api/src/featureRegistry.ts` (backend) ve `apps/web/src/featureRoutes.ts` (frontend). Aşağıdaki tablo bu registry'lerin okunabilir özetidir.

## Feature listesi

| Feature           | API mount                                                                               | Ne yapar                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **agents**        | `/api/agents`, `/api/llm`, `/api/skills`                                                | Agent tanımları, skill'ler, LLM sağlayıcı yönetimi ve paylaşılan AgentTask kuyruğu. Chat ve coding çalışma zamanlarının çekirdeği (bkz. [agents.md](agents.md)).                           |
| **agent-tools**   | mount yok                                                                               | Agent'ların kullandığı tool registry'si. HTTP yüzeyi yoktur, `onBoot` ile process-local registry'ye tool'ları kaydeder. API ve agent-worker ayrı process olduğu için ikisi de kayıt yapar. |
| **catalog**       | `/api/catalog`, `/api/devdocs`, `/api/scorecards`, ayrıca raw fazda GitHub webhook'ları | Yazılım kataloğu. GitHub App üzerinden repo/entity senkronu, entity sayfaları, push webhook'ları. devdocs ve scorecards API'lerini de bu backend mount eder.                               |
| **chat**          | `/api/chat`                                                                             | Platform asistanı sohbeti. `ChatConversation` paylaşılan çekirdek modeldedir.                                                                                                              |
| **devdocs**       | (catalog üzerinden)                                                                     | Repo dokümantasyonunu platform içinde görüntüleme. Kendi backend paketi yoktur, frontend + shared'dan oluşur, API'si catalog backend'inde yaşar.                                           |
| **dora-metrics**  | `/api/dora-metrics`                                                                     | DORA metrikleri. Görünürlük catalog contract'ındaki `getVisibleOrgLogins` ile sınırlanır.                                                                                                  |
| **integrations**  | `/api/integrations`                                                                     | Admin'in yapılandırdığı entegrasyon kayıtları (GitHub org'ları, Grafana ve benzeri). Hassas config alanları `INTEGRATION_SECRET_KEY` ile şifrelenir.                                       |
| **notifications** | `/api/notifications`                                                                    | Uygulama içi bildirimler (örneğin `projects.task.assigned`).                                                                                                                               |
| **observability** | `/api/observability`, raw fazda Grafana alert webhook'u                                 | Sağlık örnekleri, entity başına observability config'i, Loki/Tempo/dashboard proxy'leri, Prometheus scrape ve alert temizlik job'ları.                                                     |
| **onboarding**    | `/api/onboarding`                                                                       | Kullanıcı başına onboarding görevleri, tamamlama ve erteleme takibi.                                                                                                                       |
| **pages**         | `/api/pages`                                                                            | Bölüm başına gezilebilir sayfa ağacı (CRUD, taşıma, widget layout'u).                                                                                                                      |
| **projects**      | `/api/projects`                                                                         | Proje yönetimi: kanban bucket'ları, task'lar, atamalar, etiketler, yorumlar, `READ`/`WRITE`/`ADMIN` üyelik ACL'i.                                                                          |
| **scaffolder**    | `/api/scaffolder`                                                                       | Backstage tarzı şablonlarla yeni servis/repo üretimi (bkz. [scaffolder.md](scaffolder.md)).                                                                                                |
| **scorecards**    | (catalog üzerinden)                                                                     | Entity scorecard'ları. devdocs gibi kendi backend'i yoktur.                                                                                                                                |
| **search**        | `/api/search`                                                                           | Platform geneli arama. Kaynak başına source modülü vardır (catalog, teams, agents, devdocs, projects, tasks, chat, pages) ve sonuçlar tek listede rank'lenir.                              |
| **teams**         | `/api/teams`                                                                            | Takımlar ve departmanlar. `Team` ve `Department` paylaşılan çekirdek modellerdir.                                                                                                          |
| **webhooks**      | `/api/webhooks`                                                                         | Dışa giden webhook abonelikleri: CRUD, test ping'i, teslimat geçmişi ve yeniden deneme job'ı.                                                                                              |

## Yeni feature eklerken

1. `features/<ad>/backend` ve `features/<ad>/frontend` paketlerini oluşturun (gerekiyorsa `shared`).
2. Backend'de `featureManifest`, frontend'de `featureRoutes` export edin.
3. `featureRegistry.ts` ve `featureRoutes.ts` dosyalarına birer satır ekleyin.
4. Cross-feature tüketime açılacak semboller için `contract.ts` barrel'ı ekleyin, diğer feature'lar yalnızca oradan import edebilir.
5. `yarn arch:check` çalıştırın.

Feature'a özgü sayfa, bileşen ve hook'ları `apps/web` altına koymayın, shell yalnızca routing, auth, widget registry ve ince wrapper'lar taşır.
