# Geliştirme Ortamı

Bu belge, repoyu sıfırdan ayağa kaldırmak ve günlük geliştirme akışını yürütmek için gereken her şeyi anlatır. Mimari kararlar ve paket sınırları için [architecture.md](architecture.md)'ye bakın.

## 1. Gereksinimler

- **Node >= 22** (`package.json` `engines` alanı zorlar)
- **Yarn 1.22 (classic)**, repo `packageManager: yarn@1.22.22` ile sabitlenmiştir
- **Docker**, yerel Postgres için ve coding agent çalıştıracaksanız sandbox konteynerleri için

## 2. İlk kurulum

```bash
yarn install
cp .env.example .env   # değerleri doldurun, dosya kendi kendini belgeler
yarn db:up             # docker compose ile Postgres'i başlatır (varsayılan port 5435)
yarn db:generate       # Prisma client üretir
yarn db:migrate        # migration'ları uygular
yarn db:seed           # varsayılan verileri yükler
yarn dev
```

`yarn dev` iki şeyi birlikte başlatır: `turbo run dev` (dev script'i olan tüm app'ler, yani api, web, agent-worker ve coding-worker) ve `scripts/start-tunnel.mjs` üzerinden bir ngrok tüneli. `NGROK_AUTHTOKEN` boşsa tünel sessizce atlanır, uygulama yine çalışır. Tünel, GitHub webhook'larının yerel makineye ulaşabilmesi içindir.

Varsayılan portlar (`.env` içinden değiştirilebilir):

| Servis   | Port | Env değişkeni   |
| -------- | ---- | --------------- |
| Postgres | 5435 | `POSTGRES_PORT` |
| API      | 4000 | `API_PORT`      |
| Web      | 3010 | `WEB_PORT`      |

Web dev sunucusu (Vite) `/api/*` ve `/auth/*` isteklerini API'ye proxy'ler, bu yüzden tarayıcıda yalnızca `http://localhost:3010` kullanılır ve session cookie same-origin kalır.

## 3. GitHub bağlantıları

İki ayrı GitHub kimliği vardır ve ikisi de `.env` üzerinden yapılandırılır:

- **OAuth App** (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`): kullanıcı girişi. Kimin girebileceği env ile değil, Integrations admin sayfasındaki `kind=github` Integration kayıtlarıyla belirlenir (o org'lardan birinin aktif üyesi olan herkes girebilir).
- **GitHub App** (`GITHUB_APP_*`): katalog senkronu, push webhook'ları ve PR otomasyonu. Yalnızca env'den okunur, veritabanına yazılmaz.

İlk girişte `BOOTSTRAP_ADMIN_EMAIL` ile eşleşen kullanıcı otomatik admin yapılır.

## 4. Günlük komutlar

| Komut                | Ne yapar                                                            |
| -------------------- | ------------------------------------------------------------------- |
| `yarn dev`           | Tüm app'leri ve ngrok tünelini başlatır                             |
| `yarn dev:app`       | Yalnızca web (Vite)                                                 |
| `yarn dev:backend`   | Yalnızca API                                                        |
| `yarn build`         | Turbo ile tüm build'ler (API esbuild bundle'ı dahil)                |
| `yarn typecheck`     | Turbo ile tüm typecheck'ler                                         |
| `yarn lint`          | ESLint (sınır kuralları dahil, pre-commit hook'unda da koşar)       |
| `yarn format`        | Prettier                                                            |
| `yarn arch:check`    | dependency-cruiser + workspace deps kontrolü (bkz. architecture.md) |
| `yarn manypkg:check` | Sürüm tutarlılığı kontrolü                                          |

Bir feature ekledikten ya da bağımlılık değiştirdikten sonra commit'ten önce `yarn arch:check` çalıştırın.

## 5. Veritabanı

Prisma şeması tek dosya değildir, `packages/db/prisma/schema/` altında domain başına bölünmüştür (`catalog.prisma`, `projects.prisma`, `agent.prisma` ve benzeri). Migration geçmişi yine tektir.

| Komut             | Ne yapar                                         |
| ----------------- | ------------------------------------------------ |
| `yarn db:up`      | Postgres konteynerini başlatır                   |
| `yarn db:down`    | Konteyneri durdurur                              |
| `yarn db:migrate` | Dev migration oluşturur ve uygular               |
| `yarn db:deploy`  | Mevcut migration'ları uygular (üretim modeli)    |
| `yarn db:studio`  | Prisma Studio                                    |
| `yarn db:seed`    | Seed (idempotent, tekrar çalıştırmak güvenlidir) |
| `yarn db:reset`   | Veritabanını sıfırlar ve yeniden seed'ler        |

**Yerel dev veritabanı gözden çıkarılabilirdir.** Bir şema değişikliği zahmetli bir migration gerektiriyorsa (backfill, dolu tabloya NOT NULL, enum değeri silme) migration ile boğuşmak yerine `yarn db:reset` tercih edilir, dev satırlarını korumaya çalışmayın.

Not: bazı arama kolonları (full-text search) migration SQL'i ile yönetilir ve Prisma şemasında karşılığı yoktur. Prisma bunları drift olarak raporlayabilir, bu beklenen bir durumdur.

## 6. Sırlar ve şifreleme

Üç ayrı anahtar vardır ve karıştırılmamalıdır:

- `SESSION_SECRET`: session cookie imzası.
- `INTEGRATION_SECRET_KEY`: Integration.config içindeki hassas alanların şifrelenmesi. Döndürülürse kayıtlı tüm integration sırları geçersiz olur, UI'dan yeniden girilmeleri gerekir.
- `APP_SECRET_MASTER_KEY`: AI admin sayfasından girilen LLM sağlayıcı API anahtarlarının şifrelenmesi. LLM anahtarları env ile değil, UI üzerinden girilir ve veritabanında şifreli durur.
