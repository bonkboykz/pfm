# Секция 6C: CSV Import

## Промпт для Claude Code

```
Read CLAUDE.md and docs/section-6c-csv-import.md.

Add bank CSV import to packages/engine and API routes to apps/api.

1. pnpm add papaparse --filter @pfm/engine
   pnpm add -D @types/papaparse --filter @pfm/engine
   pnpm add iconv-lite --filter @pfm/engine

2. Create packages/engine/src/import/types.ts
3. Create packages/engine/src/import/parser.ts — parseCSV with auto-detect
4. Create packages/engine/src/import/duplicates.ts — detectDuplicates
5. Re-export from packages/engine/src/index.ts

6. Create apps/api/src/routes/import.ts — 2 endpoints
7. Mount under /api/v1/import in apps/api/src/app.ts

8. Write packages/engine/tests/import.test.ts with sample CSVs
9. Create packages/engine/tests/fixtures/ with sample CSV files

10. Update packages/skill/SKILL.md

Run pnpm test, fix all failures.
```

---

## Types: packages/engine/src/import/types.ts

```typescript
export interface ColumnMapping {
  date: string;                  // Column name for date
  amount?: string;               // Single column (positive/negative)
  credit?: string;               // Separate credit column
  debit?: string;                // Separate debit column
  payee: string;                 // Column for description/payee
  memo?: string;                 // Optional memo column
  dateFormat: string;            // e.g. 'DD.MM.YYYY', 'YYYY-MM-DD'
}

export interface BankPreset {
  name: string;                  // 'kaspi', 'halyk', 'forte'
  encoding: 'utf-8' | 'windows-1251';
  mapping: ColumnMapping;
  skipRows?: number;             // Header rows to skip
  detectPattern: RegExp;         // Pattern in first few lines to auto-detect
}

export interface ParsedTransaction {
  date: string;                  // Normalized to YYYY-MM-DD
  amountCents: number;           // Positive = inflow, negative = outflow
  payeeName: string;
  memo: string;
  rawRow: Record<string, string>; // Original CSV row
}

export interface ImportCandidate {
  parsed: ParsedTransaction;
  duplicateScore: number;        // 0 = no match, 0.5 = likely, 1.0 = exact
  matchedTransactionId?: string; // ID of existing transaction if duplicate
  status: 'new' | 'likely_duplicate' | 'exact_duplicate';
}

export interface ImportResult {
  total: number;
  imported: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
}
```

---

## Bank Presets

```typescript
export const BANK_PRESETS: BankPreset[] = [
  {
    name: 'kaspi',
    encoding: 'utf-8',
    mapping: {
      date: 'Дата операции',
      amount: 'Сумма',
      payee: 'Описание',
      memo: 'Комментарий',
      dateFormat: 'DD.MM.YYYY HH:mm',
    },
    detectPattern: /Дата операции.*Сумма/i,
  },
  {
    name: 'halyk',
    encoding: 'windows-1251',
    mapping: {
      date: 'Дата',
      credit: 'Приход',
      debit: 'Расход',
      payee: 'Описание',
      dateFormat: 'DD.MM.YYYY',
    },
    detectPattern: /Дата.*Приход.*Расход/i,
  },
  {
    name: 'forte',
    encoding: 'utf-8',
    mapping: {
      date: 'Date',
      amount: 'Amount',
      payee: 'Description',
      memo: 'Details',
      dateFormat: 'YYYY-MM-DD',
    },
    detectPattern: /Date,.*Amount,.*Description/i,
  },
];
```

---

## Parser: packages/engine/src/import/parser.ts

### detectBank(content: string) → BankPreset | null

```
1. Try each preset's detectPattern against first 5 lines
2. Return first match, or null
```

### decodeCSV(buffer: Buffer, encoding: string) → string

```
1. If encoding === 'windows-1251': use iconv-lite to decode
2. Else: buffer.toString('utf-8')
3. Strip BOM if present
```

### parseCSV(content: string, mapping: ColumnMapping) → ParsedTransaction[]

```
1. Parse with papaparse (header: true, skipEmptyLines: true)
2. For each row:
   a. Parse date from mapping.date column using mapping.dateFormat → YYYY-MM-DD
   b. Parse amount:
      - If mapping.amount: parse single column, detect sign
      - If mapping.credit + mapping.debit: credit = +, debit = -
      - Convert to cents: majorToCents()
   c. Extract payeeName from mapping.payee
   d. Extract memo if mapping.memo
3. Skip rows with invalid date or zero amount
4. Return sorted by date
```

