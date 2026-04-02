# 🎲 Raffle Draw Website

Website raffle profesional yang membaca data langsung dari `TICKET_TRACKER.xlsx`.

## 📁 Struktur File

```
raffle-website/
├── index.html           ← Halaman utama
├── style.css            ← Styling
├── script.js            ← Logika draw & baca Excel
├── TICKET_TRACKER.xlsx  ← Data tiket (ganti ini setiap hari)
└── README.md
```

## 🚀 Deploy ke GitHub Pages

1. Buat repository baru di GitHub
2. Upload semua file ini ke repo
3. Pergi ke **Settings → Pages**
4. Set Source: **Deploy from branch → main → / (root)**
5. Klik Save — website akan live dalam 1-2 menit

## 🔄 Update Data Harian

Cukup replace file `TICKET_TRACKER.xlsx` di repository GitHub dengan file terbaru.
Website otomatis baca data terbaru (ada cache-buster agar tidak stuck di versi lama).

## 📊 Format Excel yang Didukung

Sheet **"Streak"** (diutamakan):
- Kolom B: Nama peserta (mulai baris 5)
- Kolom terakhir: `TOTAL TIKET` (dihitung otomatis dari streak + bonus)

Sheet **"List Ticket"** (fallback):
- Tiket dihitung dari kolom tanggal (0/1 deposit harian)

## ✨ Fitur

- ✅ Membaca Excel langsung tanpa backend
- ✅ Draw single atau multiple winners
- ✅ Animasi rolling nama peserta
- ✅ Confetti saat pemenang terpilih
- ✅ Highlight pemenang di tabel
- ✅ Reset untuk draw ulang
- ✅ Probabilitas menang ditampilkan per peserta
- ✅ Responsive (mobile-friendly)
- ✅ Dark mode premium design

## 🎨 Tech Stack

- HTML5 + CSS3 + Vanilla JavaScript
- [SheetJS](https://sheetjs.com/) untuk membaca Excel
- Google Fonts (Syne + DM Sans)
- Zero dependencies lain!
