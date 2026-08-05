import { useState } from "react";

const mockDrivers = [
  { id: 1, name: "Budi Santoso", phone: "08123456789", vehicle_type: "Truk", vehicle_plate: "B 1234 XYZ", route: "Jakarta → Surabaya", orders: 3 },
  { id: 2, name: "Andi Wijaya", phone: "08234567890", vehicle_type: "Van", vehicle_plate: "D 5678 ABC", route: "Bandung → Semarang", orders: 1 },
  { id: 3, name: "Rudi Hartono", phone: "08345678901", vehicle_type: "Pickup", vehicle_plate: "", route: "Medan → Pekanbaru", orders: 2 },
  { id: 4, name: "Siti Rahayu", phone: "08456789012", vehicle_type: "Motor", vehicle_plate: "", route: "Yogyakarta → Solo", orders: 1 },
  { id: 5, name: "Deni Kusuma", phone: "08567890123", vehicle_type: "Truk Besar", vehicle_plate: "L 9012 DEF", route: "Surabaya → Malang", orders: 4 },
  { id: 6, name: "Agus Permana", phone: "08678901234", vehicle_type: "Van", vehicle_plate: "", route: "Makassar → Parepare", orders: 2 },
];

type PlateFilter = "all" | "active" | "need_assign";

export default function OutstandingDriverTable() {
  const [plateFilter, setPlateFilter] = useState<PlateFilter>("all");
  const [search, setSearch] = useState("");

  const hasPlateCount = mockDrivers.filter(d => d.vehicle_plate).length;
  const noPlateCount = mockDrivers.filter(d => !d.vehicle_plate).length;

  const filtered = mockDrivers.filter(d => {
    const matchFilter =
      plateFilter === "all" ||
      (plateFilter === "active" && d.vehicle_plate) ||
      (plateFilter === "need_assign" && !d.vehicle_plate);
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      d.name.toLowerCase().includes(q) ||
      d.vehicle_plate.toLowerCase().includes(q) ||
      d.phone.includes(q);
    return matchFilter && matchSearch;
  });

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Page header */}
        <div className="mb-4">
          <h1 className="text-white text-xl font-semibold">Outstanding Driver</h1>
          <p className="text-gray-400 text-sm">Driver dengan order aktif yang belum selesai</p>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          {/* Card Header: filter chips + search */}
          <div className="px-5 py-4 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Filter chips */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setPlateFilter("all")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  plateFilter === "all"
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                Semua
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  plateFilter === "all" ? "bg-indigo-500 text-white" : "bg-gray-700 text-gray-300"
                }`}>
                  {mockDrivers.length}
                </span>
              </button>
              <button
                onClick={() => setPlateFilter("active")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  plateFilter === "active"
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                Active
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  plateFilter === "active" ? "bg-emerald-500 text-white" : "bg-gray-700 text-gray-300"
                }`}>
                  {hasPlateCount}
                </span>
              </button>
              <button
                onClick={() => setPlateFilter("need_assign")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  plateFilter === "need_assign"
                    ? "bg-orange-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                Need to Assign
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                  plateFilter === "need_assign" ? "bg-orange-500 text-white" : "bg-gray-700 text-gray-300"
                }`}>
                  {noPlateCount}
                </span>
              </button>
            </div>

            {/* Search bar */}
            <div className="sm:ml-auto relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Cari nama, plat, atau HP..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-56"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">#</th>
                  <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Driver</th>
                  <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Kendaraan</th>
                  <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Rute</th>
                  <th className="text-right px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Orders</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-500 text-sm">
                      Tidak ada data yang sesuai
                    </td>
                  </tr>
                ) : (
                  filtered.map((d, i) => (
                    <tr key={d.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3.5 text-gray-500 text-xs">{i + 1}</td>
                      <td className="px-5 py-3.5">
                        <div className="text-gray-200 font-medium text-sm">{d.name}</div>
                        <div className="text-gray-500 text-xs">{d.phone}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="text-gray-300 text-sm">{d.vehicle_type}</div>
                        <div className="text-gray-500 text-xs">{d.vehicle_plate || <span className="italic text-gray-600">— belum diisi —</span>}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        {d.vehicle_plate ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/15 text-orange-400 border border-orange-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block" />
                            Need to Assign
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-gray-400 text-sm">{d.route}</td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-500/15 text-indigo-400 text-xs font-semibold border border-indigo-500/25">
                          {d.orders}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between">
            <span className="text-gray-500 text-xs">
              Menampilkan {filtered.length} dari {mockDrivers.length} driver
            </span>
            <span className="text-gray-600 text-xs">
              {hasPlateCount} Active · {noPlateCount} Need to Assign
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
