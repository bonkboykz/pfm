import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:pfm_mobile/app/router.dart';

/// Порядок вкладок и что в них попало.
///
/// Первым человек должен видеть ответ на «что делать», а не таблицу, по
/// которой ответ ещё надо вывести. «Операции» — единственная вкладка, куда
/// заходят что-то делать, а не смотреть, поэтому она в середине, под большим
/// пальцем. Отчёты смотрят раз в месяц, и постоянное место в панели им ни к
/// чему — они переехали в «Ещё».
Iterable<String> _allPaths(RouteBase route) sync* {
  if (route is GoRoute) yield route.path;
  for (final r in route.routes) {
    yield* _allPaths(r);
  }
  if (route is StatefulShellRoute) {
    for (final b in route.branches) {
      for (final r in b.routes) {
        yield* _allPaths(r);
      }
    }
  }
}

void main() {
  test('приложение открывается на сводке', () {
    expect(appRouter.routeInformationProvider.value.uri.path, '/overview');
  });

  test('отчёты живут под «Ещё», а не отдельной вкладкой', () {
    final paths = appRouter.configuration.routes
        .expand(_allPaths)
        .toList();

    expect(paths, contains('/overview'));
    expect(paths, isNot(contains('/reports')));
    expect(paths, contains('reports'));
  });
}
