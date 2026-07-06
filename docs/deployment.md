# Dağıtım (Demo)

Bu belge, `docker-compose.demo.yml` ile yapılan demo.rainvertex.com dağıtımını anlatır. Dev compose'dan (yalnızca Postgres) bağımsızdır, kendi proje adını (`mep-demo`) ve volume'unu kullanır.

## 1. İmajlar

Tek [Dockerfile](../Dockerfile) iki runtime imajı üretir:

- **`app` stage'i**: API, agent-worker ve coding-worker aynı imajı paylaşır, hangisinin çalışacağını compose `command` ile seçer. İmaj esbuild bundle'larını (`apps/*/dist`), üçüncü parti `node_modules`'ü ve migration/seed için `packages/db`'yi içerir. Bundle'lar tüm workspace kodunu içine aldığı için feature paketlerinin kaynağı imaja kopyalanmaz. Coding-worker run başına `docker run` çağırdığı için imaja statik Docker CLI eklenir, daemon soketi compose'dan mount edilir.
- **`web` stage'i**: SPA build çıktısını servis eden ve backend path'lerini api konteynerine proxy'leyen Caddy.

Build cache'i için önce yalnızca manifest'ler (`package.json` + `yarn.lock`) kopyalanır (`manifests` stage'i), böylece kaynak değişikliği `yarn install` katmanını bozmaz.

## 2. Servisler

`docker compose -f docker-compose.demo.yml up -d --build` şunları başlatır:

| Servis          | Ne yapar                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres`      | Postgres 17, `demo-pg` volume'unda kalıcı veri                                                                                                         |
| `migrate`       | Tek seferlik: `prisma migrate deploy` + seed. Seed idempotenttir ve kod sahipli satırları (skill toolId'leri, builtin agent'lar) her dağıtımda tazeler |
| `api`           | `node apps/api/dist/server.js`, `/health` üzerinden healthcheck                                                                                        |
| `agent-worker`  | Chat runtime worker'ı                                                                                                                                  |
| `coding-worker` | Coding runtime worker'ı, `/var/run/docker.sock` mount'u ile run konteynerlerini host daemon üzerinde kardeş olarak başlatır                            |
| `web`           | Caddy + SPA, yerel kontrol için 8080'i açar                                                                                                            |
| `cloudflared`   | Cloudflare Tunnel, dışarıya açılma yalnızca buradan olur                                                                                               |

`api`, `agent-worker` ve `coding-worker` ancak `migrate` başarıyla bittikten sonra başlar, yani şema her zaman koddan öndedir veya eşittir.

## 3. Trafik akışı

TLS Cloudflare kenarında sonlanır, tünelden gelen düz HTTP'yi Caddy karşılar. [deploy/Caddyfile](../deploy/Caddyfile) şu ayrımı yapar:

- `/api/*`, `/auth/*`, `/oidc/*`, `/.well-known/openid-configuration` ve webhook path'leri (`/integrations/github/webhook`, `/integrations/github/app-webhook`, `/integrations/grafana/webhook`) `api:4000`'e proxy'lenir. Express'in secure cookie'si için `X-Forwarded-Proto: https` başlığı eklenir.
- Geri kalan her şey SPA'dır (`try_files {path} /index.html`).

Caddyfile imaja gömülüdür ama compose onu volume ile ezer, yani Caddyfile değişikliği rebuild gerektirmez, `docker compose restart web` yeter.

## 4. Yapılandırma

Tüm servisler env'i `deploy/demo.env` dosyasından okur (şablonu `deploy/demo.env.example`). Bu dosya repoya commit edilmez. Cloudflared token'ı da aynı dosyadadır.

## 5. Güncelleme

```bash
git pull
docker compose -f docker-compose.demo.yml up -d --build
```

Build yeni imajları üretir, `migrate` şemayı ve seed'i tazeler, servisler yeni imajla yeniden başlar. Coding runtime kullanılıyorsa `coding-runner` imajının da host'ta build edilmiş ve `CODING_RUNNER_IMAGE`'ın onu göstermesi gerekir (bkz. [agents.md](agents.md)).
