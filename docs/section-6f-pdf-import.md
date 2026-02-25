# Секция 6F: PDF Import

## Промпт для Claude Code

```
Read CLAUDE.md and docs/section-6f-pdf-import.md.

Add bank PDF import to packages/engine and extend API routes in apps/api.

1. pnpm add pdf-parse --filter @pfm/engine
   pnpm add -D @types/pdf-parse --filter @pfm/engine

2. Create packages/engine/src/import/pdf-types.ts
3. Create packages/engine/src/import/pdf-parser.ts — extractText, detectPdfBank, per-bank parsers
4. Re-export from packages/engine/src/index.ts

5. Extend apps/api/src/routes/import.ts — accept application/pdf in /preview endpoint
6. Update content-type detection in the existing import route

7. Write packages/engine/tests/pdf-import.test.ts with extracted text fixtures
8. Create packages/engine/tests/fixtures/kaspi.pdf.txt, forte.pdf.txt, bcc.pdf.txt

9. Update packages/skill/SKILL.md

Run pnpm test, fix all failures.
```

---

## Зависимости

```
pdf-parse            # Text extraction from PDF (wrapper over pdf.js, 2M+ weekly downloads)
```

`pdf-parse` принимает `Buffer`, возвращает `{ text: string, numpages: number, info: object }`.

---

## Переиспользование из Section 6C (CSV Import)

Следующие типы и функции **не дублируются** — импортируются из существующего модуля:

```typescript
// Из packages/engine/src/import/types.ts (section-6c)
import type { ParsedTransaction, ImportCandidate, ImportResult } from './types';
import { detectDuplicates } from './duplicates';
```

- `ParsedTransaction` — единый формат для CSV и PDF
- `ImportCandidate` — результат проверки дубликатов
- `ImportResult` — итог импорта
- `detectDuplicates()` — алгоритм поиска дубликатов (без изменений)

---

## Types: packages/engine/src/import/pdf-types.ts

```typescript
export interface PdfBankPreset {
  name: string;                    // 'kaspi-pdf', 'forte-pdf', 'bcc-pdf'
  detectPattern: RegExp;           // Pattern to identify bank from extracted text
  parse: (text: string) => ParsedTransaction[];  // Bank-specific parser
}
```

Отличие от CSV `BankPreset`: вместо `ColumnMapping` — функция `parse()`, потому что PDF-текст не имеет табличной структуры и каждый банк парсится уникальным regex-пайплайном.

---

## Bank Presets

```typescript
export const PDF_BANK_PRESETS: PdfBankPreset[] = [
  {
    name: 'kaspi-pdf',
    detectPattern: /Kaspi Gold.*Kaspi Bank|CASPKZKA/i,
    parse: parseKaspiPdf,
  },
  {
    name: 'forte-pdf',
    detectPattern: /ForteBank|IRTYKZKA/i,
    parse: parseFortePdf,
  },
  {
    name: 'bcc-pdf',
    detectPattern: /БАНК ЦЕНТРКРЕДИТ|KCJBKZKX/i,
    parse: parseBccPdf,
  },
];
```

---

## Parser: packages/engine/src/import/pdf-parser.ts

### extractText(buffer: Buffer) → Promise\<string\>

```
1. const pdfParse = require('pdf-parse')
2. const result = await pdfParse(buffer)
3. return result.text
```

### detectPdfBank(text: string) → PdfBankPreset | null

```
1. For each preset in PDF_BANK_PRESETS:
   a. Test preset.detectPattern against text
   b. Return first match
2. Return null if no match
```

### autoParsePdf(buffer: Buffer) → Promise<{ preset: PdfBankPreset; transactions: ParsedTransaction[] }>

```
1. const text = await extractText(buffer)
2. const preset = detectPdfBank(text)
3. If no preset → throw Error('Unsupported PDF format. Supported: Kaspi, Forte, BCC')
4. const transactions = preset.parse(text)
5. return { preset, transactions }
```

---

## Per-Bank Parsers

### parseKaspiPdf(text: string) → ParsedTransaction[]

**Формат извлечённого текста** (реальный вывод pdf-parse):

