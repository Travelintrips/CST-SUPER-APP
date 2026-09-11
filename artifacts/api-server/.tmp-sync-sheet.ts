import { syncOneSheetConfig } from './src/lib/sheetSyncService';
try {
  console.log(JSON.stringify(await syncOneSheetConfig(3), null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 2;
}
