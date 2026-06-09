# Mimari

Bu belge, mimariyi temiz ve sürdürülebilir tutmak için kullandığımız araçları, kuralları ve tasarım kararlarını tek bir yerde toplar. Yeni bir feature eklemeden veya mevcut sınırları değiştirmeden önce buraya göz atın.

## 1. Gerçek: bu bir modüler monolit

Repo, çok sayıda package'a bölünmüş olsa da tek bir uygulamadır. İki deploy birimi vardır, `apps/api` (tek Express sunucusu) ve `apps/web` (tek React SPA). Tüm feature'lar tek bir Postgres veritabanını, tek bir Prisma client'ını ve tek bir migration geçmişini paylaşır.

Bunun pratik sonucu şudur: feature'lar **bağımsız deploy edilemez**. Package sınırları, kod organizasyonu ve kazara coupling'i önlemek içindir, mikroservis ya da bağımsız sürümleme için değil. Cross-feature foreign key'lerin neredeyse tamamı kasıtlı bir paylaşılan çekirdeğe (CoreModel: User, Team, CatalogEntity, Integration, Department, ChatConversation) işaret eder, bu çekirdek `packages/db/src/index.ts` içinde tanımlıdır. Bir feature'ı tek başına çıkarmayı planlamak boşa emektir, çünkü tablolar ve FK'ler motor seviyesinde paylaşılır.

Özetle: modülerlikten beklentimiz **net sınırlar ve açık bağımlılık grafiği**, fiziksel izolasyon değil.

## 2. Workspace yerleşimi ve katmanlar

Üç workspace kökü vardır (`apps/*`, `packages/*`, `features/*/*`):

- `apps/` shell katmanıdır. `apps/api` (@internal/backend) feature router'larını toplar, `apps/web` (@internal/app) feature sayfalarını route'lar. Shell yalnızca shell işi yapar: routing, auth, widget registry, sidebar ve apps/web'e özgü context'i (örneğin `useCurrentUser`) çözüp prop olarak feature'lara geçen ince wrapper'lar.
- `features/<ad>/` feature katmanıdır. Her feature UI'ını `frontend/` (paket adı `@feature/<ad>-frontend`), sunucu tarafını `backend/` (`@feature/<ad>-backend`) altında verir.
- `packages/` paylaşılan alt katmandır (db, shared-types, api-client, shared-ui, llm-core, scaffolder-\* gibi). Feature'ların ve apps'in altında durur.

Bağımlılık oku tek yöne akar: shell, feature'ları toplar. Feature'lar shell'i import edemez. Paylaşılan paketler ne feature'a ne apps'e bağımlı olabilir.

## 3. Sınırlar ve nasıl zorlanıyor

Sınırlar tek bir araca değil, üst üste binen dört katmana dayanır. Her katman bir öncekinin kör noktasını kapatır.

1. **Resolution-time (package.json deps).** Cross-package import'lar paket adı specifier'ı kullanır (örneğin `@feature/notifications-backend`). Yarn workspaces bunu yalnızca o paketin `package.json` dependencies listesinde beyan edilmişse linkler. Beyan edilmemiş bir import resolve olmaz ve typecheck/build kırılır. Düz klasör yapısının veremediği, bedava gelen bir kapıdır.
2. **ESLint import kuralları (`eslint.config.mjs`).** `no-restricted-imports` ile import specifier'larını denetler. Feature frontend backend import edemez, feature backend frontend import edemez, paketler apps/feature import edemez. `import type` dahil yakalar. Husky pre-commit hook'unda çalışır, yani merge'i bloklar.
3. **dependency-cruiser (`.dependency-cruiser.cjs`).** Çözülmüş (resolved) runtime grafiğini denetler. ESLint string eşleştirir, dependency-cruiser ise gerçek grafiği gezer, böylece string eşleştirmenin göremediği şeyleri yakalar: döngüler (`no-circular`), çözülemeyen import'lar ve yön ihlalleri. Type-only import'lar runtime'da silindiği için grafiğe alınmaz (`tsPreCompilationDeps: false`), type seviyesindeki karşılıklı referanslar runtime döngüsü sayılmaz. Type-import sınırını zaten ESLint kapatır.
4. **Özel kontrol (`scripts/check-workspace-deps.mjs`).** dependency-cruiser'ın native yapamadığı iki şeyi yapar:
   - **Declared-dependency bütünlüğü.** Bir paketin `src`'inde import edilen her `@feature/*` ya da `@internal/*`, o paketin `package.json` deps'inde beyan edilmiş olmalı. "Phantom coupling"i yakalar, yani package.json grafiğinin gerçek coupling'i olduğundan az gösterdiği durumu.
   - **Fan-in budget.** Çok sayıda başka feature backend'inin bağımlı olduğu bir feature backend, takımlar arası bir darboğaza döner. Eşik (şu an 5) aşılırsa build kırılır, böylece bir sonraki inbound kenarı eklemek bilinçli bir karar olur, kaza değil.

