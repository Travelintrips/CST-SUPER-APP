const PV_CSS = "@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&display=swap');\n\n.theme-paper-vermilion {\n  --bg-paper: #F6F4F0;\n  --text-ink: #111111;\n  --accent-vermilion: #E3342F;\n  --line-faint: rgba(17, 17, 17, 0.12);\n  --line-strong: rgba(17, 17, 17, 0.8);\n  \n  --font-serif: 'Cormorant Garamond', serif;\n  --font-sans: 'DM Sans', sans-serif;\n  \n  background-color: var(--bg-paper);\n  color: var(--text-ink);\n  font-family: var(--font-sans);\n  \n  /* Add paper texture via noise */\n  position: relative;\n}\n\n.theme-paper-vermilion::before {\n  content: \"\";\n  position: fixed;\n  top: 0; left: 0; width: 100vw; height: 100vh;\n  background-image: url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.04'/%3E%3C/svg%3E\");\n  pointer-events: none;\n  z-index: 50;\n  opacity: 0.8;\n}\n\n.pv-serif {\n  font-family: var(--font-serif);\n}\n\n.pv-sans {\n  font-family: var(--font-sans);\n}\n\n.pv-bg {\n  background-color: var(--bg-paper);\n}\n\n.pv-ink {\n  color: var(--text-ink);\n}\n\n.pv-vermilion {\n  color: var(--accent-vermilion);\n}\n\n.pv-bg-vermilion {\n  background-color: var(--accent-vermilion);\n}\n\n.pv-border-faint {\n  border-color: var(--line-faint);\n}\n\n.pv-border-strong {\n  border-color: var(--line-strong);\n}\n\n.pv-stamp {\n  width: 4rem;\n  height: 4rem;\n  border-radius: 50%;\n  background-color: var(--accent-vermilion);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  color: #fff;\n  font-family: var(--font-serif);\n  font-weight: 700;\n  font-size: 1.5rem;\n  line-height: 1;\n  letter-spacing: -0.05em;\n  transform: rotate(-12deg);\n}\n\n.pv-hairline-t { border-top: 1px solid var(--line-faint); }\n.pv-hairline-b { border-bottom: 1px solid var(--line-faint); }\n.pv-hairline-l { border-left: 1px solid var(--line-faint); }\n.pv-hairline-r { border-right: 1px solid var(--line-faint); }\n\n/* Animation utilities */\n@keyframes pv-fade-up {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n@keyframes pv-reveal-line {\n  from { transform: scaleX(0); }\n  to { transform: scaleX(1); }\n}\n\n@keyframes pv-stamp-press {\n  0% { opacity: 0; transform: scale(1.5) rotate(0deg); }\n  50% { opacity: 1; transform: scale(0.9) rotate(-15deg); }\n  100% { opacity: 1; transform: scale(1) rotate(-12deg); }\n}\n\n.animate-pv-fade-up {\n  animation: pv-fade-up 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;\n}\n\n.animate-pv-line {\n  transform-origin: left;\n  animation: pv-reveal-line 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;\n}\n\n.animate-pv-stamp {\n  animation: pv-stamp-press 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;\n}\n\n.delay-100 { animation-delay: 100ms; }\n.delay-200 { animation-delay: 200ms; }\n.delay-300 { animation-delay: 300ms; }\n.delay-400 { animation-delay: 400ms; }\n.delay-500 { animation-delay: 500ms; }\n.delay-600 { animation-delay: 600ms; }\n.delay-700 { animation-delay: 700ms; }\n.delay-1000 { animation-delay: 1000ms; }\n\n.pv-circle-text {\n  /* We will implement circular text using SVG in the component */\n}\n";
import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';

