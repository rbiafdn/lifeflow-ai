# LifeFlow AI

Claude destekli kişisel yaşam yönetimi ve planlama asistanı. Günlük/haftalık program, akıllı zaman yönetimi, beklenmedik durumlarda otomatik yeniden planlama, alışkanlık ve hedef takibi, istatistikler ve doğal dilde komut alan bir asistan tek uygulamada.

**Canlı:** https://rbiafdn.github.io/lifeflow-ai/

Uygulama tamamen tarayıcıda çalışır: sunucu ve hesap yoktur, verilerin kullandığın tarayıcıda saklanır. Claude asistanı için kendi Anthropic API anahtarını Ayarlar'dan girersin; anahtar yalnızca tarayıcında durur ve doğrudan Anthropic'e gönderilir. Başka bir cihazda aynı veriyi görmek için Ayarlar › Veri'den JSON yedek alıp orada içe aktarırsın.

## Özellikler

- **Takvim**: gün / hafta / ay görünümü, sürükle-bırak, tekrarlayan görevler (tek örnek ↔ seri ayrımı), çakışma kontrolü, gün/hafta kopyalama, program şablonları
- **Akıllı zaman yönetimi**: sabit / esnek / öncelikli / opsiyonel / dinlenme zaman türleri, esneklik seviyesi, öncelik, son tarih, zorluk, erteleme sayısı
- **Otomatik yeniden planlama** (deterministik motor, `src/shared/planner`): görevi yapamadım, ertele, aralığı boşalt (misafir / ekstra iş), hafif hafta, biriken görevler için telafi planı, boş günü planla. Her senaryo *eski plan → yeni plan* önizlemesi, etkilenen görevler ve gerekçelerle sunulur; onaydan sonra uygulanır ve geri alınabilir.
- **AI asistan** (Claude, resmî `@anthropic-ai/sdk`): programı, ayarları, hedefleri bilen; salt-okunur araçlarla bağlam toplayan ve değişiklikleri yalnızca `propose_changes` aracıyla doğrulanmış operasyonlar olarak öneren asistan. Veriye doğrudan erişimi yoktur. Haftalık değerlendirme gerçek istatistiklerden üretilir.
- **Alışkanlıklar**: günlük / haftalık hedef, tamamlandı-atlandı-ertelendi, seri takibi (kaçırılan gün geçmişi silmez)
- **Hedefler ve öğrenme**: İngilizce, Astroloji, Yazılım ve özel alanlar; aşamalar, ders notları, kelime takibi
- **İstatistik**: günlük/haftalık/aylık başarı, kategori süreleri, alışkanlıklar, uyku
- **Veri**: değişiklik geçmişi (geri al / yeniden uygula), JSON & CSV dışa aktarma, JSON içe aktarma, tüm verileri silme
- Türkçe arayüz, açık / koyu tema, mobil uyumlu

## Teknolojiler

React 19 · TypeScript · Vite · Tailwind CSS 4 · Lucide · Recharts · React Router · Zod · Anthropic SDK · Vitest · GitHub Pages

## Yerel çalıştırma

```bash
npm install
npm run dev        # http://localhost:5201/lifeflow-ai/
```

## Testler ve yayın

```bash
npm test           # planlama motoru + çekirdek veri katmanı testleri
npm run deploy     # typecheck + test + build, ardından gh-pages dalına yayın
```

## Mimari notlar

- **Çekirdek** (`src/core`): tarayıcıda çalışan veri katmanı. `router.ts` arayüzün kullandığı `/api/...` yollarını çekirdek fonksiyonlara eşler; veri tek bir JSON belgesi olarak `localStorage`'da tutulur (testlerde bellek).
- **Operasyon katmanı** (`src/core/operations.ts`): görev değişiklikleri `create / update / delete` operasyonları olarak doğrulanır, önizlenir (çakışma simülasyonu dahil), atomik uygulanır ve ters operasyonlarıyla geçmişe yazılır.
- **Planlama motoru** (`src/shared/planner`): veriden bağımsız saf fonksiyonlar; boş dilim hesabı uyanma/uyku/iş saatleri ve yol süresini düşer, 10 dk tampon bırakır, dinlenme payını korur.
- **AI** (`src/core/ai`): sistem istemi önbelleğe alınır (prompt caching), günlük çağrı sınırı uygulanır, AI istekleri saklanmaz; yalnızca öneriler ve kullanım sayaçları tutulur. Model adı Ayarlar'dan değiştirilebilir (varsayılan `claude-opus-5-5`).