```
22.02.26 - 874,66 ₸ Покупка ALP*OtherRetail
(- 12,00 CNY)
22.02.26 - 2 121,31 ₸ Покупка ALP*DIDI Taxi
(- 29,15 CNY)
21.02.26 + 40 000,00 ₸ Пополнение С карты другого банка
21.02.26 - 9 990,00 ₸ Покупка GOOGLE *ChatGPT
20.02.26 - 87 000,00 ₸ Перевод На карту ForteBank*6130
02.02.26 - 17 869,60 ₸ Покупка SINCH MAILGUN
(- 35,00 USD)
```

**Особенности формата:**

- Дата: `DD.MM.YY` (2-значный год, всегда 20xx)
- Сумма: `[+-] [\d\s]+,\d{2} ₸` — знак, пробел, число с пробелами-тысячными, запятая-десятичная, пробел, ₸
- Операция: одно из `Покупка|Пополнение|Перевод|Снятие|Разное`
- Детали: всё после операции до конца строки (payee/описание)
- Иностранная валюта: опциональная следующая строка `([+-] [\d\s]+,\d{2} [A-Z]{3})`
- Многострочные детали: длинные payee-имена переносятся на следующую строку (перед строкой с иностранной валютой или следующей транзакцией)
- Footer `АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz` — пропускать
- Blocked amounts footnote: ` - Сумма заблокирована...` — пропускать

**Алгоритм:**

```
1. Split text into lines
2. Filter out:
   - Lines matching footer: /^АО «Kaspi Bank»/
   - Lines matching header: /^ВЫПИСКА|^по Kaspi Gold|^Дата\s+Сумма/
   - Summary lines: /^Доступно на|^Пополнения|^Переводы|^Покупки|^Снятия|^Разное\s+[-+]/
   - Account info: /^Жусупов|^Номер карты|^Номер счета|^Валюта счета/
   - Blocked note: /Сумма заблокирована/
   - Lines matching: /^Краткое содержание|^Лимит на|^Остаток зарпл|^Другие попол|^Итого/
3. Main transaction regex:
   /^(\d{2}\.\d{2}\.\d{2})\s+([+-])\s+([\d\s]+,\d{2})\s*₸\s+(Покупка|Пополнение|Перевод|Снятие|Разное)\s+(.+)$/
4. Foreign currency regex (optional next line):
   /^\(([+-])\s*([\d\s]+,\d{2})\s+([A-Z]{3})\)\s*$/
5. For each main match:
   a. Parse date: DD.MM.YY → YYYY-MM-DD (prepend "20" to year)
   b. Parse amount: remove spaces, replace comma→dot, apply sign → majorToCents()
   c. payeeName = details (column 5)
   d. If next line matches foreign currency regex:
      - Append to memo: "12.00 CNY"
      - Skip that line
   e. If next line does NOT match main regex OR foreign currency:
      - It's a continuation of details → append to payeeName
6. Return sorted by date
```

**Маппинг полей:**

| PDF поле     | ParsedTransaction |
|--------------|-------------------|
| Дата         | `date` (YYYY-MM-DD) |
| Сумма (₸)    | `amountCents` |
| Операция     | Prepend to `memo`: `"[Покупка]"` |
| Детали       | `payeeName` |
| Ин. валюта   | Append to `memo`: `"(12.00 CNY)"` |

**Примеры парсинга:**

```typescript
// Input line: "22.02.26 - 874,66 ₸ Покупка ALP*OtherRetail"
// Next line:  "(- 12,00 CNY)"
{
  date: '2026-02-22',
  amountCents: -87466,
  payeeName: 'ALP*OtherRetail',
  memo: '[Покупка] (12.00 CNY)',
  rawRow: { line: '22.02.26 - 874,66 ₸ Покупка ALP*OtherRetail' }
}

// Input line: "21.02.26 + 40 000,00 ₸ Пополнение С карты другого банка"
{
  date: '2026-02-21',
  amountCents: 4000000,
  payeeName: 'С карты другого банка',
  memo: '[Пополнение]',
  rawRow: { line: '21.02.26 + 40 000,00 ₸ Пополнение С карты другого банка' }
}
```

---

### parseFortePdf(text: string) → ParsedTransaction[]

**Формат извлечённого текста** (реальный вывод pdf-parse):