// Template-only binary assets are intentionally excluded from git. Keep this
// preview self-contained with a neutral data-only fallback.
const imgFallback = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'>" +
  "<rect width='800' height='600' fill='#eeeae2'/>" +
  "<circle cx='400' cy='270' r='90' fill='#e3342f' opacity='.18'/>" +
  "<path d='M290 280c55-70 165-70 220 0-55 65-165 65-220 0Z' fill='#fff' stroke='#333' stroke-width='8'/>" +
  "<path d='M300 275h200' stroke='#e3342f' stroke-width='16'/>" +
  "<text x='400' y='480' text-anchor='middle' font-family='sans-serif' font-size='28' fill='#333'>KAI</text>" +
  "</svg>"
);
const imgNigiriMaguro = imgFallback;
const imgNigiriSake = imgFallback;
const imgNigiriEbi = imgFallback;
const imgNigiriUni = imgFallback;
const imgNigiriTamago = imgFallback;
const imgSushiChef = imgFallback;
const imgCourseSakizuke = imgFallback;
const imgCourseSashimi = imgFallback;
const imgCourseYakimono = imgFallback;
const imgCourseNigiri = imgFallback;
const imgCourseWanmono = imgFallback;
const imgCourseKanmi = imgFallback;
const imgGallery3Interior = imgFallback;
const imgGallery3Hands = imgFallback;
const imgGallery3Sake = imgFallback;
const imgGallery3Wasabi = imgFallback;
const imgGallery3Nigiri = imgFallback;


// Circular Text Component using SVG
const CircularText = ({ text, radius = 50 }: { text: string, radius?: number }) => {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full animate-[spin_20s_linear_infinite]">
      <path
        id="circlePath"
        d={`M 60, 60 m -${radius}, 0 a ${radius},${radius} 0 1,1 ${radius * 2},0 a ${radius},${radius} 0 1,1 -${radius * 2},0`}
        fill="none"
      />
      <text className="pv-sans text-[10px] uppercase tracking-[0.3em] pv-ink fill-current">
        <textPath href="#circlePath" startOffset="0%">
          {text}
        </textPath>
      </text>
    </svg>
  );
};

