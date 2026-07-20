# Robinpepe ($RPEPE) — Airdrop Register

Robinhood Chain üzerinde Robinpepe memecoin airdrop kayıt sitesi.
Akış: X kullanıcı adı → X görevleri (follow / like / repost / comment) → cüzdan adresi → barkodlu **Airdrop Boarding Pass** (Download + Share on X).

## Yerelde çalıştırma

```bash
npm install
npm start
# http://localhost:3000
```

`DATABASE_URL` yoksa sunucu geçici bellek deposuyla çalışır (test için yeterli, kalıcı değildir).

## Ortam değişkenleri

Yerelde `.env` dosyasına yazılır (repo'da örnek: `.env.example`), Railway'de servisin **Variables** sekmesine girilir.

| Değişken | Zorunlu mu | Açıklama |
| --- | --- | --- |
| `DATABASE_URL` | Prod'da evet | Railway Postgres referansı: `${{Postgres.DATABASE_URL}}` |
| `ADMIN_KEY` | Export için | `/api/export?key=<ADMIN_KEY>` CSV indirme anahtarı |
| `PINNED_TWEET_ID` | Görevler için | Kampanya tweet ID'si (`x.com/robinpepega/status/<ID>`); boşsa like/repost/comment profili açar |
| `X_HANDLE` | Hayır | X kullanıcı adı, varsayılan `robinpepega` |
| `PORT` | Hayır | Railway otomatik verir; yerelde varsayılan 3000 |

Frontend bu ayarları `/api/config` endpoint'inden çeker; değişiklik için kod düzenlemek gerekmez.

## Railway'e deploy

1. Projeyi GitHub'a pushlayın (veya `railway init` ile bağlayın).
2. Railway'de **New Project → Deploy from GitHub repo** ile bu repoyu seçin.
3. Aynı projeye **PostgreSQL** ekleyin: *New → Database → PostgreSQL*.
4. Web servisinin **Variables** sekmesine yukarıdaki tablodan değişkenleri ekleyin (en az `DATABASE_URL`, `ADMIN_KEY`; kampanya tweeti atılınca `PINNED_TWEET_ID`).
5. Deploy tamamlanınca Railway'in verdiği domain'i açın. Tablo ilk açılışta otomatik oluşturulur.

## Deploy sonrası yapılacaklar

- **Logo:** `public/logo.jpeg` olarak eklendi. Değiştirmek isterseniz aynı isimle üzerine yazın (logo yoksa site 🐸 fallback gösterir).
- **Pinned tweet:** kampanya tweetini attıktan sonra `PINNED_TWEET_ID` değişkenini Railway'de (yerelde `.env`'de) doldurun; kod değişikliği gerekmez.

## Kayıtları indirme (airdrop listesi)

```
https://<domain>/api/export?key=<ADMIN_KEY>
```

CSV döner: `id, x_username, wallet, pass_code, created_at`.

## API

| Endpoint | Açıklama |
| --- | --- |
| `POST /api/register` | `{ x_username, wallet }` → pass üretir; aynı handle/cüzdan tekrar gelirse mevcut pass'i döner |
| `GET /api/stats` | Toplam kayıt sayısı |
| `GET /api/export?key=` | CSV export (ADMIN_KEY gerekli) |
| `GET /health` | Sağlık kontrolü |

Notlar: kullanıcı adı ve cüzdan benzersizdir (büyük/küçük harf duyarsız), IP başına 10 dakikada 20 kayıt denemesi sınırı vardır. X görevleri intent linkleriyle açılır ve birkaç saniyelik sayaçla "tamamlandı" işaretlenir (X API olmadan gerçek doğrulama yapılamaz).