```
22.02.2026
-2874.98 KZT
(39.00 CNY) Покупка
WEIXIN*the hungry Beijing CN, Bank of China Limited, MCC: 7361
22.02.2026 5000.00 KZT Платеж
Tele2;NameVC=Мобильная связь;VC=1;ServiceId=110;PAYMENT_ID=...
22.02.2026 100000.00 KZT Перевод
Перевод между своими счетами, со счета: ***9326, на счет: ***1122
20.02.2026
87000.00 KZT Пополнение счета
Kaspi Bank, ATM/POS: 20110001, P2P_KGDV_CREDIT, VISA DIRECT, KZ
11.02.2026
-1879.84 KZT
(5.00 USD) Покупка
ELEVENLABS.IO ELEVENLABS.I US, PNC Bank, National Association, MCC: 5734
11.02.2026 3564.28 KZT Возврат денег
GOOGLE *Google One g.co/helppay US, JPMorgan Chase Bank NA, 11.02.26
```

**Особенности формата:**

- Дата: `DD.MM.YYYY` (4-значный год)
- Сумма: `-2874.98 KZT` — знак слитно, точка-десятичная, без разделителей тысяч, суффикс `KZT`
- Иностранная валюта: `(39.00 CNY)` — в скобках, на той же или предыдущей строке перед описанием
- Типы операций (Описание): `Покупка`, `Платеж`, `Перевод`, `Пополнение счета`, `Списание`, `Списание средств в рамках сервиса быстрых платежей`, `Возврат денег`, `Комиссия`
- Детализация: merchant name, MCC код, банк-эквайер, платёжная система (GOOGLE PAY)
- Текст извлекается из PDF-таблицы → дата, сумма и описание могут быть на одной строке или разбиты на несколько
- Footer: `Реквизиты: АО «ForteBank»...` — пропускать
- Повтор заголовков таблицы: `Дата Сумма Описание Детализация` — пропускать

**Алгоритм:**

```
1. Split text into lines
2. Filter out:
   - Header: /^Выписка по карточному|^За период:|^ЖУСУПОВ|^ИИН:/
   - Account info: /^Доступно на|^Задолженность|^Сервисные|^Овердрафт/
   - Column headers: /^Дата\s+Сумма\s+Описание/
   - Section title: /^Детализация выписки/
   - Footer: /^Сформировано в|^Реквизиты:|^Контактные данные:/
3. Identify transaction boundaries:
   - A new transaction starts with a date: /^\d{2}\.\d{2}\.\d{4}/
   - Collect all lines until next date line
4. For each transaction block (group of lines):
   a. Line with date regex: /^(\d{2}\.\d{2}\.\d{4})\s*(.*)/
      - Rest of line may contain: amount, description
   b. Find amount: /(-?\d+\.?\d*)\s*KZT/
   c. Find foreign currency: /\((\d+\.?\d*)\s+([A-Z]{3})\)/
   d. Find description type: /(Покупка|Платеж|Перевод|Пополнение счета|Списание средств в рамках сервиса быстрых платежей|Списание|Возврат денег|Комиссия)/
   e. Remaining text after description type = details (payeeName)
5. Parse date: DD.MM.YYYY → YYYY-MM-DD
6. Parse amount: float string → majorToCents()
7. Extract MCC if present: /MCC:\s*(\d{4})/ → append to memo
8. Return sorted by date
```

**Маппинг полей:**

| PDF поле       | ParsedTransaction |
|----------------|-------------------|
| Дата           | `date` (YYYY-MM-DD) |
| Сумма (KZT)    | `amountCents` |
| Описание       | Prepend to `memo`: `"[Покупка]"` |
| Детализация    | `payeeName` (merchant name, first meaningful part) |
| MCC код        | Append to `memo`: `"MCC: 5812"` |
| Ин. валюта     | Append to `memo`: `"(39.00 CNY)"` |

**Примеры парсинга:**

```typescript
// Block: "22.02.2026\n-2874.98 KZT\n(39.00 CNY) Покупка\nWEIXIN*the hungry Beijing CN, Bank of China Limited, MCC: 7361"
{
  date: '2026-02-22',
  amountCents: -287498,
  payeeName: 'WEIXIN*the hungry Beijing CN',
  memo: '[Покупка] (39.00 CNY) MCC: 7361',
  rawRow: { line: '22.02.2026 -2874.98 KZT Покупка ...' }
}

// Block: "20.02.2026\n87000.00 KZT Пополнение счета\nKaspi Bank, ATM/POS: 20110001, ..."
{
  date: '2026-02-20',
  amountCents: 8700000,
  payeeName: 'Kaspi Bank',
  memo: '[Пополнение счета] ATM/POS: 20110001, P2P_KGDV_CREDIT, VISA DIRECT',
  rawRow: { line: '20.02.2026 87000.00 KZT Пополнение счета ...' }
}
```

