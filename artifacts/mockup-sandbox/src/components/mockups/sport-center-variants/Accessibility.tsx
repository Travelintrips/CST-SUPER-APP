import React from "react";
import { 
  Trophy, 
  Zap, 
  Users, 
  Shield, 
  Clock, 
  Star, 
  ChevronRight, 
  ArrowRight,
  CheckCircle,
  MapPin,
  Phone,
  Mail,
  Menu,
  X
} from "lucide-react";

const features = [
  {
    icon: Trophy,
    title: "Lapangan Premium",
    desc: "Fasilitas berstandar internasional dengan peralatan terkini untuk pengalaman olahraga terbaik.",
  },
  {
    icon: Zap,
    title: "Booking Mudah",
    desc: "Reservasi lapangan cukup dalam hitungan detik, 24 jam sehari tanpa perlu antri.",
  },
  {
    icon: Users,
    title: "Komunitas Aktif",
    desc: "Bergabung dengan ribuan anggota aktif dan komunitas olahraga yang terus berkembang.",
  },
  {
    icon: Shield,
    title: "Keamanan Terjamin",
    desc: "Fasilitas dijaga 24 jam dengan CCTV dan petugas keamanan terlatih.",
  },
  {
    icon: Clock,
    title: "Buka Setiap Hari",
    desc: "Beroperasi dari pukul 06.00 hingga 22.00, tujuh hari seminggu termasuk hari libur.",
  },
  {
    icon: Star,
    title: "Rating Tertinggi",
    desc: "Dinilai 4.8/5 oleh lebih dari 2.000 pelanggan setia kami di seluruh Tangerang.",
  },
];

const facilities = [
  {
    id: "futsal-01",
    name: "Lapangan Futsal",
    description: "Lapangan futsal standar FIFA dengan rumput sintetis premium. Dilengkapi pencahayaan LED profesional dan sistem ventilasi modern.",
    pricePerHour: 150000,
    image: "https://images.unsplash.com/photo-1534012022718-d731de7e4811?w=800&auto=format&fit=crop&q=80",
    capacity: 14,
    amenities: ["Rumput Sintetis", "Lighting LED", "Ruang Ganti", "Parkir"],
    available: true,
    rating: 4.8,
    category: "Futsal",
  },
  {
    id: "badminton-01",
    name: "Lapangan Badminton",
    description: "Lapangan indoor dengan lantai vinyl profesional berstandar BWF. Tersedia 4 lapangan dengan net premium.",
    pricePerHour: 75000,
    image: "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=800&auto=format&fit=crop&q=80",
    capacity: 8,
    amenities: ["Indoor", "Vinyl Floor", "Shuttlecock Available", "Sewa Raket"],
    available: true,
    rating: 4.7,
    category: "Badminton",
  },
  {
    id: "basket-01",
    name: "Lapangan Basket",
    description: "Lapangan basket indoor dengan lantai parket resmi NBA. Dilengkapi papan skor digital dan sistem tata suara.",
    pricePerHour: 200000,
    image: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&auto=format&fit=crop&q=80",
    capacity: 20,
    amenities: ["Papan Skor Digital", "Sound System", "Ruang Ganti", "Parkir"],
    available: true,
    rating: 4.9,
    category: "Basket",
  },
  {
    id: "fitness-01",
    name: "Fitness Center",
    description: "Pusat kebugaran lengkap dengan peralatan cardio dan beban terkini. Tersedia personal trainer berpengalaman.",
    pricePerHour: 35000,
    image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80",
    capacity: 40,
    amenities: ["Personal Trainer", "Locker Room", "Shower", "WiFi", "Juice Bar"],
    available: true,
    rating: 4.7,
    category: "Gym",
  },
  {
    id: "tenis-01",
    name: "Lapangan Tenis",
    description: "Lapangan tenis outdoor dengan permukaan hard court berkualitas tinggi.",
    pricePerHour: 100000,
    image: "https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop&q=80",
    capacity: 4,
    amenities: ["Outdoor", "Hard Court", "Penerangan Malam", "Sewa Raket"],
    available: true,
    rating: 4.6,
    category: "Tenis",
  },
  {
    id: "yoga-01",
    name: "Studio Yoga",
    description: "Studio yoga ber-AC dengan lantai kayu hangat dan perlengkapan yoga lengkap. Cocok untuk semua level.",
    pricePerHour: 50000,
    image: "https://images.unsplash.com/photo-1599901860904-17e0ed3d8390?w=800&auto=format&fit=crop&q=80",
    capacity: 20,
    amenities: ["AC", "Matras Yoga", "Loker", "Shower", "Instruktur Tersedia"],
    available: true,
    rating: 4.8,
    category: "Yoga",
  },
];