### autoParseCSV(buffer: Buffer) → { preset: BankPreset; transactions: ParsedTransaction[] }

```
1. Detect bank from raw content (try utf-8 first)
2. If no match, try windows-1251 decoding, detect again
3. If still no match, throw with list of supported banks
4. Decode with correct encoding
5. Parse with detected preset mapping
6. Return { preset, transactions }
```

---

## Duplicates: packages/engine/src/import/duplicates.ts

### detectDuplicates(db, accountId, parsed) → ImportCandidate[]

```
For each parsed transaction:
  1. Find existing transactions in same account within ±1 day of parsed date
  2. Score each match:
     - Same date + same amount: score 0.8
     - Same date + same amount + similar payee (Levenshtein ≤ 3): score 1.0
     - Same date + amount within 1%: score 0.5
  3. Take highest scoring match
  4. Classify:
     - score >= 0.9: exact_duplicate
     - score >= 0.5: likely_duplicate
     - else: new
```

---

## API Routes: apps/api/src/routes/import.ts

### POST /api/v1/import/preview

Принимает CSV, возвращает parsed transactions с duplicate detection.

```typescript
// Request: multipart/form-data
//   file: CSV file
//   accountId: target account ID
//   preset?: 'kaspi' | 'halyk' | 'forte' (optional, auto-detect if missing)

// Response
{
  "detectedBank": "kaspi",
  "encoding": "utf-8",
  "totalRows": 45,
  "candidates": [
    {
      "parsed": {
        "date": "2026-02-20",
        "amountCents": -850000,
        "payeeName": "MAGNUM",
        "memo": "Покупка продуктов"
      },
      "status": "new",
      "duplicateScore": 0
    },
    {
      "parsed": {
        "date": "2026-02-15",
        "amountCents": -450000,
        "payeeName": "GLOVO",
        "memo": ""
      },
      "status": "exact_duplicate",
      "duplicateScore": 1.0,
      "matchedTransactionId": "existing-tx-id"
    }
  ]
}
```

### POST /api/v1/import/confirm

Сохраняет выбранные транзакции.

```typescript
// Request
{
  "accountId": "account-id",
  "transactions": [
    {
      "date": "2026-02-20",
      "amountCents": -850000,
      "payeeName": "MAGNUM",
      "categoryId": "cat-groceries",  // optional, user may categorize
      "memo": "Покупка продуктов"
    }
  ]
}

// Response
{
  "imported": 32,
  "skipped": 0,
  "errors": []
}
```

---

## Test Scenarios

### Test 1: Kaspi CSV parse

```csv
Дата операции;Сумма;Описание;Комментарий
20.02.2026 14:30;-8500;MAGNUM CASH&CARRY;Покупка продуктов
15.02.2026 19:00;+500000;ТОО РАБОТОДАТЕЛЬ;Зарплата
```

Expected: 2 transactions, correct dates and amounts in cents.

### Test 2: Halyk CSV with Windows-1251

Binary buffer with Windows-1251 encoded CSV.
Expected: correct decoding, Приход/Расход parsed correctly.

### Test 3: Auto-detect bank

Provide Kaspi CSV without specifying preset.
Expected: detectedBank = 'kaspi'.

### Test 4: Duplicate detection

Insert existing transaction (2026-02-20, -850000, "MAGNUM").
Parse CSV with same transaction.
Expected: score = 1.0, status = exact_duplicate.

### Test 5: Date format parsing

Various formats: DD.MM.YYYY, DD.MM.YYYY HH:mm, YYYY-MM-DD.
All should normalize to YYYY-MM-DD.

---

## SKILL.md Addition

```bash
## Import Bank Statement

# Preview (auto-detect bank)
curl -s -X POST "$PFM_API_URL/api/v1/import/preview" \
  -F "file=@kaspi_statement.csv" \
  -F "accountId=ACCOUNT_ID" | jq

# Preview (specify bank)
curl -s -X POST "$PFM_API_URL/api/v1/import/preview" \
  -F "file=@halyk_statement.csv" \
  -F "accountId=ACCOUNT_ID" \
  -F "preset=halyk" | jq

# Confirm import
curl -s -X POST "$PFM_API_URL/api/v1/import/confirm" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"ACCOUNT_ID","transactions":[...]}' | jq
```