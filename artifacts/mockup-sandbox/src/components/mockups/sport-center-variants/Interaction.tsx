import React, { useState } from "react";
import { 
  Trophy, Zap, Users, Shield, Clock, Star, 
  ChevronRight, ArrowRight, Calendar, Activity, 
  CheckCircle2, MapPin, PlayCircle, MessageCircle 
} from "lucide-react";

const features = [
  {
    icon: Trophy,
    title: "Lapangan Premium",
    desc: "Fasilitas berstandar internasional dengan peralatan terkini untuk pengalaman olahraga terbaik.",
    color: "bg-blue-100 text-blue-700",
  },
  {
    icon: Zap,
    title: "Booking Mudah",
    desc: "Reservasi lapangan cukup dalam hitungan detik, 24 jam sehari tanpa perlu antri.",
    color: "bg-amber-100 text-amber-700",
  },
  {
    icon: Users,
    title: "Komunitas Aktif",
    desc: "Bergabung dengan ribuan anggota aktif dan komunitas olahraga yang terus berkembang.",
    color: "bg-emerald-100 text-emerald-700",
  },
  {
    icon: Shield,
    title: "Keamanan Terjamin",
    desc: "Fasilitas dijaga 24 jam dengan CCTV dan petugas keamanan terlatih.",
    color: "bg-purple-100 text-purple-700",
  },
  {
    icon: Clock,
    title: "Buka Setiap Hari",
    desc: "Beroperasi dari pukul 06.00 hingga 22.00, tujuh hari seminggu termasuk hari libur.",
    color: "bg-rose-100 text-rose-700",
  },
  {
    icon: Star,
    title: "Rating Tertinggi",
    desc: "Dinilai 4.8/5 oleh lebih dari 2.000 pelanggan setia kami di seluruh Tangerang.",
    color: "bg-yellow-100 text-yellow-700",
  },
];

const facilities = [
  {
    id: "futsal",
    name: "Lapangan Futsal",
    price: "Rp 150.000",
    image: "https://images.unsplash.com/photo-1536122985607-4ce00b283269?w=800&auto=format&fit=crop&q=80",
    rating: 4.8,
    capacity: 14,
    amenities: ["Rumput Sintetis", "Lighting LED"],
    available: true,
  },
  {
    id: "badminton",
    name: "Lapangan Badminton",
    price: "Rp 75.000",
    image: "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=800&auto=format&fit=crop&q=80",
    rating: 4.7,
    capacity: 8,
    amenities: ["Vinyl Floor", "Net Premium"],
    available: true,
  },
  {
    id: "basket",
    name: "Lapangan Basket",
    price: "Rp 200.000",
    image: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&auto=format&fit=crop&q=80",
    rating: 4.9,
    capacity: 20,
    amenities: ["Lantai Parket", "Papan Skor Digital"],
    available: false,
  },
  {
    id: "fitness",
    name: "Fitness Center",
    price: "Rp 35.000",
    image: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80",
    rating: 4.7,
    capacity: 40,
    amenities: ["Alat Cardio", "Free Weights"],
    available: true,
  },
  {
    id: "tenis",
    name: "Lapangan Tenis",
    price: "Rp 100.000",
    image: "https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop&q=80",
    rating: 4.6,
    capacity: 4,
    amenities: ["Hard Court", "Pencahayaan Terang"],
    available: true,
  },
  {
    id: "yoga",
    name: "Studio Yoga",
    price: "Rp 50.000",
    image: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&auto=format&fit=crop&q=80",
    rating: 4.8,
    capacity: 20,
    amenities: ["Lantai Kayu", "Full AC"],
    available: false,
  },
];

const testimonials = [
  {
    id: 1,
    name: "Budi Santoso",
    role: "Atlet Futsal",
    content: "Lapangan futsal di sini luar biasa! Rumput sintetisnya empuk dan pencahayaannya sempurna. Cocok banget buat latihan rutin tim kami.",
    rating: 5,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
  },
  {
    id: 2,
    name: "Sari Dewi",
    role: "Instruktur Yoga",
    content: "Studio yoga-nya nyaman banget! Peralatannya lengkap, AC sejuk, dan instrukturnya profesional. Booking online juga mudah!",
    rating: 5,
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&auto=format&fit=crop&q=80",
  },
  {
    id: 3,
    name: "Ahmad Rizki",
    role: "Badminton Enthusiast",
    content: "Fasilitas badminton terbaik di area bandara. Lantai vinyl-nya bagus, dan staffnya sangat ramah. Pasti akan balik lagi!",
    rating: 4,
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
  },
];

