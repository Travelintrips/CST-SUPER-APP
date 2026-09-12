---
name: Dynamic Service Calculator
description: Per-service fields, formulas, and rates for the customer portal Logistics Calculator.
---

## Rate endpoint
- New: `GET /api/portal/calculator-rates-v2` (in `artifacts/api-server/src/routes/portal.ts`)
- Stored in `portal_content` table under key `"calculator_rates_v2"` as JSON
- Falls back to `DEFAULT_SERVICE_RATES_V2` constant in portal.ts

## Frontend
- `artifacts/customer-portal/src/pages/calculator.tsx` — full rewrite
- Route: `/calculator` on the customer portal

## Service formulas
- **Air Freight**: chargeable = max(gross, vol_weight); items = freight + fuel_surcharge(25%) + security + handling + AWB + docs; PPN 11%
- **Sea Freight LCL**: CBM × ratePerCbmLcl + THC + docs + optional customs/trucking; PPN 11%
- **Sea Freight FCL**: container rate (by type) + THC + docs + optional customs/trucking; PPN 11%
- **PPJK/Customs**: jasaPpjk + customsHandling + documentProcessing + pibSubmission + courier + optional bea_masuk(3% of nilai_pabean) + PPN_impor(11%)
- **Trucking**: vehicleRates[type] + distance × distanceRatePerKm + optional loading/unloading/overnight/helper
- **Warehousing**: qty × days × storageRate[type] + optional inbound/outbound/inventory
- **Project Cargo**: budget range estimate based on complexity flags (no fixed total)

## Why new endpoint
Used a versioned endpoint (`-v2`) to avoid breaking the BizPortal `CalculatorRatesCard` admin component which still writes to `"calculator_rates"` (legacy key).
