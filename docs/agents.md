# Agent Çalışma Zamanı

Bu belge, agent'ların nasıl çalıştırıldığını anlatır: paylaşılan görev kuyruğu, iki çalışma zamanı (chat ve code), worker process'leri ve coding sandbox'ı.

## 1. Genel resim

Agent işleri API process'inde **çalışmaz**. API yalnızca görevi kuyruğa yazar, ayrı worker process'leri kuyruğu boşaltır:

```
apps/api           görevleri AgentTask kuyruğuna yazar (Postgres)
apps/agent-worker  runtime="chat" görevlerini process içinde çalıştırır
apps/coding-worker runtime="code" görevlerini görev başına bir Docker konteynerinde çalıştırır
```

Bu ayrımın iki nedeni vardır: ağır LLM tool döngüleri API event loop'unda HTTP isteklerinin önünü kesmesin, ve bir kullanıcının birikmiş işleri başkasınınkini bekletmesin. Kuyruk claim'i adildir ve kullanıcı başına üst sınır (user cap) uygular.

Kuyruk, worker döngüsü (`runWorkerLoop`) ve görev handler kayıtları `@feature/agents-backend` içindedir. Worker'lar birer ince entrypoint'tir: env okur, handler'ları kaydeder, açılışta yetim kalmış run/task'ları toparlar (önceki process ölmüşse), sonra döngüye girer. Tool registry process-local olduğu için agent-worker açılışta `registerAllTools()` çağırmak zorundadır, aksi halde skill'ler o process'te sıfır tool'a çözülür.

## 2. Chat çalışma zamanı (apps/agent-worker)

Chat agent'ları worker process'i içinde doğrudan çalışır. Sınırlar:

| Env                        | Varsayılan | Anlamı                                                                       |
| -------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `AGENT_WORKER_CONCURRENCY` | 10         | Aynı anda kaç chat run'ı çalışır                                             |
| `AGENT_WORKER_USER_CAP`    | 3          | Bir kullanıcının aynı anda tutabileceği slot sayısı                          |
| `AGENT_WORKER_IDLE_MS`     | 1000       | Kuyruk boşken poll aralığı                                                   |
| `AGENT_RUN_TIMEOUT_MS`     | 600000     | Run başına duvar saati tavanı, asılı kalan LLM çağrısı slotu süresiz tutamaz |
| `AGENT_CANCEL_POLL_MS`     | 3000       | API'den verilen Stop komutunun cross-process algılanma aralığı               |

## 3. Coding çalışma zamanı (apps/coding-worker + apps/coding-runner)

Bir coding agent, bağlı repoyu klonlar, üzerinde **Aider**'ı (model bağımsız kodlama agent'ı) çalıştırır ve draft PR açar. Güvenilmeyen shell/git yalnızca run başına açılan geçici Docker konteynerinin (`apps/coding-runner` imajı) içinde yaşar, ne API'de ne worker'da.

Coding-worker kendi process'ine `CODING_RUNTIME_ENABLED=1` set eder, `runCodingAgent` bu bayrak olmadan Docker başlatmayı reddeder. Yani coding çalıştırma sınırı bu process'tir.

**Runner sözleşmesi.** Konteyner stdin'den tek bir JSON payload alır (`spec` + `llmApiKey` + kısa ömürlü `gitToken`), stdout'a tek bir JSON sonuç satırı yazar, tüm loglar stderr'e gider. Sırlar argv veya env yerine stdin'de taşınır, böylece `ps` ve `docker inspect` çıktısında görünmezler.

**Sertleştirme.** Worker her konteyneri şu şekilde başlatır: gVisor runtime (`CODING_RUNNER_RUNTIME`, varsayılan `runsc`, yanlış yapılandırma daha güçlü izolasyona doğru başarısız olur), non-root kullanıcı, `--cap-drop=ALL`, read-only rootfs, tmpfs `/work` ve `/tmp`, pid/cpu/bellek limitleri ve zaman aşımı. Egress, yalnızca model sağlayıcısına ve GitHub'a izin veren bir allowlist ağıdır (`CODING_RUNNER_NETWORK`, varsayılan `none` kapalı tarafa düşer, yerel dev için `bridge`).

**Sıcak havuz.** İlk run konteyner açılış maliyeti ödemesin diye worker, stdin'de bekleyen hazır konteynerler tutar (`CODING_WARM_POOL_SIZE`, TTL ile geri dönüştürülür, böylece yeni deploy edilen imajı alırlar).

İlgili env değişkenleri:

| Env                                                                      | Varsayılan          | Anlamı                                                                                    |
| ------------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------------- |
| `CODING_RUNNER_IMAGE`                                                    | (zorunlu)           | Runner imaj tag'i, `docker build -t coding-runner:latest apps/coding-runner` ile üretilir |
| `CODING_RUNNER_NETWORK`                                                  | none                | Run konteynerinin ağı, üretimde egress allowlist                                          |
| `CODING_RUNNER_RUNTIME`                                                  | runsc               | Konteyner runtime'ı, gVisor yoksa boş bırakın                                             |
| `CODING_RUNNER_CPUS` / `MEMORY` / `PIDS_LIMIT`                           | 2 / 4g / 512        | Run başına limitler                                                                       |
| `CODING_RUNNER_TIMEOUT_MS`                                               | 1200000             | Run başına zaman aşımı                                                                    |
| `CODING_WORKER_CONCURRENCY`                                              | 3                   | Aynı anda kaç coding run'ı (her biri bir konteyner)                                       |
| `CODING_WORKER_USER_CAP`                                                 | 2                   | Kullanıcı başına eşzamanlı run tavanı                                                     |
| `CODING_WARM_POOL_SIZE` / `CODING_WARM_TTL_MS` / `CODING_WARM_HEALTH_MS` | 3 / 1800000 / 30000 | Sıcak havuz boyutu, TTL ve reaper aralığı                                                 |

**Maliyet.** Aider'ın kendi bütçe tavanı yoktur. Harcama üç şeyle sınırlanır: konteyner zaman aşımı, run öncesi kontrol edilen model başına günlük token tavanı ve agent başına model seçimi. Sert bir harcama tavanı gerekiyorsa `apiBase` arkasına bütçe kesen OpenAI uyumlu bir gateway konur.

## 4. Model anahtarları

LLM sağlayıcı API anahtarları env'den gelmez. AI admin sayfasından girilir, `APP_SECRET_MASTER_KEY` ile şifrelenip veritabanında tutulur. Coding run'ında agent'ın modeline ait anahtar payload içinde konteynere stdin ile geçer.

## 5. Sorun giderme

- Worker açılışta yetim run'ları failed'e çeker ve yetim task'ları serbest bırakır veya dead-letter'a atar, loglarda "Reconciled orphaned ..." satırları normaldir.
- Coding run'ları hiç başlamıyorsa önce `CODING_RUNNER_IMAGE` set mi ve imaj build edilmiş mi bakın, sonra ağın (`CODING_RUNNER_NETWORK`) GitHub'a ve sağlayıcıya egress verip vermediğine bakın (varsayılan `none` klonu bile engeller).
- Agent-worker'da skill'ler tool bulamıyorsa `registerAllTools()` çağrısının worker entrypoint'inde durduğundan emin olun.