Not: Tek bir gerçek boşluk, raw `prisma` üzerinden DB tablosu seviyesinde coupling'dir (bir feature, başka bir feature'ın tablosunu doğrudan okuyabilir). Bunu import grafiği araçları göremez. Doğru çözüm, scoped DB facade'lerini (`projectsDb`, `coreDb` ve benzeri) zorunlu kılmaktır. Şu an yalnızca projects-backend lint'le buna zorlanıyor, geri kalanı için açık bir borç olarak duruyor.

## 4. Build ve runtime modeli

**Consumed-as-source.** Feature ve çoğu paylaşılan paket `main`/`types`/`exports` alanlarını ham `src/index.ts`'e gösterir, per-feature build adımı yoktur. Bundler'lar (web için Vite, dev'de api için tsx) TypeScript'i doğrudan derler. Bu, build gecikmesini ve dist/source uyuşmazlığını ortadan kaldırır, go-to-definition gerçek kaynağa düşer.

**API production bundle.** Consumed-as-source dev için idealdir ama prod için bir tuzak doğurur: `tsc` yalnızca shell'in kendi kodunu emit eder, `@feature/*-backend` deps'i ham `.ts` olarak kalır ve `node` onları yükleyemez. Bunu kapatmak için `apps/api` esbuild ile tek bir runnable dosyaya bundle edilir (`apps/api/build.mjs`). Bundle, tüm workspace kaynağını (`@feature/*`, `@internal/*`) içine alır, geri kalan her şeyi (express, `@prisma/client` ve diğer node_modules) external bırakır.

- `yarn workspace @internal/backend build` çıktı olarak `apps/api/dist/server.js` üretir.
- `yarn workspace @internal/backend start` bu bundle'ı `node` ile çalıştırır.
- CI, build sonrası bundle'ı ayağa kaldırıp `/health`'i yoklayarak artifact'in gerçekten çalıştığını doğrular (smoke adımı).

## 5. Mimari kontroller

Tek komut hepsini çalıştırır:

```
yarn arch:check
```

Bu iki adımı sırayla koşar:

- `yarn arch:graph` dependency-cruiser'ı çalıştırır (döngüler, çözülemeyen import'lar, yön ihlalleri).
- `yarn arch:deps` özel script'i çalıştırır (beyan edilmemiş workspace import'ları, fan-in budget). Fan-in özetini her zaman yazdırır.

Her ikisi de CI'da "Architecture check" adımında çalışır. Yerelde bir feature ekledikten ya da bir bağımlılık değiştirdikten sonra commit'ten önce çalıştırın.

Eşikleri ya da kuralları değiştirmek için: dependency-cruiser kuralları `.dependency-cruiser.cjs` içinde, fan-in eşiği (`FANIN_BUDGET`) `scripts/check-workspace-deps.mjs` içindedir.

## 6. Karar günlüğü (ADR)

Yeni kararları en üste, tarih ve kısa gerekçeyle ekleyin.

### 2026-06-09: dependency-cruiser ile acyclicity ve sınır kapısı

Backend feature grafiği şu an asiklik ama bunu garanti eden hiçbir şey yoktu, ve cross-package import'lar beyan edilmemiş olabiliyordu (phantom coupling). dependency-cruiser (`no-circular` ve yön kuralları) artı özel bir script (declared-dependency bütünlüğü ve fan-in budget) eklendi, `yarn arch:check` altında ve CI'da koşuyor. Kurulumda gerçek bir phantom dependency yakalandı (`apps/api` `@internal/llm-core`'u beyan etmeden import ediyordu) ve beyan edilerek düzeltildi. Type-only döngüler runtime sorunu olmadığı için grafiğe dahil edilmiyor.

### 2026-06-09: apps/api için esbuild production bundle

Consumed-as-source feature backend'leri `tsc` çıktısına girmediği için çalışan bir prod artifact'i üretilemiyordu (`node dist/index.js` feature modüllerinde `ERR_MODULE_NOT_FOUND` veriyordu). esbuild ile workspace kaynağını içeren, node_modules'ü external bırakan tek dosyalık bir bundle adımı (`apps/api/build.mjs`), bir `start` script'i ve CI'da bir `/health` smoke adımı eklendi.
