import React from "react";
import { Trophy, Zap, Users, Shield, Clock, Star, ChevronRight, MapPin } from "lucide-react";

export function Hierarchy() {
  const primaryColor = "blue-700";

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-700 selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 inset-x-0 bg-white/90 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-700 rounded-sm flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">SportCenter</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#" className="text-slate-900">Home</a>
            <a href="#mengapa" className="hover:text-slate-900 transition-colors">Mengapa Kami</a>
            <a href="#fasilitas" className="hover:text-slate-900 transition-colors">Fasilitas</a>
            <a href="#testimoni" className="hover:text-slate-900 transition-colors">Testimoni</a>
          </div>
          <button className="bg-blue-700 text-white px-6 py-2.5 rounded-sm font-semibold text-sm hover:bg-blue-800 transition-colors">
            Booking Sekarang
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-24 md:pt-48 md:pb-32 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-200 text-slate-700 rounded-full text-xs font-bold tracking-wide uppercase mb-8">
              <MapPin className="w-3.5 h-3.5" /> Area Bandara Soekarno-Hatta
            </div>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.1] mb-8 text-slate-900">
              Sport Center Bandara Soekarno Hatta
            </h1>
            <p className="text-xl text-slate-600 mb-12 max-w-lg leading-relaxed">
              Tempat terbaik untuk olahraga, komunitas, dan gaya hidup sehat — tepat di jantung kawasan bandara internasional.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-16">
              <button className="bg-blue-700 text-white px-8 py-4 rounded-sm font-bold text-lg hover:bg-blue-800 transition-colors flex items-center justify-center gap-2">
                Booking Sekarang <ChevronRight className="w-5 h-5" />
              </button>
              <button className="bg-white text-slate-900 border-2 border-slate-200 px-8 py-4 rounded-sm font-bold text-lg hover:border-slate-900 transition-colors flex items-center justify-center">
                Lihat Fasilitas
              </button>
            </div>
            
            <div className="grid grid-cols-3 gap-8 py-8 border-t border-slate-200">
              <div>
                <div className="text-4xl font-black text-slate-900 mb-1">6+</div>
                <div className="text-sm font-medium text-slate-500 uppercase tracking-wide">Jenis Fasilitas</div>
              </div>
              <div>
                <div className="text-4xl font-black text-slate-900 mb-1">2K+</div>
                <div className="text-sm font-medium text-slate-500 uppercase tracking-wide">Member Aktif</div>
              </div>
              <div>
                <div className="text-4xl font-black text-slate-900 mb-1">4.8</div>
                <div className="text-sm font-medium text-slate-500 uppercase tracking-wide">Rating</div>
              </div>
            </div>
          </div>
          
          <div className="relative aspect-[4/5] rounded-sm overflow-hidden bg-slate-200">
            <img 
              src="https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1600&auto=format&fit=crop&q=80" 
              alt="Sport Center" 
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Keunggulan */}
      <section id="mengapa" className="py-24 bg-white px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <div className="text-blue-700 font-bold tracking-widest text-sm mb-4">01 — MENGAPA KAMI?</div>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900">Keunggulan Utama</h2>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-16">
            {[
              { icon: Trophy, title: "Lapangan Premium", desc: "Fasilitas berstandar internasional dengan peralatan terkini untuk pengalaman olahraga terbaik." },
              { icon: Zap, title: "Booking Mudah", desc: "Reservasi lapangan cukup dalam hitungan detik, 24 jam sehari tanpa perlu antri." },
              { icon: Users, title: "Komunitas Aktif", desc: "Bergabung dengan ribuan anggota aktif dan komunitas olahraga yang terus berkembang." },
              { icon: Shield, title: "Keamanan Terjamin", desc: "Fasilitas dijaga 24 jam dengan CCTV dan petugas keamanan terlatih." },
              { icon: Clock, title: "Buka Setiap Hari", desc: "Beroperasi dari pukul 06.00 hingga 22.00, tujuh hari seminggu termasuk hari libur." },
              { icon: Star, title: "Rating Tertinggi", desc: "Dinilai 4.8/5 oleh lebih dari 2.000 pelanggan setia kami di seluruh Tangerang." }
            ].map((f, i) => (
              <div key={i} className="group">
                <div className="w-12 h-12 bg-slate-100 rounded-sm flex items-center justify-center mb-6 group-hover:bg-blue-700 group-hover:text-white transition-colors text-slate-700">
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{f.title}</h3>
                <p className="text-slate-600 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fasilitas */}
      <section id="fasilitas" className="py-24 bg-slate-50 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <div className="text-blue-700 font-bold tracking-widest text-sm mb-4">02 — FASILITAS KAMI</div>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Pilihan Lapangan</h2>
            <p className="text-xl text-slate-600 max-w-2xl">
              Fasilitas olahraga premium yang dirancang khusus untuk kenyamanan dan performa maksimal Anda.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                name: "Futsal",
                price: "Rp 150.000",
                rating: 4.8,
                cap: 14,
                tags: ["Rumput Sintetis", "LED Lighting"],
                img: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80"
              },
              {
                name: "Badminton",
                price: "Rp 75.000",
                rating: 4.7,
                cap: 8,
                tags: ["Vinyl Floor", "Sewa Raket"],
                img: "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=800&auto=format&fit=crop&q=80"
              },
              {
                name: "Basket",
                price: "Rp 200.000",
                rating: 4.9,
                cap: 20,
                tags: ["Parket NBA", "Papan Skor"],
                img: "https://images.unsplash.com/photo-1519861531473-9200262188bf?w=800&auto=format&fit=crop&q=80"
              },
              {
                name: "Fitness Center",
                price: "Rp 35.000",
                rating: 4.7,
                cap: 40,
                tags: ["Personal Trainer", "Locker Room"],
                img: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80"
              },
              {
                name: "Tenis",
                price: "Rp 100.000",
                rating: 4.8,
                cap: 4,
                tags: ["Outdoor", "Pencahayaan Malam"],
                img: "https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop&q=80"
              },
              {
                name: "Yoga Studio",
                price: "Rp 50.000",
                rating: 4.8,
                cap: 20,
                tags: ["AC", "Matras Yoga"],
                img: "https://images.unsplash.com/photo-1599901860904-17e6ed7083a0?w=800&auto=format&fit=crop&q=80"
              }
            ].map((f, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-sm overflow-hidden flex flex-col">
                <div className="aspect-[16/9] bg-slate-200 relative">
                  <img src={f.img} alt={f.name} className="w-full h-full object-cover" />
                  <div className="absolute top-4 right-4 bg-white px-2 py-1 rounded-sm text-xs font-bold flex items-center gap-1 shadow-sm">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> {f.rating}
                  </div>
                </div>
                <div className="p-6 flex flex-col flex-grow">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-2xl font-black text-slate-900">{f.name}</h3>
                    <div className="text-right">
                      <div className="text-lg font-bold text-blue-700">{f.price}</div>
                      <div className="text-xs text-slate-500 font-medium">/jam</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {f.tags.map((t, ti) => (
                      <span key={ti} className="bg-slate-100 text-slate-600 px-2 py-1 rounded-sm text-xs font-bold tracking-wide">
                        {t}
                      </span>
                    ))}
                    <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-sm text-xs font-bold tracking-wide flex items-center gap-1">
                      <Users className="w-3 h-3" /> Max {f.cap}
                    </span>
                  </div>
                  <button className="mt-auto w-full border-2 border-slate-200 text-slate-900 py-3 rounded-sm font-bold hover:border-slate-900 transition-colors">
                    Booking
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimoni */}
      <section id="testimoni" className="py-24 bg-white px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <div className="text-blue-700 font-bold tracking-widest text-sm mb-4">03 — TESTIMONI</div>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900">Kata Mereka</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-12">
            {[
              { name: "Budi Santoso", role: "Atlet Futsal", quote: "Lapangan futsal di sini luar biasa! Rumput sintetisnya empuk dan pencahayaannya sempurna. Cocok banget buat latihan rutin tim kami." },
              { name: "Sari Dewi", role: "Instruktur Yoga", quote: "Studio yoga-nya nyaman banget! Peralatannya lengkap, AC sejuk, dan instrukturnya profesional. Booking online juga mudah!" },
              { name: "Ahmad Rizki", role: "Badminton Enthusiast", quote: "Fasilitas badminton terbaik di area bandara. Lantai vinyl-nya bagus, dan staffnya sangat ramah. Pasti akan balik lagi!" }
            ].map((t, i) => (
              <div key={i} className="border-l-4 border-slate-200 pl-6 py-2">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, si) => (
                    <Star key={si} className="w-4 h-4 fill-slate-900 text-slate-900" />
                  ))}
                </div>
                <p className="text-lg text-slate-700 font-medium leading-relaxed mb-6">"{t.quote}"</p>
                <div>
                  <div className="font-bold text-slate-900">{t.name}</div>
                  <div className="text-sm text-slate-500 font-medium">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 bg-slate-900 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl md:text-6xl font-black text-white mb-8">Siap Mulai Berolahraga?</h2>
          <p className="text-xl text-slate-400 mb-12">
            Booking lapangan sekarang dan nikmati pengalaman olahraga premium bersama kami.
          </p>
          <button className="bg-blue-700 text-white px-10 py-5 rounded-sm font-bold text-xl hover:bg-blue-600 transition-colors inline-flex items-center gap-3">
            Booking Sekarang <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </section>

      {/* Footer minimal */}
      <footer className="bg-slate-950 py-12 px-6 border-t border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-700 rounded-sm flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">SportCenter</span>
          </div>
          <div className="text-slate-500 text-sm font-medium">
            &copy; {new Date().getFullYear()} Sport Center SHIA. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
