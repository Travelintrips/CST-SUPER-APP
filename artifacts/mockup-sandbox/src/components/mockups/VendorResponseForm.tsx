import { useState } from "react";
import {
  Truck, CheckCircle2, XCircle, Camera, Clock, User, Phone,
  CarFront, FileText, Package, MapPin, Calendar, Weight
} from "lucide-react";

const mockOrder = {
  orderNumber: "LOG-260512-22077",
  companyName: "PT Maju Bersama Tbk",
  origin: "Bandung",
  destination: "Yogyakarta",
  commodity: "Tekstil",
  grossWeight: "2500",
  vehicleType: "CDD Box",
  requiredDate: "2026-05-14",
  jamOrder: "09.00",
};

function InfoRow({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-white/10 last:border-0 ${highlight ? "bg-emerald-500/5 -mx-4 px-4 rounded" : ""}`}>
      <span className="text-blue-300 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
        <p className={`text-sm font-semibold mt-0.5 break-words ${highlight ? "text-emerald-300" : "text-white"}`}>{value}</p>
      </div>
    </div>
  );
}

function InputField({
  label, icon, type = "text", value, onChange, placeholder, required = false
}: {
  label: string; icon: React.ReactNode; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
        <span className="text-blue-400">{icon}</span>
        {label}{required && <span className="text-red-400">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
      />
    </div>
  );
}

export default function VendorResponseForm() {
  const [status, setStatus] = useState<"READY" | "NOT_READY" | null>("READY");
  const [vendorName, setVendorName] = useState("PT Wangsamas Logistics");
  const [estimatedPickupTime, setEstimatedPickupTime] = useState("14 Mei 2026 09:00 WIB");
  const [driverName, setDriverName] = useState("Budi Santoso");
  const [driverPhone, setDriverPhone] = useState("081234567890");
  const [plateNumber, setPlateNumber] = useState("B 1234 XYZ");
  const [vehicleType, setVehicleType] = useState("CDD Box");
  const [notes, setNotes] = useState("");

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col" style={{ fontFamily: "system-ui, sans-serif" }}>
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-700 px-4 py-4 sticky top-0 z-20">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-400 font-medium">CST LOGISTICS</p>
            <p className="text-white text-sm font-bold truncate">Vendor Response Form</p>
          </div>
          <div className="ml-auto">
            <span className="bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold px-2.5 py-1 rounded-lg">
              {mockOrder.orderNumber}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-5 pb-10">

        {/* Order Info Card */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="bg-blue-600/10 border-b border-slate-700 px-4 py-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-400" />
            <span className="text-blue-300 text-xs font-bold uppercase tracking-wider">Detail Order</span>
          </div>
          <div className="px-4 py-2">
            <InfoRow icon={<User className="w-4 h-4" />} label="Customer" value={mockOrder.companyName} />
            <InfoRow icon={<MapPin className="w-4 h-4" />} label="Rute" value={`${mockOrder.origin} → ${mockOrder.destination}`} />
            <InfoRow icon={<Package className="w-4 h-4" />} label="Kategori Barang" value={mockOrder.commodity} />
            <InfoRow icon={<Weight className="w-4 h-4" />} label="Gross Weight" value={`${parseFloat(mockOrder.grossWeight).toLocaleString("id-ID")} KG`} />
            <InfoRow icon={<Truck className="w-4 h-4" />} label="Vehicle Type" value={mockOrder.vehicleType} />
            <InfoRow
              icon={<span className="text-lg leading-none">💰</span>}
              label="Harga Vendor (Referensi)"
              value="Rp 3.500.000"
              highlight
            />
            <InfoRow icon={<Calendar className="w-4 h-4" />} label="Jadwal Pickup" value={`14 Mei 2026 | 09:00 WIB`} />
          </div>
        </div>

        {/* Response Form */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="bg-slate-700/50 border-b border-slate-700 px-4 py-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-300 text-xs font-bold uppercase tracking-wider">Form Response Vendor</span>
          </div>

          <div className="px-4 py-5 space-y-5">

            <InputField
              label="Nama Perusahaan / Vendor"
              icon={<User className="w-3.5 h-3.5" />}
              value={vendorName}
              onChange={setVendorName}
              placeholder="Contoh: PT Wangsamas Logistics"
            />

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <span className="text-blue-400"><CheckCircle2 className="w-3.5 h-3.5" /></span>
                Status Ketersediaan<span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setStatus("READY")}
                  className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 font-bold text-sm transition-all ${
                    status === "READY"
                      ? "border-green-500 bg-green-500/20 text-green-400 shadow-lg shadow-green-500/10"
                      : "border-slate-600 bg-slate-800 text-slate-400 hover:border-green-500/50 hover:text-green-400/70"
                  }`}
                >
                  <CheckCircle2 className={`w-7 h-7 ${status === "READY" ? "text-green-400" : "text-slate-500"}`} />
                  ✅ READY
                  <span className="text-xs font-normal opacity-70">Siap menjalankan order</span>
                </button>
                <button
                  onClick={() => setStatus("NOT_READY")}
                  className={`flex flex-col items-center gap-2 py-4 px-3 rounded-xl border-2 font-bold text-sm transition-all ${
                    status === "NOT_READY"
                      ? "border-red-500 bg-red-500/20 text-red-400 shadow-lg shadow-red-500/10"
                      : "border-slate-600 bg-slate-800 text-slate-400 hover:border-red-500/50 hover:text-red-400/70"
                  }`}
                >
                  <XCircle className={`w-7 h-7 ${status === "NOT_READY" ? "text-red-400" : "text-slate-500"}`} />
                  ❌ NOT READY
                  <span className="text-xs font-normal opacity-70">Tidak tersedia saat ini</span>
                </button>
              </div>
            </div>

            {status === "READY" && (
              <div className="space-y-4 pt-1">
                <div className="border-t border-slate-700 pt-4">
                  <p className="text-xs text-slate-500 mb-4">Lengkapi informasi armada yang akan digunakan:</p>
                  <div className="space-y-4">
                    <InputField
                      label="Estimasi Waktu Pickup"
                      icon={<Clock className="w-3.5 h-3.5" />}
                      value={estimatedPickupTime}
                      onChange={setEstimatedPickupTime}
                      placeholder="Contoh: 20 Mei 2026 09:00 WIB"
                    />
                    <InputField
                      label="Nama Driver"
                      icon={<User className="w-3.5 h-3.5" />}
                      value={driverName}
                      onChange={setDriverName}
                      placeholder="Nama lengkap driver"
                      required
                    />
                    <InputField
                      label="Nomor HP Driver"
                      icon={<Phone className="w-3.5 h-3.5" />}
                      type="tel"
                      value={driverPhone}
                      onChange={setDriverPhone}
                      placeholder="08xxxxxxxxxx"
                    />
                    <InputField
                      label="Plat Nomor Kendaraan"
                      icon={<CarFront className="w-3.5 h-3.5" />}
                      value={plateNumber}
                      onChange={(v) => setPlateNumber(v.toUpperCase())}
                      placeholder="Contoh: B 1234 XYZ"
                      required
                    />
                    <InputField
                      label="Jenis Kendaraan"
                      icon={<Truck className="w-3.5 h-3.5" />}
                      value={vehicleType}
                      onChange={setVehicleType}
                      placeholder="Contoh: CDD Box, Tronton, Fuso"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <span className="text-blue-400"><FileText className="w-3.5 h-3.5" /></span>
                Catatan / Keterangan
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Tambahkan catatan jika ada..."
                rows={3}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <span className="text-blue-400"><Camera className="w-3.5 h-3.5" /></span>
                Foto Unit Kendaraan
                <span className="text-slate-500 normal-case font-normal">(opsional)</span>
              </label>
              <button className="w-full border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-xl py-6 flex flex-col items-center gap-2 text-slate-400 hover:text-blue-400 transition-all">
                <Camera className="w-8 h-8" />
                <span className="text-sm font-medium">Ambil / Pilih Foto</span>
                <span className="text-xs text-slate-500">JPG, PNG, max 10MB</span>
              </button>
            </div>

            <button
              className="w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-500/20"
            >
              <CheckCircle2 className="w-5 h-5" />
              Kirim Response
            </button>

            <p className="text-xs text-slate-500 text-center">
              Response Anda akan langsung diterima oleh tim admin B2B Marketplace and Logistic.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