export function FloatingNigiri() {
  const [scrolled, setScrolled] = useState(false);
  
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Intersection Observer for scroll reveals
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('opacity-100');
          entry.target.classList.remove('opacity-0', 'translate-y-8');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal-on-scroll').forEach(el => observer.observe(el));
    
    return () => observer.disconnect();
  }, []);

  return (
    <div className="theme-paper-vermilion min-h-screen w-full overflow-hidden flex flex-col selection:bg-[#E3342F] selection:text-[#F6F4F0]">
      
      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${scrolled ? 'py-4 bg-[#F6F4F0]/90 backdrop-blur-md pv-hairline-b' : 'py-8'}`}>
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center">
          <div className="pv-serif text-2xl font-bold tracking-widest uppercase flex items-center gap-2">
            KAI
            <span className="w-1.5 h-1.5 rounded-full bg-[#E3342F] inline-block mb-1"></span>
          </div>
          <div className="pv-sans text-xs uppercase tracking-widest font-medium">
            Opening Fall 2024
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-24 pb-20 md:pt-32 md:pb-24 px-6 md:px-12 max-w-7xl mx-auto w-full min-h-[85vh] flex flex-col items-center justify-center border-x border-[#1111111f]">
        
        {/* Subtle Washi Paper Overlays for Hero */}
        <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden">
          {/* Large cloudy fibers */}
          <div className="absolute inset-0 mix-blend-multiply opacity-[0.06]" 
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='washi1'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23washi1)'/%3E%3C/svg%3E")` }}>
          </div>
          {/* Fine grain */}
          <div className="absolute inset-0 mix-blend-multiply opacity-[0.04]" 
               style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='washi2'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23washi2)'/%3E%3C/svg%3E")` }}>
          </div>
          {/* Fading bottom edge so texture blends out gracefully into the rest of the flat page */}
          <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#F6F4F0] to-transparent"></div>
        </div>

        {/* Floating Nigiri Elements */}
        <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden md:overflow-visible">
          
          {/* Top left (under text) */}
          <div className="absolute top-[6%] left-[-5%] md:left-[10%] w-48 h-48 md:w-64 md:h-64 opacity-0 animate-pv-fade-up delay-75 z-0 pointer-events-auto">
             <img src={imgNigiriMaguro} alt="Tuna Nigiri" className="w-full h-full object-contain drop-shadow-[0_20px_25px_rgba(0,0,0,0.15)] -rotate-12 hover:-rotate-[6deg] hover:scale-[1.03] transition-transform duration-300 ease-out brightness-[0.85] contrast-[1.1] saturate-[1.15]" />
          </div>
          
          {/* Top right (over text) */}
          <div className="absolute top-[12%] right-[-5%] md:right-[15%] w-40 h-40 md:w-56 md:h-56 opacity-0 animate-pv-fade-up delay-150 z-20 pointer-events-auto">
             <img src={imgNigiriSake} alt="Salmon Nigiri" className="w-full h-full object-contain drop-shadow-[0_25px_35px_rgba(0,0,0,0.2)] rotate-15 hover:rotate-[21deg] hover:scale-[1.03] transition-transform duration-300 ease-out brightness-[0.85] contrast-[1.1] saturate-[1.15]" />
          </div>

          {/* Bottom left (over text) */}
          <div className="absolute bottom-[20%] left-0 md:left-[15%] w-56 h-56 md:w-72 md:h-72 opacity-0 animate-pv-fade-up delay-200 z-20 pointer-events-auto">
             <img src={imgNigiriEbi} alt="Ebi Nigiri" className="w-full h-full object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.25)] -rotate-[25deg] hover:-rotate-[19deg] hover:scale-[1.03] transition-transform duration-300 ease-out brightness-[0.85] contrast-[1.1] saturate-[1.15]" />
          </div>

          {/* Bottom right (under text) */}
          <div className="absolute bottom-[10%] right-[10%] w-32 h-32 md:w-48 md:h-48 opacity-0 animate-pv-fade-up delay-300 z-0 pointer-events-auto">
             <img src={imgNigiriUni} alt="Uni Gunkan" className="w-full h-full object-contain drop-shadow-[0_15px_20px_rgba(0,0,0,0.1)] rotate-6 hover:rotate-[12deg] hover:scale-[1.03] transition-transform duration-300 ease-out brightness-[0.85] contrast-[1.1] saturate-[1.15]" />
          </div>

          {/* Far right edge (under text) */}
          <div className="absolute top-[45%] right-[-10%] md:right-[5%] w-32 h-32 md:w-40 md:h-40 opacity-0 animate-pv-fade-up delay-500 z-0 pointer-events-auto">
             <img src={imgNigiriTamago} alt="Tamago Nigiri" className="w-full h-full object-contain drop-shadow-[0_10px_15px_rgba(0,0,0,0.05)] rotate-[35deg] hover:rotate-[41deg] hover:scale-[1.03] transition-transform duration-300 ease-out brightness-[0.85] contrast-[1.1] saturate-[1.15]" />
          </div>
        </div>

        {/* Center Typography */}
        <div className="relative z-10 w-full flex flex-col items-center text-center animate-pv-fade-up -mt-8 md:-mt-16 pointer-events-none">
          <div className="mb-8 relative w-24 h-24 md:w-32 md:h-32 opacity-0 animate-pv-fade-up delay-[50ms]" style={{ animationFillMode: 'forwards' }}>
            <CircularText text="EDOMAE SUSHI • OPENING 2024 • TOKYO TRADITION • " radius={45} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="pv-stamp opacity-0 animate-pv-stamp delay-150 scale-75 md:scale-100" style={{ animationFillMode: 'forwards' }}>
                海
              </div>
            </div>
          </div>
          
          <h1 className="pv-serif text-6xl md:text-8xl lg:text-[11rem] leading-[0.9] font-light tracking-[-0.02em] mb-8 mix-blend-normal">
            Intimate.<br />
            <span className="italic">Chef-led.</span><br />
            Omakase.
          </h1>
          
          <p className="pv-sans text-sm md:text-base max-w-md leading-relaxed text-black/70 uppercase tracking-widest mb-16 opacity-0 animate-pv-fade-up delay-150" style={{ animationFillMode: 'forwards' }}>
            A dedication to the purity of Edomae sushi. Limited to 8 seats per seating.
          </p>

          <div className="flex flex-col items-center gap-4 opacity-0 animate-pv-fade-up delay-300" style={{ animationFillMode: 'forwards' }}>
            <div className="w-px h-16 bg-[#111]"></div>
            <span className="pv-sans text-xs uppercase tracking-[0.2em] font-medium">Scroll to explore</span>
          </div>
        </div>
      </section>

      {/* Horizontal divider */}
      <div className="w-full max-w-7xl mx-auto h-px bg-[#1111111f] relative">
        <div className="absolute top-0 left-0 w-full h-full bg-[#E3342F] origin-left scale-x-0 animate-pv-line"></div>
      </div>

      {/* Philosophy Section */}
      <section className="py-32 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f]">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12">
          <div className="md:col-span-4 reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out">
            <h2 className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-4 flex items-center gap-4">
              <span className="w-8 h-px bg-[#E3342F]"></span>
              The Philosophy
            </h2>
          </div>
          <div className="md:col-span-8 reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-75">
            <h3 className="pv-serif text-4xl md:text-6xl leading-tight font-light mb-12">
              "We do not merely serve fish. We serve <span className="italic text-[#E3342F]">time</span>. The time it took for the catch to mature, the time it aged in our care, and the precise second it meets the rice."
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pv-sans text-sm leading-relaxed text-black/70">
              <p>
                True Edomae sushi is an exercise in restraint and respect. Every piece is a culmination of meticulous preparation — curing, marinating, aging — elevating the natural flavors of the sea. There are no distractions, no unnecessary garnishes. Just the pure harmony of fish, rice, vinegar, and wasabi.
              </p>
              <p>
                Our rice is seasoned with a blend of three red vinegars (akazu), giving it a distinct amber hue and a deep, complex umami profile that stands up to the richest cuts of fish while gently complementing the delicate ones.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The Chef Section */}
      <section className="py-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-y border-[#1111111f] bg-[#111]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div className="order-2 md:order-1 reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out">
            <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-white/50 mb-8 flex items-center gap-4">
              <span className="w-8 h-px bg-white/50"></span>
              The Chef
            </div>
            <h2 className="pv-serif text-5xl md:text-7xl font-light text-white mb-6">
              Chef <span className="italic">Masato</span>
            </h2>
            <p className="pv-sans text-white/70 leading-relaxed mb-8 max-w-md text-sm">
              With over two decades of experience spanning from the legendary counters of Ginza to the vibrant culinary scene of our city, Chef Masato brings an uncompromising dedication to craft. His movements are a quiet choreography of precision and grace.
            </p>
            <div className="inline-flex items-center gap-4 text-white hover:text-[#E3342F] transition-colors cursor-pointer group">
              <span className="pv-sans text-xs uppercase tracking-widest">Read Full Biography</span>
              <ArrowRight size={14} className="group-hover:translate-x-2 transition-transform" />
            </div>
          </div>
          <div className="order-1 md:order-2 h-[50vh] md:h-[80vh] relative reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-75">
            <img 
              src={imgSushiChef} 
              alt="Chef Masato preparing sushi" 
              className="w-full h-full object-cover grayscale"
            />
            <div className="absolute top-0 right-0 w-32 h-32 md:w-48 md:h-48 translate-x-1/2 -translate-y-1/2 hidden md:block">
               <CircularText text="MASTER OF CRAFT • SHOKUNIN • " radius={45} />
            </div>
          </div>
        </div>
      </section>

      {/* The Menu Section */}
      <section className="py-40 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-[#1111111f] relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute -left-32 top-1/2 -translate-y-1/2 text-[#11111103] text-[40rem] pv-serif italic leading-none pointer-events-none select-none">
          旬
        </div>
        
        <div className="max-w-6xl mx-auto relative z-10">
          <div className="text-center mb-32 reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out">
            <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-6 flex items-center justify-center gap-4">
              <span className="w-8 h-px bg-[#E3342F]"></span>
              The Journey
              <span className="w-8 h-px bg-[#E3342F]"></span>
            </div>
            <h2 className="pv-serif text-5xl md:text-7xl font-light mb-6">The Omakase</h2>
            <p className="pv-sans text-sm uppercase tracking-[0.2em] text-black/60">"I leave it up to you"</p>
          </div>

          <div className="flex flex-col relative min-h-[50vh] max-w-4xl mx-auto">
            {[
              { 
                title: "Sakizuke", 
                subtitle: "Nodoguro & Ponzu",
                desc: "Lightly seared blackthroat seaperch from Ishikawa, served with a bright sudachi ponzu to awaken the palate.",
                img: imgCourseSakizuke
              },
              { 
                title: "Sashimi", 
                subtitle: "Aged Akami & Shima Aji",
                desc: "Lean bluefin tuna aged for 12 days to concentrate its umami, paired with crisp striped jack. Served with freshly grated Gotemba wasabi.",
                img: imgCourseSashimi
              },
              { 
                title: "Yakimono", 
                subtitle: "Binchotan Tachiuo",
                desc: "Beltfish slowly grilled over white binchotan charcoal. The skin is blistered and crisp, the meat infused with subtle smoke and sea salt.",
                img: imgCourseYakimono
              },
              { 
                title: "Nigiri", 
                subtitle: "The Chef's Selection",
                desc: "A progression of 12-14 pieces shaped to the precise moment. Featuring Kohada (trevally), Kuruma Ebi (tiger prawn), and our signature Otoro scored and brushed with nikiri.",
                img: imgCourseNigiri
              },
              { 
                title: "Wanmono", 
                subtitle: "Clear Dashi & Asari",
                desc: "A restorative clear broth made from pristine kombu and katsuobushi, featuring a single littleneck clam. A moment of pause.",
                img: imgCourseWanmono
              },
              { 
                title: "Kanmi", 
                subtitle: "Matcha & Seasonal Fruit",
                desc: "Ceremonial grade Uji matcha whisked tableside, accompanied by a slice of perfectly ripe Shizuoka crown melon and a delicate wagashi.",
                img: imgCourseKanmi
              }
            ].map((course, idx) => (
              <div 
                key={idx} 
                className="group flex flex-col md:flex-row gap-6 md:gap-10 items-start reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out border-b border-[#1111111f] py-8 first:pt-0 last:border-0 last:pb-0" 
              >
                {/* Image Block */}
                <div className="flex items-start gap-6 md:gap-8 shrink-0 w-full md:w-auto">
                  <div className="pt-2">
                    <span className="pv-sans text-[10px] uppercase tracking-[0.2em] text-[#E3342F] font-medium opacity-40 group-hover:opacity-100 transition-opacity duration-500">0{idx + 1}</span>
                  </div>
                  <div className="relative overflow-hidden aspect-[4/5] w-24 md:w-32 lg:w-40 shrink-0">
                    <img src={course.img} alt={course.title} className="w-full h-full object-cover grayscale-[30%] group-hover:scale-105 group-hover:grayscale-0 transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]" />
                    <div className="absolute inset-0 bg-[#E3342F]/0 group-hover:bg-[#E3342F]/10 transition-colors duration-500 pointer-events-none mix-blend-multiply"></div>
                    <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
                  </div>
                </div>

                {/* Text Block */}
                <div className="flex-1 flex flex-col lg:flex-row gap-4 lg:gap-12 pt-1 lg:pt-2 w-full">
                  <div className="lg:w-[40%]">
                    <h4 className="pv-serif text-2xl lg:text-3xl mb-1.5 group-hover:text-[#E3342F] transition-colors duration-300">
                      {course.title}
                    </h4>
                    <div className="pv-sans text-[10px] font-medium tracking-[0.15em] uppercase text-black/80">
                      {course.subtitle}
                    </div>
                  </div>
                  <div className="lg:w-[60%]">
                    <p className="pv-sans text-xs lg:text-[13px] leading-[1.6] tracking-wide text-black/60 max-w-md">
                      {course.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-24 pt-12 border-t border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8 reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-150">
            <div className="flex items-center gap-4">
              <span className="w-1.5 h-1.5 rounded-full bg-[#E3342F] animate-pulse"></span>
              <span className="pv-sans text-[9px] uppercase tracking-[0.2em] font-medium">Beverage Pairing Available</span>
            </div>
            <p className="pv-sans text-xs text-black/60 uppercase tracking-widest text-center md:text-left">
              Our menu shifts daily with the seasons and the tides. <br className="hidden md:block" /> Please note any dietary restrictions upon booking.
            </p>
            <p className="pv-serif italic text-2xl">$250 / Guest</p>
          </div>
        </div>
      </section>

      {/* The Space & Gallery Section */}
      <section className="pb-32 pt-24 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f]">
        <div className="mb-16 reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out">
          <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-4 flex items-center gap-4">
            <span className="w-8 h-px bg-[#E3342F]"></span>
            The Sanctuary & Details
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
          {/* Anchor/Hero tile - Hinoki interior */}
          <div className="md:col-span-12 h-[50vh] md:h-[70vh] relative overflow-hidden group reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out">
            <img 
              src={imgGallery3Interior} 
              alt="Minimalist warm hinoki wood interior" 
              className="w-full h-full object-cover grayscale-[15%] transition-transform duration-500 ease-out group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-[#E3342F]/0 group-hover:bg-[#E3342F]/10 transition-colors duration-300 ease-out pointer-events-none mix-blend-multiply"></div>
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
            <div className="absolute bottom-6 left-6 bg-[#F6F4F0] p-5 pr-12 border border-[#1111111f] transition-transform duration-300 ease-out group-hover:translate-x-2">
              <h3 className="pv-serif text-3xl mb-1 group-hover:text-[#E3342F] transition-colors duration-500">Hinoki</h3>
              <p className="pv-sans text-[10px] uppercase tracking-[0.2em] text-black/60">An eight-seat sanctuary</p>
            </div>
          </div>

          {/* Row 2: Hands & Sake */}
          <div className="md:col-span-8 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-100">
            <img src={imgGallery3Hands} alt="Chef preparing sushi" className="w-full h-full object-cover grayscale-[20%] transition-transform duration-500 ease-out group-hover:scale-105" />
            <div className="absolute inset-0 bg-[#E3342F]/0 group-hover:bg-[#E3342F]/10 transition-colors duration-300 ease-out pointer-events-none mix-blend-multiply"></div>
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
          
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-75">
            <img src={imgGallery3Sake} alt="Sake pour" className="w-full h-full object-cover grayscale-[20%] transition-transform duration-500 ease-out group-hover:scale-105" />
            <div className="absolute inset-0 bg-[#E3342F]/0 group-hover:bg-[#E3342F]/10 transition-colors duration-300 ease-out pointer-events-none mix-blend-multiply"></div>
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>

          {/* Row 3: Wasabi, Quote, Nigiri */}
          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-100">
            <img src={imgGallery3Wasabi} alt="Fresh wasabi" className="w-full h-full object-cover grayscale-[20%] transition-transform duration-500 ease-out group-hover:scale-105" />
            <div className="absolute inset-0 bg-[#E3342F]/0 group-hover:bg-[#E3342F]/10 transition-colors duration-300 ease-out pointer-events-none mix-blend-multiply"></div>
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>

          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-75">
            <div className="w-full h-full bg-[#EAE7E0] flex flex-col items-center justify-center p-8 text-center border border-[#1111111f] relative group-hover:bg-[#EAE7E0]/80 transition-colors duration-500 ease-out">
              <div className="absolute top-0 left-0 w-full h-1 bg-[#E3342F] scale-x-0 group-hover:scale-x-100 origin-left transition-transform duration-300 ease-out ease-out"></div>
              <div className="pv-stamp mb-8 opacity-50 group-hover:opacity-100 transition-opacity duration-300 ease-out">海</div>
              <p className="pv-serif text-3xl italic leading-snug">"Perfection is found in restraint."</p>
            </div>
          </div>

          <div className="md:col-span-4 h-[350px] md:h-[450px] relative overflow-hidden group reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-100">
            <img src={imgGallery3Nigiri} alt="Uni nigiri" className="w-full h-full object-cover grayscale-[20%] transition-transform duration-500 ease-out group-hover:scale-105" />
            <div className="absolute inset-0 bg-[#E3342F]/0 group-hover:bg-[#E3342F]/10 transition-colors duration-300 ease-out pointer-events-none mix-blend-multiply"></div>
            <div className="absolute inset-0 border border-[#1111111f] pointer-events-none"></div>
          </div>
        </div>
      </section>

      {/* Reservation / CTA Section */}
      <section className="py-32 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-[#1111111f] relative overflow-hidden bg-[#F6F4F0]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-8 items-start relative z-10">
          
          {/* Left Column: Details */}
          <div className="lg:col-span-5 flex flex-col justify-between h-full reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out">
            <div>
              <div className="pv-sans text-xs uppercase tracking-[0.3em] font-medium text-[#E3342F] mb-8 flex items-center gap-4">
                <span className="w-8 h-px bg-[#E3342F]"></span>
                The Details
              </div>
              <h2 className="pv-serif text-5xl md:text-7xl font-light leading-[1.1] mb-8">
                Join the <br/>
                <span className="italic text-[#E3342F]">Waitlist</span>
              </h2>
            </div>
            
            <div className="space-y-8 pv-sans text-xs uppercase tracking-widest text-black/70 mt-12 lg:mt-32">
              <div className="flex gap-6 group">
                <span className="w-4 h-px bg-[#E3342F] mt-2 group-hover:w-8 transition-all duration-500"></span>
                <div>
                  <div className="text-black font-medium mb-1">Opening Date</div>
                  <div>Autumn 2024</div>
                </div>
              </div>
              <div className="flex gap-6 group">
                <span className="w-4 h-px bg-[#E3342F] mt-2 group-hover:w-8 transition-all duration-500"></span>
                <div>
                  <div className="text-black font-medium mb-1">Location</div>
                  <div>1804 Minimalist Lane, Tokyo</div>
                </div>
              </div>
              <div className="flex gap-6 group">
                <span className="w-4 h-px bg-[#E3342F] mt-2 group-hover:w-8 transition-all duration-500"></span>
                <div>
                  <div className="text-black font-medium mb-1">Seatings</div>
                  <div>Tuesday to Saturday<br/>6:00 PM & 8:30 PM</div>
                </div>
              </div>
            </div>
          </div>

          {/* Center Column: Divider & Decorative */}
          <div className="hidden lg:flex lg:col-span-2 justify-center relative min-h-[400px]">
            <div className="w-px h-full bg-[#1111111f] absolute top-0 bottom-0"></div>
            <div className="w-32 h-32 absolute top-1/2 -translate-y-1/2 bg-[#F6F4F0] z-10 flex items-center justify-center">
               <CircularText text="PRIORITY ACCESS • NO. 01 • LIMITED SEATS • " radius={42} />
               <div className="absolute inset-0 flex items-center justify-center">
                 <div className="pv-stamp scale-75">海</div>
               </div>
            </div>
          </div>

          {/* Right Column: Form */}
          <div className="lg:col-span-5 flex flex-col justify-center reveal-on-scroll opacity-0 translate-y-8 transition-all duration-500 ease-out delay-75 lg:pl-8 pt-4 lg:pt-0">
            <div className="mb-12">
              <p className="pv-sans text-sm leading-relaxed text-black/60 mb-6">
                With only 8 seats available per seating, our calendar fills quickly. 
                Join our waitlist to receive priority access to reservations before they are made public.
              </p>
              <div className="inline-flex items-center gap-3 pv-sans text-[9px] uppercase tracking-[0.2em] px-4 py-2 border border-[#1111111f]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E3342F] animate-pulse"></span>
                Limited Availability
              </div>
            </div>

            <form className="flex flex-col gap-10" onSubmit={(e) => e.preventDefault()}>
              <div className="relative group">
                <input 
                  type="text" 
                  id="name"
                  placeholder=" " 
                  className="peer w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#E3342F] transition-colors rounded-none"
                />
                <label 
                  htmlFor="name" 
                  className="absolute left-0 top-2 pv-sans text-xs uppercase tracking-widest text-black/40 peer-focus:-translate-y-6 peer-focus:text-[9px] peer-focus:text-[#E3342F] peer-[:not(:placeholder-shown)]:-translate-y-6 peer-[:not(:placeholder-shown)]:text-[9px] transition-all cursor-text pointer-events-none"
                >
                  Full Name
                </label>
              </div>

              <div className="relative group">
                <input 
                  type="email" 
                  id="email"
                  placeholder=" " 
                  className="peer w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#E3342F] transition-colors rounded-none"
                />
                <label 
                  htmlFor="email" 
                  className="absolute left-0 top-2 pv-sans text-xs uppercase tracking-widest text-black/40 peer-focus:-translate-y-6 peer-focus:text-[9px] peer-focus:text-[#E3342F] peer-[:not(:placeholder-shown)]:-translate-y-6 peer-[:not(:placeholder-shown)]:text-[9px] transition-all cursor-text pointer-events-none"
                >
                  Email Address
                </label>
              </div>

              <div className="relative group">
                <select 
                  id="party"
                  className="w-full bg-transparent border-b border-[#11111130] py-2 px-0 pv-sans text-sm tracking-wider text-[#111] focus:outline-none focus:border-[#E3342F] transition-colors appearance-none rounded-none cursor-pointer"
                  defaultValue="2"
                >
                  <option value="1">1 Guest</option>
                  <option value="2">2 Guests</option>
                  <option value="3">3 Guests</option>
                  <option value="4">4 Guests</option>
                </select>
                <div className="absolute right-0 top-2 pointer-events-none text-black/40">
                  <ChevronDown size={16} />
                </div>
                <label 
                  htmlFor="party" 
                  className="absolute left-0 -translate-y-6 text-[9px] pv-sans uppercase tracking-widest text-black/40 transition-all pointer-events-none"
                >
                  Party Size
                </label>
              </div>

              <button className="mt-6 relative overflow-hidden group pv-sans text-xs uppercase tracking-[0.2em] font-medium border border-[#111] py-5 px-8 text-[#111] hover:text-[#F6F4F0] transition-colors duration-500 w-full text-center cursor-pointer">
                <span className="relative z-10">Request Access</span>
                <div className="absolute inset-0 bg-[#E3342F] translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] z-0"></div>
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 md:px-12 max-w-7xl mx-auto w-full border-x border-t border-b border-[#1111111f] flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="pv-serif text-3xl font-bold tracking-widest uppercase">
          KAI
        </div>
        <div className="flex gap-8 pv-sans text-[10px] uppercase tracking-widest text-black/50">
          <a href="#" className="hover:text-black transition-colors">Instagram</a>
          <a href="#" className="hover:text-black transition-colors">Press</a>
          <a href="#" className="hover:text-black transition-colors">Contact</a>
        </div>
        <div className="pv-sans text-[10px] uppercase tracking-widest text-black/30">
          © 2024 KAI SUSHI
        </div>
      </footer>

    </div>
  );
}

export default function App() {
  return (<>
    <style dangerouslySetInnerHTML={{ __html: PV_CSS }} />
    <FloatingNigiri />
  </>);
}
