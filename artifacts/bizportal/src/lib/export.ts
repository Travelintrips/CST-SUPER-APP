export async function exportXlsx(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  try {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");

    worksheet.addRow(headers);
    rows.forEach((row) => worksheet.addRow(row));

    worksheet.columns = headers.map((h, i) => ({
      width: Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length), 8),
    }));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[exportXlsx] failed:", err);
    alert("Gagal mengekspor file Excel. Silakan coba lagi.");
  }
}

export function printWindow(
  title: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  rightCols?: number[]
) {
  const rightSet = new Set(rightCols ?? []);
  const thHtml = headers
    .map((h, i) => `<th style="${rightSet.has(i) ? "text-align:right" : ""}">${h}</th>`)
    .join("");
  const tbodyHtml = rows
    .map(
      (r) =>
        `<tr>${r
          .map(
            (cell, i) =>
              `<td style="${rightSet.has(i) ? "text-align:right;font-family:monospace" : ""}">${cell ?? ""}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  const win = window.open("", "_blank", "width=960,height=720");
  if (!win) { alert("Pop-up diblokir browser. Izinkan pop-up untuk mencetak."); return; }
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:Arial,sans-serif;font-size:12px;margin:24px}
      h1{font-size:18px;margin:0 0 2px}
      .sub{color:#666;font-size:11px;margin:0 0 14px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ccc;padding:5px 7px;font-size:11px}
      th{background:#f0f0f0;font-weight:600}
      @media print{@page{margin:15mm}button{display:none!important}}
    </style>
  </head><body>
    <h1>${title}</h1>
    <p class="sub">Dicetak: ${new Date().toLocaleString("id-ID")}</p>
    <button onclick="window.print()" style="margin-bottom:12px;padding:6px 14px;cursor:pointer">🖨 Cetak</button>
    <table><thead><tr>${thHtml}</tr></thead><tbody>${tbodyHtml}</tbody></table>
  </body></html>`);
  win.document.close();
  win.focus();
}
