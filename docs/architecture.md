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

Bağımlılık oku tek yöne akar: shell, feature'ları toplar. Feature'lar shell'i import edemez. Paylaşılan paketler ne feature'a ne apps'e bağımlı olabilir. Shell, feature'ları elle mount/route etmek yerine bir registry üzerinde sabit bir loop ile toplar (bkz. Bölüm 4).

## 3. Sınırlar ve nasıl zorlanıyor

Sınırlar tek bir araca değil, üst üste binen dört katmana dayanır. Her katman bir öncekinin kör noktasını kapatır.

1. **Resolution-time (package.json deps).** Cross-package import'lar paket adı specifier'ı kullanır (örneğin `@feature/notifications-backend`). Yarn workspaces bunu yalnızca o paketin `package.json` dependencies listesinde beyan edilmişse linkler. Beyan edilmemiş bir import resolve olmaz ve typecheck/build kırılır. Düz klasör yapısının veremediği, bedava gelen bir kapıdır.
2. **ESLint import kuralları (`eslint.config.mjs`).** `no-restricted-imports` ile import specifier'larını denetler. Feature frontend backend import edemez, feature backend frontend import edemez, paketler apps/feature import edemez. Ek olarak bir feature backend'i yalnızca `package.json` deps'inde beyan ettiği başka feature backend'lerini, onların da yalnızca dar `/contract` alt-yolunu import edebilir (kurallar her feature'ın deps'inden üretilir, tek tek elle yazılmaz, bkz. Bölüm 4). `import type` dahil yakalar. Husky pre-commit hook'unda çalışır, yani merge'i bloklar.
3. **dependency-cruiser (`.dependency-cruiser.cjs`).** Çözülmüş (resolved) runtime grafiğini denetler. ESLint string eşleştirir, dependency-cruiser ise gerçek grafiği gezer, böylece string eşleştirmenin göremediği şeyleri yakalar: döngüler (`no-circular`), çözülemeyen import'lar ve yön ihlalleri. Type-only import'lar runtime'da silindiği için grafiğe alınmaz (`tsPreCompilationDeps: false`), type seviyesindeki karşılıklı referanslar runtime döngüsü sayılmaz. Type-import sınırını zaten ESLint kapatır.
4. **Özel kontrol (`scripts/check-workspace-deps.mjs`).** dependency-cruiser'ın native yapamadığı iki şeyi yapar:
   - **Declared-dependency bütünlüğü.** Bir paketin `src`'inde import edilen her `@feature/*` ya da `@internal/*`, o paketin `package.json` deps'inde beyan edilmiş olmalı. "Phantom coupling"i yakalar, yani package.json grafiğinin gerçek coupling'i olduğundan az gösterdiği durumu.
   - **Fan-in budget.** Çok sayıda başka feature backend'inin bağımlı olduğu bir feature backend, takımlar arası bir darboğaza döner. Eşik (şu an 5) aşılırsa build kırılır, böylece bir sonraki inbound kenarı eklemek bilinçli bir karar olur, kaza değil.

Not: Tek bir gerçek boşluk, raw `prisma` üzerinden DB tablosu seviyesinde coupling'dir (bir feature, başka bir feature'ın tablosunu doğrudan okuyabilir). Bunu import grafiği araçları göremez. Doğru çözüm, scoped DB facade'lerini (`projectsDb`, `coreDb` ve benzeri) zorunlu kılmaktır. Şu an yalnızca projects-backend lint'le buna zorlanıyor, geri kalanı için açık bir borç olarak duruyor.

## 4. Cross-feature contract'lar ve feature wiring

**Backend `/contract` barrel'ları.** Bir feature backend'i başka bir feature backend'ini ana barrel'ından (`@feature/x-backend`) değil, dar bir `@feature/x-backend/contract` alt-yolundan import eder. `contract.ts` yalnızca cross-feature tüketime açık sembolleri re-export eder, böylece `index.ts`'in geniş yüzeyi (örneğin `export * from "./service"`) dışarıya sızmaz. Sınır Bölüm 3'teki ESLint kuralıyla zorlanır: beyan edilmemiş bir backend import edilemez, beyan edilenin de yalnızca `/contract`'ı kullanılabilir.

**Wire contract (`shared-types`).** Frontend ile backend arasındaki veri şekilleri `packages/shared-types`'ta tek doğruluk kaynağı olarak durur. Backend mapper'ları dönüş tipi olarak bu DTO'lara bağlanır, frontend aynı tipleri import eder, böylece iki yarı drift edemez. Örnek: projects DTO'ları shared-types'tan gelir (backend ve frontend ikisi de import eder), catalog `shapeEntity` `CatalogEntityWithOwners`'a bağlıdır.

