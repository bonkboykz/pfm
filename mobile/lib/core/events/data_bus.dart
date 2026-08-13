import 'dart:async';

/// Что изменилось. Событие называет сущность, которую переписали, а не экраны,
/// которым надо обновиться: решают слушатели.
enum DataChange { transactions, accounts, budget }

/// Шина «данные изменились».
///
/// Вкладки живут в ветках `StatefulShellRoute` и между переключениями не
/// пересоздаются: cubit создаётся один раз в `build()` и о записи, сделанной на
/// соседней вкладке, сам не узнаёт никогда. Добавил расход на «Операциях» —
/// «Бюджет» и «Счета» показывали старые числа, пока не потянешь refresh.
///
/// Слушатель не должен подписываться на то, что публикует сам: свой результат
/// уже пришёл в ответе мутации, а подписка на себя даёт петлю.
class DataBus {
  final _controller = StreamController<DataChange>.broadcast();

  Stream<DataChange> get stream => _controller.stream;

  void emit(DataChange change) {
    if (_controller.isClosed) return;
    _controller.add(change);
  }

  Future<void> dispose() => _controller.close();
}