const sportsChips = ["Futsal", "Badminton", "Basket", "Fitness", "Tenis", "Yoga"];
const daysChips = ["Hari Ini", "Besok", "Lusa"];

export function Interaction() {
  const [activeSport, setActiveSport] = useState("Futsal");
  const [activeDay, setActiveDay] = useState("Hari Ini");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-200">
      
      {/* Navbar Mockup */}
      <nav className="sticky top-0 z-50 bg-white border-b-2 border-slate-900 shadow-[0_4px_0_0_#0f172a] px-4 py-3 flex items-center justify-between">
        <div className="font-black text-xl tracking-tight flex items-center gap-2 cursor-pointer hover:opacity-80">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center border-2 border-slate-900 shadow-[2px_2px_0_0_#0f172a]">
            <Activity className="w-5 h-5 text-white" />
          </div>
          SHIA Sport
        </div>
        <div className="hidden md:flex items-center gap-6 font-bold text-slate-700">
          <a href="#" className="hover:text-indigo-600 hover:underline underline-offset-4 decoration-2">Home</a>
          <a href="#fasilitas" className="hover:text-indigo-600 hover:underline underline-offset-4 decoration-2">Fasilitas</a>
          <a href="#mengapa" className="hover:text-indigo-600 hover:underline underline-offset-4 decoration-2">Mengapa Kami</a>
        </div>
        <button className="bg-emerald-400 border-2 border-slate-900 font-bold px-4 py-2 rounded shadow-[4px_4px_0_0_#0f172a] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#0f172a] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">
          Login / Daftar
        </button>
      </nav>

      {/* Hero Section */}
      <header className="relative pt-12 pb-24 px-4 overflow-hidden border-b-2 border-slate-900 bg-indigo-50">
        <div className="absolute inset-0 z-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#0f172a 2px, transparent 2px)', backgroundSize: '32px 32px' }}></div>
        
        <div className="max-w-5xl mx-auto relative z-10 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-300 border-2 border-slate-900 font-bold text-sm rounded-full shadow-[2px_2px_0_0_#0f172a] mb-6 transform -rotate-2">
              <Star className="w-4 h-4 fill-slate-900" /> 4.8 Rating Terverifikasi
            </div>
            
            <h1 className="text-5xl lg:text-7xl font-black leading-tight mb-6 tracking-tight">
              Sport Center <span className="text-indigo-600 underline decoration-wavy decoration-indigo-300 underline-offset-8">Bandara Soekarno Hatta</span>
            </h1>
            
            <p className="text-xl font-medium text-slate-700 mb-8 max-w-lg border-l-4 border-indigo-500 pl-4">
              Tempat terbaik untuk olahraga, komunitas, dan gaya hidup sehat — tepat di jantung kawasan bandara internasional.
            </p>

            {/* Quick Pick Interactions */}
            <div className="bg-white p-5 rounded-xl border-2 border-slate-900 shadow-[6px_6px_0_0_#0f172a] mb-8">
              <p className="font-bold mb-3 flex items-center gap-2"><Activity className="w-5 h-5"/> Pilih Olahraga:</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {sportsChips.map(sport => (
                  <button 
                    key={sport}
                    onClick={() => setActiveSport(sport)}
                    className={`px-3 py-1.5 rounded-full border-2 border-slate-900 font-bold text-sm transition-all ${
                      activeSport === sport 
                        ? 'bg-indigo-600 text-white shadow-[inset_0_3px_0_0_rgba(0,0,0,0.2)]' 
                        : 'bg-white hover:bg-slate-100 shadow-[2px_2px_0_0_#0f172a] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#0f172a]'
                    }`}
                  >
                    {sport}
                  </button>
                ))}
              </div>

              <p className="font-bold mb-3 flex items-center gap-2"><Calendar className="w-5 h-5"/> Kapan?</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {daysChips.map(day => (
                  <button 
                    key={day}
                    onClick={() => setActiveDay(day)}
                    className={`px-3 py-1.5 rounded-full border-2 border-slate-900 font-bold text-sm transition-all ${
                      activeDay === day 
                        ? 'bg-emerald-400 text-slate-900 shadow-[inset_0_3px_0_0_rgba(0,0,0,0.2)]' 
                        : 'bg-white hover:bg-slate-100 shadow-[2px_2px_0_0_#0f172a] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0_0_#0f172a]'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>

              <button className="w-full bg-emerald-400 border-2 border-slate-900 font-black text-lg px-6 py-4 rounded-lg shadow-[4px_4px_0_0_#0f172a] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#0f172a] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-center gap-2 group">
                Cari Jadwal {activeSport}
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="flex items-center gap-4 text-sm font-bold">
              <a href="#fasilitas" className="flex items-center gap-1 hover:text-indigo-600 group">
                <PlayCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                Lihat Semua Fasilitas
              </a>
            </div>
          </div>
          
          <div className="relative hidden md:block">
            <div className="absolute inset-0 bg-indigo-600 border-2 border-slate-900 rounded-2xl transform translate-x-4 translate-y-4"></div>
            <img 
              src="https://images.unsplash.com/photo-1587280501635-68a0e82cd5ff?w=1000&auto=format&fit=crop&q=80" 
              alt="Sport Center" 
              className="relative z-10 rounded-2xl border-2 border-slate-900 object-cover w-full h-[500px] hover:-translate-y-2 transition-transform duration-300 cursor-pointer"
            />
            {/* Floating Stats */}
            <div className="absolute top-10 -left-10 z-20 bg-white border-2 border-slate-900 p-4 rounded-xl shadow-[4px_4px_0_0_#0f172a] animate-bounce" style={{ animationDuration: '3s' }}>
              <p className="text-3xl font-black text-indigo-600">6+</p>
              <p className="font-bold text-sm">Fasilitas</p>
            </div>
            <div className="absolute bottom-10 -right-5 z-20 bg-white border-2 border-slate-900 p-4 rounded-xl shadow-[4px_4px_0_0_#0f172a] animate-bounce" style={{ animationDuration: '4s', animationDelay: '1s' }}>
              <p className="text-3xl font-black text-emerald-500">2K+</p>
              <p className="font-bold text-sm">Member Aktif</p>
            </div>
          </div>
        </div>
      </header>

      {/* Features */}
      <section id="mengapa" className="py-20 px-4 border-b-2 border-slate-900 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12">
            <h2 className="text-4xl font-black mb-4 inline-block relative">
              Mengapa Kami?
              <div className="absolute bottom-1 left-0 w-full h-3 bg-amber-300 -z-10 transform -rotate-1"></div>
            </h2>
            <p className="text-lg font-medium text-slate-600">Keunggulan bermain di Sport Center SHIA</p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, idx) => (
              <div 
                key={idx} 
                className="group p-6 bg-white border-2 border-slate-900 rounded-xl shadow-[4px_4px_0_0_#0f172a] hover:-translate-y-1 hover:shadow-[6px_6px_0_0_#0f172a] transition-all cursor-pointer relative overflow-hidden"
              >
                <div className={`w-14 h-14 rounded-lg flex items-center justify-center mb-4 border-2 border-slate-900 ${feature.color}`}>
                  <feature.icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold mb-2 flex items-center justify-between">
                  {feature.title}
                  <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </h3>
                <p className="font-medium text-slate-600">{feature.desc}</p>
                <div className="absolute inset-0 border-2 border-transparent group-active:border-indigo-500 rounded-xl transition-colors pointer-events-none"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Facilities */}
      <section id="fasilitas" className="py-20 px-4 border-b-2 border-slate-900 bg-slate-100">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 flex justify-between items-end">
            <div>
              <h2 className="text-4xl font-black mb-4 inline-block relative">
                Fasilitas Kami
                <div className="absolute bottom-1 left-0 w-full h-3 bg-indigo-300 -z-10 transform -rotate-1"></div>
              </h2>
              <p className="text-lg font-medium text-slate-600">Pilih lapangan dan booking sekarang juga</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {facilities.map((fac) => (
              <div 
                key={fac.id} 
                className="bg-white rounded-2xl border-2 border-slate-900 shadow-[6px_6px_0_0_#0f172a] flex flex-col overflow-hidden group hover:-translate-y-2 hover:shadow-[10px_10px_0_0_#0f172a] transition-all"
              >
                {/* Image Area with Badge */}
                <div className="relative h-48 border-b-2 border-slate-900 overflow-hidden cursor-pointer">
                  <img src={fac.image} alt={fac.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  
                  {fac.available ? (
                    <div className="absolute top-3 right-3 bg-emerald-400 text-slate-900 font-bold px-3 py-1 rounded-full text-sm border-2 border-slate-900 flex items-center gap-1 shadow-[2px_2px_0_0_#0f172a]">
                      <div className="w-2 h-2 rounded-full bg-slate-900 animate-pulse"></div>
                      Tersedia
                    </div>
                  ) : (
                    <div className="absolute top-3 right-3 bg-rose-400 text-slate-900 font-bold px-3 py-1 rounded-full text-sm border-2 border-slate-900 flex items-center gap-1 shadow-[2px_2px_0_0_#0f172a]">
                      <Clock className="w-3 h-3" />
                      Penuh - Buka 18:00
                    </div>
                  )}

                  <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur text-slate-900 font-bold px-2 py-1 rounded text-sm border-2 border-slate-900 flex items-center gap-1">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-500" /> {fac.rating}
                  </div>
                </div>

                {/* Content Area */}
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-black group-hover:text-indigo-600 transition-colors cursor-pointer">{fac.name}</h3>
                  </div>
                  
                  <p className="text-lg font-bold text-indigo-600 mb-4">{fac.price} <span className="text-sm text-slate-500 font-medium">/ jam</span></p>
                  
                  <div className="flex flex-wrap gap-2 mb-6">
                    <span className="px-2 py-1 bg-slate-100 border-2 border-slate-300 rounded font-bold text-xs text-slate-600 flex items-center gap-1">
                      <Users className="w-3 h-3" /> Max {fac.capacity}
                    </span>
                    {fac.amenities.map(amenity => (
                      <span key={amenity} className="px-2 py-1 bg-slate-100 border-2 border-slate-300 rounded font-bold text-xs text-slate-600">
                        {amenity}
                      </span>
                    ))}
                  </div>

                  {/* Explicit Action Area */}
                  <div className="mt-auto pt-4 border-t-2 border-slate-100 border-dashed">
                    <button className={`w-full font-bold px-4 py-3 rounded-lg border-2 border-slate-900 transition-all flex items-center justify-center gap-2 ${
                      fac.available 
                      ? 'bg-emerald-400 hover:bg-emerald-300 shadow-[3px_3px_0_0_#0f172a] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_#0f172a] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none' 
                      : 'bg-slate-200 text-slate-500 cursor-not-allowed shadow-[1px_1px_0_0_#cbd5e1]'
                    }`}>
                      {fac.available ? (
                        <>Booking Sekarang <ChevronRight className="w-5 h-5" /></>
                      ) : (
                        <>Cek Jadwal Lain</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 border-b-2 border-slate-900 bg-amber-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-black mb-12 text-center">Testimoni Member</h2>
          
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testi) => (
              <div key={testi.id} className="bg-white p-6 rounded-2xl border-2 border-slate-900 shadow-[4px_4px_0_0_#0f172a] relative">
                {/* Visual quote mark */}
                <div className="absolute top-4 right-4 text-6xl text-amber-200 font-serif leading-none h-10 select-none">"</div>
                
                <div className="flex gap-1 mb-4 relative z-10">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-5 h-5 ${i < testi.rating ? 'fill-yellow-400 text-yellow-500' : 'fill-slate-200 text-slate-300'}`} />
                  ))}
                </div>
                
                <p className="font-medium text-slate-700 mb-6 relative z-10 text-lg">
                  {testi.content}
                </p>
                
                <div className="flex items-center gap-4 mt-auto border-t-2 border-slate-100 pt-4 cursor-pointer group">
                  <img src={testi.avatar} alt={testi.name} className="w-12 h-12 rounded-full border-2 border-slate-900 group-hover:scale-110 transition-transform" />
                  <div>
                    <h4 className="font-black group-hover:text-indigo-600 transition-colors">{testi.name}</h4>
                    <p className="text-sm font-bold text-slate-500">{testi.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Strip */}
      <section className="py-24 px-4 bg-indigo-600 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#ffffff 2px, transparent 2px)', backgroundSize: '32px 32px' }}></div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h2 className="text-5xl font-black mb-6">Siap Mulai Berolahraga?</h2>
          <p className="text-xl font-medium mb-10 opacity-90 max-w-2xl mx-auto">
            Booking lapangan sekarang dan nikmati pengalaman olahraga premium bersama komunitas aktif kami.
          </p>
          <button className="bg-yellow-400 text-slate-900 border-2 border-slate-900 font-black text-2xl px-10 py-5 rounded-xl shadow-[6px_6px_0_0_#0f172a] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[4px_4px_0_0_#0f172a] active:translate-x-[6px] active:translate-y-[6px] active:shadow-none transition-all inline-flex items-center gap-3 group">
            Booking Sekarang 
            <span className="bg-slate-900 text-white rounded-full p-1 group-hover:translate-x-2 transition-transform">
              <ArrowRight className="w-6 h-6" />
            </span>
          </button>
        </div>
      </section>

      {/* Floating Action Button (Sticky Booking Rail) */}
      <div className="fixed bottom-6 right-6 z-50 animate-bounce" style={{ animationDuration: '3s' }}>
        <button className="bg-emerald-400 text-slate-900 border-2 border-slate-900 font-black px-6 py-4 rounded-full shadow-[4px_4px_0_0_#0f172a] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_#0f172a] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6" />
          <span className="hidden md:inline">Booking Cepat</span>
        </button>
      </div>

    </div>
  );
}
