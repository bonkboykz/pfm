import 'package:flutter/material.dart';

import '../../../../app/theme.dart';
import '../../../../core/money/money.dart';
import '../../data/budget_models.dart';

/// Список категорий месяца, сгруппированный так же, как на экране бюджета.
/// Возвращает выбранную категорию или null, если шторку закрыли.
///
/// Живёт отдельно от `move_sheet.dart`, потому что тем же списком выбирается
/// категория и при раздаче из «Готово к распределению».
Future<CategoryBudget?> pickCategory(
  BuildContext context, {
  required BudgetMonth month,
  required String title,
  String? excludeCategoryId,
  bool onlyWithMoney = false,
}) {
  return showModalBottomSheet<CategoryBudget>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _CategoryPicker(
      month: month,
      title: title,
      excludeCategoryId: excludeCategoryId,
      onlyWithMoney: onlyWithMoney,
    ),
  );
}

class _CategoryPicker extends StatelessWidget {
  const _CategoryPicker({
    required this.month,
    required this.title,
    required this.excludeCategoryId,
    required this.onlyWithMoney,
  });

  final BudgetMonth month;
  final String title;
  final String? excludeCategoryId;
  final bool onlyWithMoney;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.9,
      builder: (context, controller) {
        final rows = <Widget>[];
        for (final group in month.groups) {
          final categories = group.categories
              .where((c) => c.categoryId != excludeCategoryId)
              .where((c) => !onlyWithMoney || c.availableCents > 0)
              .toList();
          if (categories.isEmpty) continue;

          rows.add(Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
            child: Text(
              group.groupName,
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ));
          for (final c in categories) {
            rows.add(ListTile(
              title: Text(c.categoryName),
              trailing: Text(
                formatMoneySmart(c.availableCents),
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: AppColors.forAvailable(c.availableCents),
                ),
              ),
              onTap: () => Navigator.of(context).pop(c),
            ));
          }
        }

        return Column(
          children: [
            const SheetGrabber(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 6, 20, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(title,
                        style:
                            theme.textTheme.titleLarge?.copyWith(fontSize: 18)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: rows.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          onlyWithMoney
                              ? 'Нет категорий с доступными деньгами'
                              : 'Нет категорий',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(color: AppColors.textSecondary),
                        ),
                      ),
                    )
                  : ListView(controller: controller, children: rows),
            ),
          ],
        );
      },
    );
  }
}

class SheetGrabber extends StatelessWidget {
  const SheetGrabber({super.key});

  @override
  Widget build(BuildContext context) => Center(
        child: Container(
          margin: const EdgeInsets.only(top: 10, bottom: 6),
          height: 4,
          width: 40,
          decoration: BoxDecoration(
            color: AppColors.border,
            borderRadius: BorderRadius.circular(AppRadii.pill),
          ),
        ),
      );
}