const testimonials = [
  {
    id: "t1",
    name: "Budi Santoso",
    role: "Atlet Futsal",
    content: "Lapangan futsal di sini luar biasa! Rumput sintetisnya empuk dan pencahayaannya sempurna. Cocok banget buat latihan rutin tim kami.",
    rating: 5,
    avatar: "BS",
  },
  {
    id: "t2",
    name: "Sari Dewi",
    role: "Instruktur Yoga",
    content: "Studio yoga-nya nyaman banget! Peralatannya lengkap, AC sejuk, dan instrukturnya profesional. Booking online juga mudah!",
    rating: 5,
    avatar: "SD",
  },
  {
    id: "t3",
    name: "Ahmad Rizki",
    role: "Badminton Enthusiast",
    content: "Fasilitas badminton terbaik di area bandara. Lantai vinyl-nya bagus, dan staffnya sangat ramah. Pasti akan balik lagi!",
    rating: 4,
    avatar: "AR",
  },
];

export function Accessibility() {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-blue-200">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-slate-900 text-white px-4 py-2 rounded-md z-50 focus-visible:ring-4 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
        Lompat ke konten utama
      </a>

      {/* Navigation */}
      <header className="sticky top-0 z-40 bg-white border-b-2 border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center">
              <span className="text-2xl font-black tracking-tight text-slate-900">
                Sport Center <span aria-hidden="true">|</span> SHIA
              </span>
            </div>

            <nav className="hidden md:flex items-center gap-8" aria-label="Navigasi Utama">
              <a href="#" className="text-[17px] font-bold text-slate-900 hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-4 rounded px-2 py-1">Home</a>
              <a href="#fasilitas" className="text-[17px] font-bold text-slate-900 hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-4 rounded px-2 py-1">Fasilitas</a>
              <a href="#jadwal" className="text-[17px] font-bold text-slate-900 hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-4 rounded px-2 py-1">Jadwal</a>
              <a href="#tentang" className="text-[17px] font-bold text-slate-900 hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-4 rounded px-2 py-1">Tentang</a>
              <a href="#kontak" className="text-[17px] font-bold text-slate-900 hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-4 rounded px-2 py-1">Kontak</a>
              <a
                href="#booking"
                className="bg-slate-900 text-white px-6 py-3 min-h-[44px] min-w-[44px] rounded-md font-bold text-[17px] hover:bg-slate-800 focus-visible:ring-4 focus-visible:ring-slate-900 focus-visible:ring-offset-2 transition-colors flex items-center gap-2 border-2 border-transparent"
              >
                Booking Sekarang
              </a>
            </nav>

            <button 
              className="md:hidden p-3 -mr-3 rounded-md focus-visible:ring-4 focus-visible:ring-slate-900 focus-visible:ring-offset-2 border-2 border-slate-900"
              aria-label={isMenuOpen ? "Tutup menu" : "Buka menu"}
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-6 h-6 text-slate-900" aria-hidden="true" /> : <Menu className="w-6 h-6 text-slate-900" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <div className="md:hidden bg-slate-100 border-t-2 border-slate-900 px-4 py-4 space-y-4">
            <a href="#" className="block text-[17px] font-bold text-slate-900 p-3 bg-white border-2 border-slate-900 rounded focus-visible:ring-4 focus-visible:ring-slate-900">Home</a>
            <a href="#fasilitas" className="block text-[17px] font-bold text-slate-900 p-3 bg-white border-2 border-slate-900 rounded focus-visible:ring-4 focus-visible:ring-slate-900">Fasilitas</a>
            <a href="#jadwal" className="block text-[17px] font-bold text-slate-900 p-3 bg-white border-2 border-slate-900 rounded focus-visible:ring-4 focus-visible:ring-slate-900">Jadwal</a>
            <a href="#tentang" className="block text-[17px] font-bold text-slate-900 p-3 bg-white border-2 border-slate-900 rounded focus-visible:ring-4 focus-visible:ring-slate-900">Tentang</a>
            <a href="#kontak" className="block text-[17px] font-bold text-slate-900 p-3 bg-white border-2 border-slate-900 rounded focus-visible:ring-4 focus-visible:ring-slate-900">Kontak</a>
            <a href="#booking" className="block text-[17px] font-bold text-white bg-slate-900 p-3 border-2 border-transparent rounded focus-visible:ring-4 focus-visible:ring-slate-900 text-center">Booking Sekarang</a>
          </div>
        )}
      </header>

      <main id="main-content">
        {/* Hero Section */}
        <section className="relative bg-slate-900 py-16 sm:py-24 lg:py-32">
          {/* Background Image with Scrim for Contrast */}
          <div className="absolute inset-0 z-0">
            <img 
              src="https://images.unsplash.com/photo-1587280501635-68a0e82cd5ff?w=1600&auto=format&fit=crop&q=80" 
              alt="" 
              className="w-full h-full object-cover"
              aria-hidden="true"
            />
            {/* Very dark scrim to ensure text contrast >= 7:1 */}
            <div className="absolute inset-0 bg-slate-900/85"></div>
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 bg-white text-slate-900 px-4 py-2 rounded-md font-bold text-[17px] mb-8 border-2 border-transparent">
                <Trophy className="w-5 h-5" aria-hidden="true" />
                <span>Sport Center Terbaik di Area SHIA</span>
              </div>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight mb-6">
                Sport Center <br className="hidden sm:block" />Bandara Soekarno Hatta
              </h1>
              
              <p className="text-[19px] leading-[1.7] text-slate-100 mb-10 max-w-[65ch]">
                Tempat terbaik untuk olahraga, komunitas, dan gaya hidup sehat — tepat di jantung kawasan bandara internasional. Fasilitas lengkap, aman, dan dapat diakses oleh semua.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 mb-16">
                <a
                  href="#booking"
                  className="bg-white text-slate-900 px-8 py-4 min-h-[54px] rounded-md font-black text-[19px] hover:bg-slate-200 focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900 transition-colors flex items-center justify-center gap-3 border-4 border-transparent text-center"
                >
                  Booking Sekarang
                  <ArrowRight className="w-6 h-6" aria-hidden="true" />
                </a>
                <a
                  href="#fasilitas"
                  className="bg-transparent text-white px-8 py-4 min-h-[54px] rounded-md font-bold text-[19px] hover:bg-slate-800 focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900 transition-colors border-4 border-white flex items-center justify-center text-center"
                >
                  Lihat Fasilitas
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t-2 border-slate-700">
                <div className="bg-slate-800 p-4 rounded-md border-2 border-slate-700">
                  <div className="text-3xl font-black text-white mb-1">6+</div>
                  <div className="text-[17px] text-slate-200 font-bold">Jenis Fasilitas</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-md border-2 border-slate-700">
                  <div className="text-3xl font-black text-white mb-1">2K+</div>
                  <div className="text-[17px] text-slate-200 font-bold">Member Aktif</div>
                </div>
                <div className="bg-slate-800 p-4 rounded-md border-2 border-slate-700 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-3xl font-black text-white">4.8</span>
                    <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" aria-label="Bintang" />
                  </div>
                  <div className="text-[17px] text-slate-200 font-bold">Rating Rata-rata</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20 sm:py-24 bg-slate-50 border-b-2 border-slate-900" aria-labelledby="mengapa-kami">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16 max-w-3xl">
              <h2 id="mengapa-kami" className="text-4xl sm:text-5xl font-black text-slate-900 mb-6">
                Mengapa Kami?
              </h2>
              <p className="text-[19px] leading-[1.7] text-slate-800 max-w-[65ch]">
                Kami hadir untuk memberikan pengalaman olahraga terbaik dengan fasilitas modern, bersih, dan layanan prima untuk semua kalangan.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((f, i) => {
                const Icon = f.icon;
                return (
                  <div key={i} className="bg-white p-8 rounded-lg border-2 border-slate-900 shadow-[4px_4px_0px_0px_#0f172a] hover:shadow-[8px_8px_0px_0px_#0f172a] transition-all focus-within:ring-4 focus-within:ring-blue-600 focus-within:ring-offset-2">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="bg-slate-900 text-white p-4 rounded-md flex-shrink-0" aria-hidden="true">
                        <Icon className="w-8 h-8" />
                      </div>
                      <h3 className="text-2xl font-black text-slate-900 leading-tight">{f.title}</h3>
                    </div>
                    <p className="text-[17px] leading-[1.6] text-slate-800 font-medium">
                      {f.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Facilities Section */}
        <section id="fasilitas" className="py-20 sm:py-24 bg-white border-b-2 border-slate-900" aria-labelledby="fasilitas-kami">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16 max-w-3xl">
              <h2 id="fasilitas-kami" className="text-4xl sm:text-5xl font-black text-slate-900 mb-6">
                Fasilitas Kami
              </h2>
              <p className="text-[19px] leading-[1.7] text-slate-800 max-w-[65ch]">
                Pilihan lapangan olahraga berkualitas tinggi dengan tarif yang transparan. Semua harga sudah termasuk fasilitas standar.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {facilities.map((f) => (
                <div key={f.id} className="bg-slate-50 rounded-lg border-2 border-slate-900 overflow-hidden flex flex-col group focus-within:ring-4 focus-within:ring-blue-600 focus-within:ring-offset-2 shadow-[4px_4px_0px_0px_#0f172a]">
                  <div className="relative h-64 border-b-2 border-slate-900">
                    <img 
                      src={f.image} 
                      alt={`Foto fasilitas ${f.name}`} 
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-4 right-4 bg-white border-2 border-slate-900 px-3 py-1.5 rounded text-[17px] font-black text-slate-900 flex items-center gap-2">
                      <Star className="w-5 h-5 text-slate-900 fill-slate-900" aria-label={`Rating ${f.rating} dari 5`} />
                      <span aria-hidden="true">{f.rating}</span>
                    </div>
                  </div>
                  
                  <div className="p-6 flex-grow flex flex-col">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-slate-900 text-white text-[15px] font-bold px-3 py-1 rounded-sm">
                          {f.category}
                        </span>
                        {f.available && (
                          <span className="bg-white border-2 border-slate-900 text-slate-900 text-[15px] font-bold px-3 py-1 rounded-sm flex items-center gap-1.5">
                            <CheckCircle className="w-4 h-4" aria-hidden="true" />
                            Tersedia
                          </span>
                        )}
                      </div>
                      <h3 className="text-2xl font-black text-slate-900 mb-2">
                        {f.name}
                      </h3>
                      <p className="text-[17px] leading-[1.6] text-slate-800 font-medium line-clamp-3">
                        {f.description}
                      </p>
                    </div>

                    <div className="mb-6">
                      <h4 className="text-[15px] font-bold text-slate-900 uppercase tracking-wider mb-2">Fasilitas Termasuk:</h4>
                      <ul className="flex flex-wrap gap-2">
                        {f.amenities.map((amenity, i) => (
                          <li key={i} className="bg-white border border-slate-400 text-slate-900 px-2 py-1 text-[15px] font-medium rounded-sm">
                            {amenity}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-auto pt-6 border-t-2 border-slate-900 flex items-center justify-between">
                      <div>
                        <span className="block text-[15px] font-bold text-slate-800 uppercase">Tarif</span>
                        <span className="text-2xl font-black text-slate-900">
                          Rp {f.pricePerHour.toLocaleString('id-ID')}
                        </span>
                        <span className="text-[17px] font-bold text-slate-800">/jam</span>
                      </div>
                      <a 
                        href={`#booking-${f.id}`}
                        className="bg-slate-900 text-white px-6 py-3 min-h-[44px] rounded-md font-bold text-[17px] hover:bg-slate-800 focus-visible:ring-4 focus-visible:ring-blue-600 focus-visible:ring-offset-2 transition-colors inline-flex items-center gap-2"
                        aria-label={`Booking ${f.name} sekarang`}
                      >
                        Pilih <ChevronRight className="w-5 h-5" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials Section */}
        <section className="py-20 sm:py-24 bg-slate-50 border-b-2 border-slate-900" aria-labelledby="testimoni">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-16 max-w-3xl">
              <h2 id="testimoni" className="text-4xl sm:text-5xl font-black text-slate-900 mb-6">
                Testimoni Pengguna
              </h2>
              <p className="text-[19px] leading-[1.7] text-slate-800 max-w-[65ch]">
                Apa kata mereka yang telah menggunakan fasilitas kami. Penilaian nyata dari komunitas olahraga kami.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {testimonials.map((t) => (
                <div key={t.id} className="bg-white p-8 rounded-lg border-2 border-slate-900 shadow-[4px_4px_0px_0px_#0f172a]">
                  <div className="flex gap-1 mb-6" aria-label={`Rating ${t.rating} dari 5 bintang`}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-6 h-6 ${i < t.rating ? "text-slate-900 fill-slate-900" : "text-slate-300 fill-slate-300"}`}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <blockquote className="text-[19px] leading-[1.7] text-slate-800 font-medium mb-8">
                    "{t.content}"
                  </blockquote>
                  <div className="flex items-center gap-4 border-t-2 border-slate-200 pt-6">
                    <div className="w-14 h-14 bg-slate-900 rounded-full flex items-center justify-center text-white font-black text-xl flex-shrink-0" aria-hidden="true">
                      {t.avatar}
                    </div>
                    <div>
                      <div className="font-black text-[19px] text-slate-900">{t.name}</div>
                      <div className="text-[17px] font-bold text-slate-700">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-slate-900 py-20 sm:py-24 text-center px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-4xl sm:text-5xl font-black text-white mb-8 leading-tight">
              Siap Mulai Berolahraga?
            </h2>
            <p className="text-[19px] leading-[1.7] text-slate-200 mb-12 max-w-[65ch] mx-auto">
              Booking lapangan sekarang dan nikmati pengalaman olahraga premium bersama kami. Layanan pelanggan kami siap membantu Anda 24 jam.
            </p>
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-3 bg-white text-slate-900 px-10 py-5 min-h-[60px] rounded-md font-black text-[20px] hover:bg-slate-200 focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900 transition-colors border-4 border-transparent w-full sm:w-auto shadow-[4px_4px_0px_0px_#cbd5e1]"
            >
              Booking Sekarang
              <ArrowRight className="w-6 h-6" aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t-2 border-slate-900 py-12 text-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-12">
          <div>
            <span className="text-2xl font-black tracking-tight text-slate-900 block mb-6">
              Sport Center | SHIA
            </span>
            <p className="text-[17px] leading-[1.6] font-medium text-slate-800 mb-6 max-w-[40ch]">
              Pusat olahraga premium di kawasan Bandara Internasional Soekarno-Hatta. Fasilitas lengkap, dapat diakses semua kalangan.
            </p>
          </div>
          <div>
            <h3 className="text-[19px] font-black mb-6">Kontak</h3>
            <ul className="space-y-4">
              <li className="flex items-start gap-3 text-[17px] font-medium text-slate-800">
                <MapPin className="w-6 h-6 text-slate-900 flex-shrink-0" aria-hidden="true" />
                <span>Jl. Parameter Utara, Kawasan Bandara Soekarno-Hatta, Tangerang, Banten 15126</span>
              </li>
              <li className="flex items-center gap-3 text-[17px] font-medium text-slate-800">
                <Phone className="w-6 h-6 text-slate-900 flex-shrink-0" aria-hidden="true" />
                <a href="tel:+628112345678" className="hover:underline focus-visible:ring-2 focus-visible:ring-slate-900">+62 811 2345 678</a>
              </li>
              <li className="flex items-center gap-3 text-[17px] font-medium text-slate-800">
                <Mail className="w-6 h-6 text-slate-900 flex-shrink-0" aria-hidden="true" />
                <a href="mailto:info@sportcentershia.com" className="hover:underline focus-visible:ring-2 focus-visible:ring-slate-900">info@sportcentershia.com</a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-[19px] font-black mb-6">Aksesibilitas</h3>
            <p className="text-[17px] leading-[1.6] font-medium text-slate-800 mb-4">
              Kami berkomitmen untuk membuat website dan fasilitas kami dapat diakses oleh semua orang.
            </p>
            <a href="#kebijakan-aksesibilitas" className="inline-block text-[17px] font-bold text-slate-900 underline hover:no-underline focus-visible:ring-2 focus-visible:ring-slate-900 p-1">
              Baca Kebijakan Aksesibilitas Kami
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