---

### parseBccPdf(text: string) → ParsedTransaction[]

**Формат извлечённого текста** (реальный вывод pdf-parse):

```
2026-02-22 2026-02-22 Перевод 100 000.00
KZT
-100 000.00 KZT
0.00 KZT 0.00
KZT
2026-02-20 2026-02-20 Пополнение от
НАО
"Евразийский
национальный
университет
имени
Л.Н.Гумилева",
ИИН
010140003594,
счет
KZ9485622031059
04920
Плательщик: НАО
"Евразийский
национальный
университет
имени
Л.Н.Гумилева"
800 000.00
KZT
800 000.00
KZT
0.00 KZT 0.00
KZT
2026-02-11 2026-02-11 Перевод 18 000.00
KZT
18 000.00
KZT
0.00 KZT 0.00
KZT
```

**Особенности формата:**

- Дата: `YYYY-MM-DD` (ISO-формат), две даты: операции + отражения на счете
- Сумма: `100 000.00 KZT` / `-100 000.00 KZT` — точка-десятичная, пробел-тысячные, суффикс KZT
- Два поля суммы: «Сумма в валюте операции» и «Сумма в KZT» — используем `Сумма в KZT` (вторую)
- Доп. данные: комиссия, кешбэк (в отдельных колонках)
- Описание операции: может быть многострочным (имена организаций, ИИН, номера счетов)
- Текст сильно разбит переносами из-за узких колонок PDF-таблицы
- Footer: `Вице-президент по...`, QR-код текст — пропускать

**Алгоритм:**

```
1. Split text into lines
2. Filter out:
   - Header: /^АКЦИОНЕРНОЕ ОБЩЕСТВО|^050059|^Телефон:|^Whatsapp:|^Электронная/
   - Account info: /^Жусупов|^ИИН:|^Выписка по банковскому|^Валюта банковского|^Вид банковского|^Номер платежной|^Период выписки/
   - Column headers: /^Дата\s*операции|^отражения на/
   - Summary: /^Остаток на дату|^Поступления за|^Расходы за|^Текущий остаток/
   - Footer: /^Вице-президент|^Блок розничного|^QR-код|^подписанный факсимильной|^Кайржанова/
   - BIK/BIN: /^БИК:|^БИН:|^Веб-сайт:/
3. Transaction boundary: line starts with ISO date /^\d{4}-\d{2}-\d{2}/
4. For each transaction block:
   a. Extract two dates: /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})/
      - Use first date (operation date) as transaction date
   b. Find description after second date: text between dates and first amount
   c. Find KZT amounts: all matches of /(-?[\d\s]+\.?\d*)\s*KZT/g
      - Second KZT amount = "Сумма в KZT" (the one with sign)
   d. Description = cleaned text between dates and amounts
5. Parse date: already YYYY-MM-DD
6. Parse amount: remove spaces → parseFloat → majorToCents()
7. If commission amount is non-zero: append to memo
8. Return sorted by date
```

**Маппинг полей:**

| PDF поле                | ParsedTransaction |
|-------------------------|-------------------|
| Дата операции            | `date` (YYYY-MM-DD) |
| Сумма в KZT             | `amountCents` |
| Описание операции        | `payeeName` (первая значимая строка) |
| Доп. описание (ИИН, счет)| `memo` |
| Комиссия                 | Append to `memo`: `"Комиссия: 500.00 KZT"` |
| Дата отражения           | Append to `memo` if differs from operation date |

**Примеры парсинга:**

```typescript
// Block: "2026-02-22 2026-02-22 Перевод 100 000.00\nKZT\n-100 000.00 KZT\n0.00 KZT 0.00\nKZT"
{
  date: '2026-02-22',
  amountCents: -10000000,
  payeeName: 'Перевод',
  memo: '',
  rawRow: { line: '2026-02-22 2026-02-22 Перевод 100 000.00 KZT ...' }
}

// Block: "2026-02-20 2026-02-20 Пополнение от\nНАО\n\"Евразийский...\"\n800 000.00\nKZT\n800 000.00\nKZT\n..."
{
  date: '2026-02-20',
  amountCents: 80000000,
  payeeName: 'Пополнение от НАО "Евразийский национальный университет имени Л.Н.Гумилева"',
  memo: 'ИИН 010140003594, счет KZ948562203105904920',
  rawRow: { line: '2026-02-20 2026-02-20 Пополнение от ...' }
}
```

