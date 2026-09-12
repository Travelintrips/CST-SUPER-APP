// Google Sheets connector via googleapis (Service Account)
// Env: GOOGLE_SERVICE_ACCOUNT_JSON  — isi JSON key file dari Google Cloud Console

// Lazy-load googleapis so the server starts even if the package isn't installed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// LAZY import: googleapis di-load hanya saat function dipanggil pertama kali.
// Ini mencegah crash server saat startup jika paket tidak terpasang.
type GoogleType = typeof import("googleapis")["google"];
let _googleCache: GoogleType | null = null;

async function getGoogle(): Promise<GoogleType> {
  if (_googleCache) return _googleCache;
  try {
    const mod = await import("googleapis");
    _googleCache = mod.google;
    return _googleCache;
  } catch {
    throw new Error(
      "Package 'googleapis' tidak tersedia. Jalankan: pnpm add googleapis --filter @workspace/api-server",
    );
  }
}

interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function parseCreds(): ServiceAccountCreds {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum dikonfigurasi di Secrets.");

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid. Pastikan copy seluruh isi file .json dari Google Cloud Console tanpa modifikasi.",
    );
  }

  if (!parsed.client_email) {
    const hint = parsed.client_id
      ? "JSON ini sepertinya OAuth 2.0 Client ID, bukan Service Account Key. Di Google Cloud Console, pilih 'Service Accounts' → klik SA → tab 'Keys' → 'Add Key' → 'Create new key' → JSON."
      : "JSON tidak memiliki field 'client_email'. Download ulang dari: Google Cloud Console → IAM & Admin → Service Accounts → [pilih SA] → Keys → Add Key → Create new key → JSON.";
    throw new Error(`Service Account JSON tidak valid: field 'client_email' tidak ditemukan. ${hint}`);
  }

  if (!parsed.private_key) {
    throw new Error(
      "Service Account JSON tidak valid: field 'private_key' tidak ditemukan. Download ulang file JSON key dari Google Cloud Console.",
    );
  }

  if (parsed.type && parsed.type !== "service_account") {
    throw new Error(
      `JSON type adalah '${parsed.type}', bukan 'service_account'. Pastikan download Service Account Key, bukan OAuth client credentials.`,
    );
  }

  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed as ServiceAccountCreds;
}

export function getServiceAccountEmail(): string | null {
  try {
    return parseCreds().client_email ?? null;
  } catch {
    return null;
  }
}

async function getAuth(): Promise<any> {
  const google = await getGoogle();
  const creds = parseCreds();
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

async function getSheetsClient(): Promise<any> {
  const google = await getGoogle();
  return google.sheets({ version: "v4", auth: await getAuth() });
}

async function getDriveClient(): Promise<any> {
  const google = await getGoogle();
  return google.drive({ version: "v3", auth: await getAuth() });
}

function rangeStr(sheetName: string, cols = "A:Z"): string {
  return `'${sheetName}'!${cols}`;
}

export async function createSpreadsheet(
  title: string,
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [
          { properties: { title: "CoA", index: 0 } },
          { properties: { title: "Jurnal", index: 1 } },
          { properties: { title: "Lines", index: 2 } },
          { properties: { title: "TrialBalance", index: 3 } },
          { properties: { title: "GL", index: 4 } },
        ],
      },
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    // Google Sheets API v4 `spreadsheets.create` requires the service account
    // to be able to write to its own Google Drive. If the project does not have
    // the Drive API enabled or the SA lacks drive.file scope, the call fails
    // with 403 PERMISSION_DENIED. Guide the admin to create the sheet manually.
    if (msg.includes("does not have permission") || msg.includes("PERMISSION_DENIED")) {
      const saEmail = getServiceAccountEmail();
      throw new Error(
        `Service Account tidak bisa membuat spreadsheet baru secara otomatis ` +
        `(Google Drive API belum diaktifkan di project GCP ini atau SA belum punya izin). ` +
        `Solusi: 1) Buat spreadsheet baru secara manual di Google Sheets, ` +
        `2) Share spreadsheet ke ${saEmail ?? "service account email"} sebagai Editor, ` +
        `3) Paste Spreadsheet ID-nya di kolom di atas lalu klik "Simpan".`,
      );
    }
    throw err;
  }
  const spreadsheetId = res.data.spreadsheetId!;
  const spreadsheetUrl = res.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  return { spreadsheetId, spreadsheetUrl };
}

export async function getSpreadsheetMeta(
  spreadsheetId: string,
): Promise<{ title: string; sheets: string[] }> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties.title",
  });
  return {
    title: res.data.properties?.title ?? "",
    sheets: (res.data.sheets ?? []).map((s: any) => s.properties?.title ?? ""),
  };
}

export type SheetHealthStatus =
  | { status: "ok"; title: string; sheets: string[] }
  | { status: "not_found" }
  | { status: "no_access"; reason: string }
  | { status: "unknown"; reason: string };

/**
 * Periksa apakah spreadsheet masih bisa diakses.
 * Tidak melempar error — selalu mengembalikan objek status.
 * Timeout default 5 detik agar halaman tidak terlambat dimuat.
 */
