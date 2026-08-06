/// Выбирает русскую форму слова по числу [n].
///
/// [one] — форма для 1 («правило»), [few] — для 2–4 («правила»),
/// [many] — для 0 и 5+ («правил»). Диапазон 11–14 всегда берёт [many]:
/// «11 правил», а не «11 правило».
String plural(int n, String one, String few, String many) {
  final mod10 = n % 10;
  final mod100 = n % 100;
  if (mod10 == 1 && mod100 != 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