---

## Сводная таблица форматов

| Параметр | Kaspi PDF | Forte PDF | BCC PDF |
|----------|-----------|-----------|---------|
| Дата | `DD.MM.YY` | `DD.MM.YYYY` | `YYYY-MM-DD` |
| Сумма | `+ 200 000,00 ₸` | `-2874.98 KZT` | `-100 000.00 KZT` |
| Десятичный | `,` (запятая) | `.` (точка) | `.` (точка) |
| Тысячные | пробел | нет | пробел |
| Знак | `+` / `-` отдельно | слитно | слитно |
| Суффикс | `₸` | `KZT` | `KZT` |
| Ин. валюта | `(- 12,00 CNY)` | `(39.00 CNY)` | нет (только KZT) |
| Детекция | `Kaspi Gold` + `CASPKZKA` | `ForteBank` + `IRTYKZKA` | `БАНК ЦЕНТРКРЕДИТ` + `KCJBKZKX` |
| Операции | Покупка, Пополнение, Перевод, Снятие, Разное | Покупка, Платеж, Перевод, Пополнение счета, Списание, Возврат денег, Комиссия | Перевод, Пополнение |
| MCC | нет | да (`MCC: 5812`) | нет |
| Две даты | нет | нет | да (операции + отражения) |

---

## API Routes

### Расширение POST /api/v1/import/preview

Существующий эндпоинт из section-6c расширяется для приёма PDF-файлов. Формат определяется по content-type файла в multipart/form-data.

```typescript
// Request: multipart/form-data
//   file: CSV or PDF file
//   accountId: target account ID
//   preset?: string (optional, auto-detect if missing)

// Логика:
// 1. Определить тип файла по расширению или MIME:
//    - .csv, text/csv → autoParseCSV(buffer)
//    - .pdf, application/pdf → autoParsePdf(buffer)
// 2. Далее единый пайплайн: detectDuplicates(db, accountId, transactions)

// Response (одинаковый для CSV и PDF)
{
  "detectedBank": "kaspi-pdf",
  "totalRows": 87,
  "candidates": [
    {
      "parsed": {
        "date": "2026-02-22",
        "amountCents": -87466,
        "payeeName": "ALP*OtherRetail",
        "memo": "[Покупка] (12.00 CNY)"
      },
      "status": "new",
      "duplicateScore": 0
    },
    {
      "parsed": {
        "date": "2026-02-21",
        "amountCents": 4000000,
        "payeeName": "С карты другого банка",
        "memo": "[Пополнение]"
      },
      "status": "exact_duplicate",
      "duplicateScore": 1.0,
      "matchedTransactionId": "existing-tx-id"
    }
  ]
}
```

### POST /api/v1/import/confirm

Без изменений — используется тот же эндпоинт из section-6c. Формат входных данных (`transactions[]`) одинаковый для CSV и PDF.

---

## Edge Cases

### Kaspi-специфичные
- **Заблокированные суммы**: строка ` - Сумма заблокирована...` в конце выписки — пропускать, не является транзакцией
- **Возвраты со знаком +**: `+ 280 316,00 ₸ Покупка ТОО Kaspi Travel` — положительная покупка = возврат, сохранять как есть
- **Комиссии**: `- 149,00 ₸ Разное Комиссия за перевод на карту др. банка` — тип `Разное`, payee содержит описание комиссии
- **Многострочные детали**: длинное имя мерчанта переносится на следующую строку (`Shou Du Ji Chang Ji Tuan...\n Xing Guo Ji Ji Chang`)

### Forte-специфичные
- **Парные Платежи**: Tele2 пополнение создаёт две строки (дебет + кредит с одинаковой суммой) — импортировать обе, пользователь разберётся
- **Длинные детали**: `ServiceId`, `PAYMENT_ID`, `BONUS_AMOUNT` — сохранять в memo, не парсить
- **Списание средств в рамках сервиса быстрых платежей**: длинный тип операции — обрабатывать как отдельный тип
- **Возвраты**: `3564.28 KZT Возврат денег` — положительная сумма, тип `Возврат денег`

