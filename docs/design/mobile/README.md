# Дизайн мобильного приложения

PNG-экспорты фреймов из `pfm-mobile-app-design.pen`. Лежат здесь потому, что
`.pen` — бинарный и зашифрованный: в диффе его не посмотреть, а Pencil
записывает файл только по сохранению из самого приложения.

| Файл | Что это |
|---|---|
| `01-budget-screen.png` | Вкладка «Бюджет»: месяц-свитчер, RTA с минимумом по будущим месяцам, авто-назначение, группы категорий |
| `02-budget-assign-sheet.png` | Назначение суммы в категорию (`POST /budget/:month/assign` **ставит**, а не прибавляет) |
| `03-budget-cover-overspend.png` | Покрытие перерасхода (`POST /budget/:month/move`) |
| `04-accounts-screen.png` | Вкладка «Счета», итоги раздельно по валютам |
| `05-account-register-cny.png` | Регистр счёта в юанях — суммы форматируются из `amountCents`, а не из серверного `amountFormatted` |
| `06-transactions-screen.png` | Вкладка «Операции»: дефолтный период «Все», группировка по дням |
| `07-transaction-add-sheet.png` | Добавление операции: расход / доход / перевод |
| `08-reports-screen.png` | Вкладка «Отчёты»: приход/расход, помесячный график, разрез по категориям и контрагентам |

## Токены

В `.pen` они заведены под префиксом `pfm/*`, чтобы не пересекаться с набором
HeroUI в том же файле. Источник правды для кода — `mobile/lib/app/theme.dart`.

```
accent      #0D9488   accentSoft #E6F5F3
bg          #F6F7F9   surface    #FFFFFF   border #ECEEF1
textPrimary #14161A   textSecondary #6B7280   textMuted #9AA1AC

семантика бюджета (отдельная от акцента):
available > 0  #16A34A     available = 0  #9AA1AC
overspent < 0  #DC2626     underfunded    #F59E0B
```

Шрифты: Manrope (заголовки) + Inter (текст), денежные стили — с
`FontFeature.tabularFigures()`.

## Переиспользуемые компоненты в .pen

`PFM / Category Row`, `PFM / Account Row`, `PFM / Tx Row`.
