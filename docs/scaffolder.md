# Scaffolder

Scaffolder, şablonlardan yeni servis/repo üretir. Model bilinçli olarak **Backstage modelidir**: şablon tanımı bir `template.yaml` dosyasıdır, kod içine gömülü şablon yoktur ve çalıştırma öncesi onay kapısı yoktur.

## 1. Şablon modeli

- Bir şablon, Backstage tarzı bir `template.yaml`'dır: `parameters` (kullanıcıdan alınan girdiler) ve `steps` (sırayla koşan action'lar). Değer enterpolasyonu Nunjucks sözdizimiyle yapılır (`${{ parameters.name }}`).
- Platforma özgü davranış bayrakları şablonun annotation'larında taşınır, ayrı bir şema icat edilmez.
- Şablonlar veritabanında `ScaffoldTemplateDef` olarak durur ve kaynaktan (`register-template-def` servisi) kaydedilir.
- Şablon iskeletleri (skeleton) repo dışında yaşar ve çalıştırma sırasında `fetch:remote-template` action'ı ile klonlanır. Varsayılan şablonların iskeletleri public `RainVertex/scaffolder-templates` reposundadır.

## 2. Varsayılan şablonlar

Boot sırasında küratörlü varsayılan şablon seti (react, node, strapi) `seedDefaultTemplates` ile veritabanına eklenir. Seed identifier bazında idempotenttir, var olanı ezmez. Şablonun bir yaratıcısı (User FK) olması gerektiği için taze bir veritabanında ilk admin girişi yapılana kadar seed ertelenir, sonraki boot yeniden dener.

## 3. Action'lar

Kayıtlı action'lar `features/scaffolder/backend/src/actions/` altındadır:

| Action                     | Ne yapar                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch:remote-template`    | İskelet reposunu klonlar ve Nunjucks ile işler. Public repolar için token gerekmez, private iskeletler `SCAFFOLDER_SECRET_GITHUB_TOKEN` ister |
| `publish:github`           | Sonucu yeni bir GitHub reposuna push'lar (GitHub App bot'u olarak, PAT gerekmez)                                                              |
| `publish:github:pr`        | Sonucu mevcut bir repoya PR olarak açar                                                                                                       |
| `catalog:register`         | Üretilen repoyu kataloğa kaydeder                                                                                                             |
| `catalog:discover`         | Repo üzerinde katalog keşfi koşar                                                                                                             |
| `github:grant-team-access` | Yeni repoya takım erişimi verir                                                                                                               |
| `binding:write`            | Çalıştırma çıktılarını sonraki adımların kullanımına yazar                                                                                    |

Action'lar sırları env'den doğrudan okumaz. `SCAFFOLDER_SECRET_` önekli her env değişkeni `ctx.secrets.read("<AD>")` ile action'lara açılır.

## 4. Çalıştırma akışı: plan ve apply

Bir şablon çalıştırması iki fazlıdır: önce plan kurulup kalıcılaştırılır (`buildAndPersistPlan`), sonra uygulanır (`applyPersistedPlan`). Bu ayrım onay kapısı değildir, planın denetlenebilir ve tekrar oynatılabilir olması içindir. Cross-feature tüketime açık yüzey `@feature/scaffolder-backend/contract` barrel'ındadır, agent tool'ları da şablonları bu yüzey üzerinden listeler ve çalıştırır.

## 5. Yetkilendirme

Bir şablonu kimin görebileceği ve çalıştırabileceği yalnızca `TemplateAcl` satırlarıyla (`canView`, `canExecute`) belirlenir ve `filterByTemplateAcl` ile uygulanır. Erişimi kısmak istiyorsanız bu izinleri düzenleyin.

**Onay kapısı yoktur ve eklenmeyecektir.** Backstage'in scaffolder'ında yerleşik onay olmadığı gibi bu platformda da plan başına onay, capability onayı ya da "uygulamadan önce onayla" adımı yoktur. Böyle bir kapı kaldırılmış görünüyorsa bu bilinçli bir karardır, geri eklemeyin.
