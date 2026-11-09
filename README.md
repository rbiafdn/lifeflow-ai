# LifeFlow AI

Claude destekli kişisel yaşam yönetimi ve planlama asistanı. Günlük/haftalık program, akıllı zaman yönetimi, beklenmedik durumlarda otomatik yeniden planlama, alışkanlık ve hedef takibi, istatistikler ve doğal dilde komut alan bir asistan tek uygulamada.

## Özellikler

- **Takvim**: gün / hafta / ay görünümü, sürükle-bırak, tekrarlayan görevler (tek örnek ↔ seri ayrımı), çakışma kontrolü, gün/hafta kopyalama, program şablonları
- **Akıllı zaman yönetimi**: sabit / esnek / öncelikli / opsiyonel / dinlenme zaman türleri, esneklik seviyesi, öncelik, son tarih, zorluk, erteleme sayısı
- **Otomatik yeniden planlama** (deterministik motor, `src/server/planner`): görevi yapamadım, ertele, aralığı boşalt (misafir / ekstra iş), hafif hafta, biriken görevler için telafi planı, boş günü planla. Her senaryo *eski plan → yeni plan* önizlemesi, etkilenen görevler ve gerekçelerle sunulur; onaydan sonra uygulanır ve geri alınabilir.
- **AI asistan** (Claude, resmî `@anthropic-ai/sdk`): programı, ayarları, hedefleri bilen; salt-okunur araçlarla bağlam toplayan ve değişiklikleri yalnızca `propose_changes` aracıyla doğrulanmış operasyonlar olarak öneren asistan. Veritabanına doğrudan erişimi yoktur. Haftalık değerlendirme gerçek istatistiklerden üretilir.
- **Alışkanlıklar**: günlük / haftalık hedef, tamamlandı-atlandı-ertelendi, seri takibi (kaçırılan gün geçmişi silmez)
- **Hedefler ve öğrenme**: İngilizce, Astroloji, Yazılım ve özel alanlar; aşamalar, ders notları, kelime takibi
- **İstatistik**: günlük/haftalık/aylık başarı, kategori süreleri, alışkanlıklar, uyku
- **Veri güvenliği**: JWT + httpOnly çerez, kullanıcı başına yalıtım, Zod doğrulama, değişiklik geçmişi (geri al / yeniden uygula), JSON & CSV dışa aktarma, JSON içe aktarma, hesap silme
- Türkçe arayüz, açık / koyu tema, mobil uyumlu

## Teknolojiler

React 19 · TypeScript · Vite · Tailwind CSS 4 · Lucide · Recharts · React Router — Express 5 · Prisma 6 · PostgreSQL · Anthropic SDK · Vitest

## Yerel çalıştırma

```bash
npm install
cp .env.example .env            # DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
npx prisma migrate deploy       # şemayı veritabanına uygula
npm run dev                     # API :5200 + web :5201
```

Tarayıcıda http://localhost:5201 adresini açın. Production benzeri çalıştırma: `npm run build && npm start` (API derlenmiş istemciyi :5200'den sunar).

## Testler

```bash
npm run test:db   # lifeflow_test veritabanına migrasyon
npm test          # planlama motoru + API entegrasyon testleri
```

## Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantısı |
| `JWT_SECRET` | En az 32 karakter rastgele dize |
| `ANTHROPIC_API_KEY` | Claude API anahtarı (yoksa asistan kapalı, planlama araçları çalışır) |
| `ANTHROPIC_MODEL` | Varsayılan `claude-opus-5-5` |
| `AI_DAILY_LIMIT` | Kullanıcı başına günlük AI çağrı sınırı (varsayılan 60) |
| `CLIENT_ORIGIN` | Ayrı origin'den istemci varsa CORS için (isteğe bağlı) |

## Dağıtım

Uygulama tek bir Node süreci olarak çalışır: `npm run build && npm start`. Node + PostgreSQL barındıran herhangi bir ortamda `DATABASE_URL`, `JWT_SECRET` ve `ANTHROPIC_API_KEY` tanımlanıp `npx prisma migrate deploy` çalıştırılması yeterlidir.

## Mimari notlar

- **Operasyon katmanı** (`src/server/services/operations.ts`): görev değişiklikleri `create / update / delete` operasyonları olarak doğrulanır, önizlenir (çakışma simülasyonu dahil), işlem içinde uygulanır ve ters operasyonlarıyla `ChangeSet` tablosuna yazılır.
- **Planlama motoru** (`src/server/planner`): veritabanından bağımsız saf fonksiyonlar; boş dilim hesabı uyanma/uyku/iş saatleri ve yol süresini düşer, 10 dk tampon bırakır, dinlenme payını korur.
- **AI** (`src/server/ai`): sistem istemi önbelleğe alınır (prompt caching), günlük çağrı sınırı uygulanır, AI istekleri saklanmaz; yalnızca öneriler (`AiProposal`) ve kullanım sayaçları tutulur.
