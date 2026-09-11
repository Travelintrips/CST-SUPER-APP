import { diagnoseSheetConfig } from './src/lib/sheetSyncService';
const result = await diagnoseSheetConfig(3);
console.log(JSON.stringify(result, null, 2));