### BCC-специфичные
- **Очень длинные описания**: имя организации + ИИН + номер счёта + Плательщик — парсить первую значимую часть как payeeName, остальное в memo
- **Сумма в валюте vs Сумма в KZT**: всегда использовать «Сумма в KZT» (вторую колонку)
- **Комиссия в отдельной колонке**: `0.00 KZT` обычно, но может быть ненулевой (как `-17 727.88 KZT`) — добавлять в memo если != 0
- **Переносы строк внутри ячейки**: `100 000.00\nKZT` — число и `KZT` разбиты на две строки

### Общие
- **Пустой PDF**: 0 транзакций — возвращать пустой массив, не ошибку
- **Неподдерживаемый банк**: текст не соответствует ни одному пресету — throw Error с сообщением
- **Повреждённый PDF**: pdf-parse выбросит ошибку — пробросить как `{ error: { code: 'INVALID_PDF', message: '...' } }`

---

## Test Scenarios

Тесты используют **извлечённый текст** (не настоящие PDF), чтобы избежать зависимости от бинарных файлов в репозитории.

### Test 1: Kaspi PDF — стандартные транзакции

```typescript
const kaspiText = `АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz
ВЫПИСКА
по Kaspi Gold за период с 25.01.26 по 25.02.26
Дата Сумма Операция Детали
22.02.26 - 874,66 ₸ Покупка ALP*OtherRetail
(- 12,00 CNY)
21.02.26 + 40 000,00 ₸ Пополнение С карты другого банка
20.02.26 - 87 000,00 ₸ Перевод На карту ForteBank*6130
АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz`;

const result = parseKaspiPdf(kaspiText);
expect(result).toHaveLength(3);
expect(result[0]).toEqual({
  date: '2026-02-22',
  amountCents: -87466,
  payeeName: 'ALP*OtherRetail',
  memo: '[Покупка] (12.00 CNY)',
  rawRow: expect.any(Object),
});
expect(result[1].amountCents).toBe(4000000);
expect(result[2].amountCents).toBe(-8700000);
```

### Test 2: Kaspi PDF — многострочные детали

```typescript
const text = `Дата Сумма Операция Детали
21.02.26 - 15 080,12 ₸ Покупка Shou Du Ji Chang Ji Tuan You Xian Gong Si Bei Jing Da
 Xing Guo Ji Ji Chang
(- 205,90 CNY)
21.02.26 - 9 990,00 ₸ Покупка GOOGLE *ChatGPT`;

const result = parseKaspiPdf(text);
expect(result).toHaveLength(2);
expect(result[0].payeeName).toContain('Shou Du Ji Chang');
expect(result[0].payeeName).toContain('Xing Guo Ji Ji Chang');
```

### Test 3: Forte PDF — с иностранной валютой и MCC

```typescript
const forteText = `Выписка по карточному счету
За период: с 25.01.2026 по 25.02.2026г.
Дата Сумма Описание Детализация
22.02.2026
-2874.98 KZT
(39.00 CNY) Покупка
WEIXIN*the hungry Beijing CN, Bank of China Limited, MCC: 7361
22.02.2026 100000.00 KZT Перевод
Перевод между своими счетами, со счета: ***9326, на счет: ***1122
Сформировано в Интернет Банкинге`;

const result = parseFortePdf(forteText);
expect(result).toHaveLength(2);
expect(result[0].amountCents).toBe(-287498);
expect(result[0].memo).toContain('39.00 CNY');
expect(result[0].memo).toContain('MCC: 7361');
expect(result[1].amountCents).toBe(10000000);
```

### Test 4: Forte PDF — типы операций

```typescript
const text = `Дата Сумма Описание Детализация
11.02.2026 3564.28 KZT Возврат денег
GOOGLE *Google One g.co/helppay US, JPMorgan Chase Bank NA, 11.02.26
02.02.2026 -10000.00 KZT Комиссия Погашение комиссии
13.02.2026 -4.91 KZT Списание
Автопогашение задолженности по овердрафту`;

const result = parseFortePdf(text);
expect(result).toHaveLength(3);
expect(result[0].amountCents).toBe(356428);  // positive = refund
expect(result[0].memo).toContain('[Возврат денег]');
expect(result[1].memo).toContain('[Комиссия]');
expect(result[2].memo).toContain('[Списание]');
```

