---
name: Paylabs SNAP integration quirks
description: Non-obvious causes of paramInvalid / Conflict errors when calling Paylabs h5/createLink
---

# Paylabs h5/createLink quirks

Two separate impls share the same body/signing pattern: logistic flow (`logisticOrders.ts`, `_2`-suffixed helpers) and sales flow (`payments.ts`). Keep them in sync.

## `errCode: "Conflict"` root cause — almost always the X-TIMESTAMP, not the IDs
- Paylabs rejects an out-of-window `X-TIMESTAMP` with the misleading `{"errCode":"Conflict"}` (NOT a timestamp-specific error).
- **Why:** a common bug builds the timestamp from UTC wall-clock and just relabels the suffix `+07:00`, leaving the instant 7h behind real WIB → out of window → Conflict. Must shift the clock to WIB *before* labeling `+07:00`. The same timestamp string must be reused for both the signature and the `X-TIMESTAMP` header.
- `requestId` / `merchantTradeNo` length (UUID = 36 chars) was a red herring — distinct numeric ids and Magento-style `requestId===merchantTradeNo` both work once the timestamp is correct (though docs cap these at 30 chars, so prefer short ids).

## Required body fields (authoritative, from paylabs/Paylabs-Magento2 `Model/PaylabsService.php` setH5)
`merchantId, merchantTradeNo, requestId, amount, phoneNumber, productName, redirectUrl, payer` (+ optional `notifyUrl`, `storeId`).
- Field is `productName` NOT `goodsInfo`. `payer` is required (use customer name).
- NO `expire` field, NO `goodsInfo` — extra/unknown fields cause `paramInvalid: missing parameter`.
- `amount` = string with 2 decimals (`amount.toFixed(2)`) is accepted.

## Signature (matches Magento exactly)
`X-SIGNATURE = base64(RSA-SHA256("POST:" + urlPathname + ":" + lowerhex(sha256(minified body)) + ":" + timestamp))`, using the **same** timestamp string sent in `X-TIMESTAMP`. Path = `new URL(apiUrl).pathname` e.g. `/payment/v2.1/h5/createLink`. SIT base: `https://sit-pay.paylabs.co.id`.

## Direct test harness
A throwaway node script that replicates the signing and POSTs variations directly to the SIT endpoint (logging full JSON) is the fastest way to isolate paramInvalid vs Conflict vs signature errors — far faster than rebuilding the dist each iteration.