**Feature wiring: auto-discovery.** Shell, feature'ları elle mount/route etmez:

- Her feature backend `featureManifest` export eder (`@internal/feature-host` tipinde): mount path, faz (`raw` json'dan önce, `preApi` /api auth zincirinden önce, `api` requireAuth altında), `order` ve isteğe bağlı `onBoot`. `apps/api/src/featureRegistry.ts` feature'ları bir kez listeler, `createServer` registry üzerinde sabit bir loop'tur ve hiçbir feature router'ını doğrudan import etmez. Mount sırası `order` ile ifade edilir (aynı önekte spesifik bir alt-router'ı catch-all'dan önce tutmak için).
- Her feature frontend `featureRoutes` export eder (`RouteObject[]`, ya da shell-prop veya guard gerektirenler için bir factory, örneğin agents'ın `avatarPresets`'i ve integrations'ın `AdminRoute`'u). `apps/web/src/featureRoutes.ts` registry'yi kurar, `AppRoutes` bir `useRoutes` loop'udur. react-router route'ları spesifikliğe göre sıraladığı için path sırası önemli değildir.

Yeni feature eklerken: backend'de `featureManifest`, frontend'de `featureRoutes` export et, iki registry dosyasına birer satır ekle. Mount/route mantığı feature'ın içinde yaşar, merkezi dosyalar sabit kalır.

## 5. Sürüm politikası (tek sürüm)

Bir bağımlılığın repo genelinde tek sürümü olur:

- Root `package.json` `resolutions`, React ekosistemini (react, react-dom, react-router, react-router-dom) tek sürüme sabitler. Bu, context ve hook kimliğini bozan çift-React kopyalarını engeller (eski `vite dedupe` band-aid'inin yerini alan asıl çözüm).
- `manypkg`, tüm paketlerdeki declared range'leri tutarlı tutar ve CI'da `yarn manypkg:check` ile gate'lenir. Drift'i (örneğin react ^19.2.4 vs ^19.2.6) yakalar, `yarn manypkg:fix` hepsini birleştirir.
- Internal pin'ler (`@feature/*` ve `@internal/*` deps'i) exact `0.1.0` kalır. yarn classic `workspace:*` protokolünü desteklemez, o yüzden pin'leri manypkg tutarlı tutar (bir sürüm bump'ında `manypkg fix` hepsini günceller).

## 6. Build ve runtime modeli

**Consumed-as-source.** Feature ve çoğu paylaşılan paket `main`/`types`/`exports` alanlarını ham `src/index.ts`'e gösterir, per-feature build adımı yoktur. Bundler'lar (web için Vite, dev'de api için tsx) TypeScript'i doğrudan derler. Bu, build gecikmesini ve dist/source uyuşmazlığını ortadan kaldırır, go-to-definition gerçek kaynağa düşer.

**API production bundle.** Consumed-as-source dev için idealdir ama prod için bir tuzak doğurur: `tsc` yalnızca shell'in kendi kodunu emit eder, `@feature/*-backend` deps'i ham `.ts` olarak kalır ve `node` onları yükleyemez. Bunu kapatmak için `apps/api` esbuild ile tek bir runnable dosyaya bundle edilir (`apps/api/build.mjs`). Bundle, tüm workspace kaynağını (`@feature/*`, `@internal/*`) içine alır, geri kalan her şeyi (express, `@prisma/client` ve diğer node_modules) external bırakır.

- `yarn workspace @internal/backend build` çıktı olarak `apps/api/dist/server.js` üretir.
- `yarn workspace @internal/backend start` bu bundle'ı `node` ile çalıştırır.
- CI, build sonrası bundle'ı ayağa kaldırıp `/health`'i yoklayarak artifact'in gerçekten çalıştığını doğrular (smoke adımı).

## 7. Mimari kontroller ve sahiplik

Tek komut hepsini çalıştırır:

```
yarn arch:check
```

Bu iki adımı sırayla koşar:

- `yarn arch:graph` dependency-cruiser'ı çalıştırır (döngüler, çözülemeyen import'lar, yön ihlalleri).
- `yarn arch:deps` özel script'i çalıştırır (beyan edilmemiş workspace import'ları, fan-in budget). Fan-in özetini her zaman yazdırır.

Her ikisi de CI'da "Architecture check" adımında çalışır. Yerelde bir feature ekledikten ya da bir bağımlılık değiştirdikten sonra commit'ten önce çalıştırın.

Eşikleri ya da kuralları değiştirmek için: dependency-cruiser kuralları `.dependency-cruiser.cjs` içinde, fan-in eşiği (`FANIN_BUDGET`) `scripts/check-workspace-deps.mjs` içindedir.