### Test 5: BCC PDF — стандартные транзакции

```typescript
const bccText = `АКЦИОНЕРНОЕ ОБЩЕСТВО «БАНК ЦЕНТРКРЕДИТ»
БИК: KCJBKZKX
Дата операции Дата отражения на счете Описание операции Сумма в валюте операции Сумма в KZT Комиссия, KZT
2026-02-22 2026-02-22 Перевод 100 000.00 KZT -100 000.00 KZT 0.00 KZT 0.00 KZT
2026-02-20 2026-02-20 Пополнение 800 000.00 KZT 800 000.00 KZT 0.00 KZT 0.00 KZT`;

const result = parseBccPdf(bccText);
expect(result).toHaveLength(2);
expect(result[0]).toEqual({
  date: '2026-02-22',
  amountCents: -10000000,
  payeeName: 'Перевод',
  memo: '',
  rawRow: expect.any(Object),
});
expect(result[1].amountCents).toBe(80000000);
```

### Test 6: Auto-detect bank from PDF text

```typescript
expect(detectPdfBank('...Kaspi Gold...CASPKZKA...')).toMatchObject({ name: 'kaspi-pdf' });
expect(detectPdfBank('...ForteBank...IRTYKZKA...')).toMatchObject({ name: 'forte-pdf' });
expect(detectPdfBank('...БАНК ЦЕНТРКРЕДИТ...')).toMatchObject({ name: 'bcc-pdf' });
expect(detectPdfBank('Random text')).toBeNull();
```

### Test 7: Duplicate detection (reuses CSV module)

```typescript
// Insert existing transaction in DB
// Parse PDF with same transaction
// detectDuplicates() should return exact_duplicate
// (Same test pattern as section-6c Test 4, using ParsedTransaction from PDF parser)
```

---

## SKILL.md Addition

```bash
## Import Bank Statement (PDF)

# Preview PDF (auto-detect bank)
curl -s -X POST "$PFM_API_URL/api/v1/import/preview" \
  -H "Authorization: Bearer $PFM_API_KEY" \
  -F "file=@kaspi_statement.pdf" \
  -F "accountId=ACCOUNT_ID" | jq

# Preview PDF (specify bank)
curl -s -X POST "$PFM_API_URL/api/v1/import/preview" \
  -H "Authorization: Bearer $PFM_API_KEY" \
  -F "file=@forte_statement.pdf" \
  -F "accountId=ACCOUNT_ID" \
  -F "preset=forte-pdf" | jq

# Confirm import (same endpoint for CSV and PDF)
curl -s -X POST "$PFM_API_URL/api/v1/import/confirm" \
  -H "Authorization: Bearer $PFM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"ACCOUNT_ID","transactions":[...]}' | jq
```

---

## Halyk Bank (TBD)

Парсер для Halyk Bank будет добавлен после получения реального образца PDF-выписки. Ожидаемый пресет:

```typescript
{
  name: 'halyk-pdf',
  detectPattern: /Halyk Bank|HSBKKZKX/i,
  parse: parseHalykPdf,  // TBD
}
```

---

## File Structure

```
packages/engine/src/import/
  ├── types.ts           # (existing from 6c) ParsedTransaction, ImportCandidate, etc.
  ├── parser.ts          # (existing from 6c) CSV parser
  ├── duplicates.ts      # (existing from 6c) detectDuplicates
  ├── pdf-types.ts       # NEW: PdfBankPreset
  ├── pdf-parser.ts      # NEW: extractText, detectPdfBank, parseKaspiPdf, parseFortePdf, parseBccPdf
  └── index.ts           # Re-export all

packages/engine/tests/
  ├── import.test.ts     # (existing from 6c) CSV tests
  ├── pdf-import.test.ts # NEW: PDF parser tests
  └── fixtures/
      ├── kaspi.pdf.txt  # Extracted text fixture
      ├── forte.pdf.txt  # Extracted text fixture
      └── bcc.pdf.txt    # Extracted text fixture

apps/api/src/routes/
  └── import.ts          # MODIFIED: add PDF content-type detection in /preview
```