export async function checkSpreadsheetHealth(
  spreadsheetId: string,
  timeoutMs = 5000,
): Promise<SheetHealthStatus> {
  try {
    const meta = await Promise.race([
      getSpreadsheetMeta(spreadsheetId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__timeout__")), timeoutMs),
      ),
    ]);
    return { status: "ok", title: meta.title, sheets: meta.sheets };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "__timeout__") {
      return { status: "unknown", reason: "Pemeriksaan melebihi batas waktu 5 detik." };
    }
    const code = (err as any)?.code ?? (err as any)?.status;
    if (
      code === 404 ||
      msg.includes("Requested entity was not found") ||
      msg.toLowerCase().includes("not found")
    ) {
      return { status: "not_found" };
    }
    if (
      code === 403 ||
      msg.includes("does not have permission") ||
      msg.includes("caller does not have permission") ||
      msg.includes("PERMISSION_DENIED")
    ) {
      const saEmail = getServiceAccountEmail();
      return {
        status: "no_access",
        reason:
          `Service Account tidak punya akses ke spreadsheet ini. ` +
          `Share ke ${saEmail ?? "service account email"} sebagai Editor.`,
      };
    }
    if (msg.includes("GOOGLE_SERVICE_ACCOUNT_JSON") || msg.includes("belum dikonfigurasi")) {
      return { status: "unknown", reason: "GOOGLE_SERVICE_ACCOUNT_JSON belum dikonfigurasi di Secrets." };
    }
    return { status: "unknown", reason: msg.slice(0, 300) };
  }
}

export async function ensureSheets(
  spreadsheetId: string,
  sheetNames: string[],
): Promise<void> {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const existing = new Set(meta.sheets);
  const toAdd = sheetNames.filter((n) => !existing.has(n));
  if (toAdd.length === 0) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: toAdd.map((title) => ({
        addSheet: { properties: { title } },
      })),
    },
  });
}

export async function clearAndWriteSheet(
  spreadsheetId: string,
  sheetName: string,
  rows: unknown[][],
): Promise<void> {
  const sheets = await getSheetsClient();
  const range = rangeStr(sheetName);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows as string[][] },
  });
}

export async function readSheet(
  spreadsheetId: string,
  sheetName: string,
): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const range = rangeStr(sheetName);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values ?? []) as string[][];
}

export async function batchUpdateSheet(
  spreadsheetId: string,
  updates: Array<{ range: string; values: string[][] }>,
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      data: updates,
      valueInputOption: "USER_ENTERED",
    },
  });
}

export interface RowColor {
  rowIndex: number;
  red: number;
  green: number;
  blue: number;
}

export async function formatRowsColor(
  spreadsheetId: string,
  tabName: string,
  rows: RowColor[],
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });
  const tabMeta = (meta.data.sheets ?? []).find(
    (s: any) => s.properties?.title === tabName,
  );
  if (tabMeta?.properties?.sheetId == null) return;
  const sheetId = tabMeta.properties.sheetId;

  const requests = rows.map((r) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: r.rowIndex - 1,
        endRowIndex: r.rowIndex,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: r.red, green: r.green, blue: r.blue },
        },
      },
      fields: "userEnteredFormat.backgroundColor",
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

/**
 * Share a spreadsheet with a specific Gmail address (requires Drive API to be
 * enabled in the GCP project AND the SA to have drive or drive.file scope).
 * Returns { shared: true } on success, or { shared: false, error } on failure.
 */
export async function shareSpreadsheetWithUser(
  spreadsheetId: string,
  emailAddress: string,
  role: "reader" | "writer" = "reader",
): Promise<{ shared: boolean; error: string | null }> {
  try {
    const drive = await getDriveClient();
    await drive.permissions.create({
      fileId: spreadsheetId,
      sendNotificationEmail: false,
      requestBody: { role, type: "user", emailAddress },
    });
    return { shared: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { shared: false, error: msg };
  }
}

export async function exportToNewSpreadsheet(
  title: string,
  tabs: Array<{ name: string; rows: unknown[][] }>,
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: tabs.map((t, i) => ({ properties: { title: t.name, index: i } })),
    },
  });
  const spreadsheetId = res.data.spreadsheetId!;
  const spreadsheetUrl =
    res.data.spreadsheetUrl ??
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  for (const tab of tabs) {
    if (tab.rows.length === 0) continue;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rangeStr(tab.name),
      valueInputOption: "USER_ENTERED",
      requestBody: { values: tab.rows as string[][] },
    });
  }

  try {
    const drive = await getDriveClient();
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch {
    // Jika gagal share, tetap kembalikan URL — user bisa buka via SA email
  }

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Cek apakah Google Drive API sudah diaktifkan di project GCP ini.
 * Menggunakan drive.about.get() sebagai probe ringan.
 * Returns { enabled: true } jika Drive API aktif, { enabled: false, reason } jika belum.
 */
export async function checkDriveEnabled(): Promise<{ enabled: boolean; saEmail: string | null; reason?: string }> {
  const saEmail = getServiceAccountEmail();
  try {
    const drive = await getDriveClient();
    // about.get() is a lightweight read that requires Drive API to be enabled
    await drive.about.get({ fields: "user" });
    return { enabled: true, saEmail };
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err);
    // 403 PERMISSION_DENIED or "API not enabled" → Drive API disabled in GCP
    if (
      msg.includes("API has not been used") ||
      msg.includes("it is disabled") ||
      msg.includes("SERVICE_DISABLED") ||
      msg.includes("accessNotConfigured") ||
      msg.includes("PERMISSION_DENIED") ||
      msg.includes("does not have permission")
    ) {
      return { enabled: false, saEmail, reason: msg };
    }
    // Other errors (network, auth key missing, etc.) — report as disabled so UI warns
    return { enabled: false, saEmail, reason: msg };
  }
}