Diğer CI kapıları: `yarn manypkg:check` sürüm tutarlılığını ("Single-version policy" adımı, bkz. Bölüm 5), build sonrası bir smoke adımı API bundle'ının gerçekten çalıştığını doğrular (bkz. Bölüm 6).

**Sahiplik.** `.github/CODEOWNERS` her feature, paket, app ve mimari-governance dosyası (eslint config, dependency-cruiser config, createServer, featureRegistry, root package.json) için bir owner satırı tutar. PR bu yolları değiştirdiğinde GitHub owner'dan otomatik review ister. Şu an repo tek sahipli, ekip büyüdükçe ilgili satırdaki owner takım handle'ıyla değiştirilir, başka satıra dokunmadan.

## 8. Karar günlüğü (ADR)

Yeni kararları en üste, tarih ve kısa gerekçeyle ekleyin.

### 2026-06-09: feature wiring auto-discovery (manifest ve routes)

`createServer.ts` ve `AppRoutes.tsx` her feature'ın elle düzenlediği append-only merkezi dosyalardı (merge hotspot, sahiplik shell'de). Her feature backend artık `featureManifest`, her feature frontend `featureRoutes` export ediyor, merkezi dosyalar birer registry üzerinde sabit loop oldu. Yeni `@internal/feature-host` paketi manifest tipini taşıyor (feature `apps/*`'ı import edemediği için). Mount sırası `order` ile veri olarak ifade ediliyor, frontend'de react-router spesifiklik sıralaması mount sırasını gereksiz kılıyor. Doğrulama: typecheck, backend mount paritesi ve boot smoke, frontend için 55 route path'inin birebir korunduğu statik parite ve vite build.

### 2026-06-09: cross-feature `/contract` barrel'ları ve per-feature ESLint allowlist

Cross-feature backend coupling, her feature'ın ana barrel'ı üzerinden derin servis fonksiyonlarına ulaşabiliyordu (örneğin catalog `export * from "./service"` ile `markStaleEntities`'i sızdırıyordu). Her cross-feature backend için dar bir `/contract` alt-yolu eklendi, tüm cross-feature import'lar oraya yönlendirildi. ESLint kuralları her feature'ın `package.json` deps'inden üretiliyor: beyan edilmemiş bir backend ya da beyan edilenin ana barrel'ı import edilirse hata. Eski copy-paste `projectsBackendScopedDb` bloğu generator'a katıldı.

### 2026-06-09: projects ve catalog'u shared-types contract'ına bağlama

projects-frontend kendi DTO'larını elle yeniden yazıyordu ve backend'le drift etmişti (taskCount, maxPermission, permission). projects DTO'ları `shared-types`'a tek doğruluk kaynağı olarak taşındı, backend mapper'ları bağlandı, frontend import ediyor. catalog `shapeEntity` `CatalogEntityWithOwners`'a bağlandı (ISO tarihler, restricted alanlar opsiyonel).

### 2026-06-09: tek sürüm politikası (resolutions ve manypkg)

"Always use latest" politikası + per-feature pin'ler, diskte çift-React kopyaları üretmişti ve bunu yalnızca elle bakımlı bir `vite dedupe` listesi engelliyordu. Root `resolutions` React ekosistemini tek sürüme sabitledi, `manypkg` tüm declared range'leri birleştirdi ve CI'da gate'lendi. yarn classic `workspace:*`'ı desteklemediği için internal pin'ler exact kaldı, manypkg onları tutarlı tutuyor.

### 2026-06-09: dependency-cruiser ile acyclicity ve sınır kapısı

Backend feature grafiği şu an asiklik ama bunu garanti eden hiçbir şey yoktu, ve cross-package import'lar beyan edilmemiş olabiliyordu (phantom coupling). dependency-cruiser (`no-circular` ve yön kuralları) artı özel bir script (declared-dependency bütünlüğü ve fan-in budget) eklendi, `yarn arch:check` altında ve CI'da koşuyor. Kurulumda gerçek bir phantom dependency yakalandı (`apps/api` `@internal/llm-core`'u beyan etmeden import ediyordu) ve beyan edilerek düzeltildi. Type-only döngüler runtime sorunu olmadığı için grafiğe dahil edilmiyor.

### 2026-06-09: apps/api için esbuild production bundle

Consumed-as-source feature backend'leri `tsc` çıktısına girmediği için çalışan bir prod artifact'i üretilemiyordu (`node dist/index.js` feature modüllerinde `ERR_MODULE_NOT_FOUND` veriyordu). esbuild ile workspace kaynağını içeren, node_modules'ü external bırakan tek dosyalık bir bundle adımı (`apps/api/build.mjs`), bir `start` script'i ve CI'da bir `/health` smoke adımı eklendi.
