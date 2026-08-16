import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/events/data_bus.dart';
import '../../../core/network/api_client.dart';
import '../../../core/text/plural.dart';
import '../cubit/reports_cubit.dart';
import '../data/reports_models.dart';
import '../data/reports_repository.dart';

/// Slice colours. Deliberately not the budget semantics palette — nothing here
/// means "overspent", these are just categories.
const _slicePalette = <Color>[
  AppColors.accent,
  Color(0xFF16A34A),
  Color(0xFFF59E0B),
  Color(0xFF6366F1),
  Color(0xFFEC4899),
  Color(0xFF0EA5E9),
  Color(0xFFEF4444),
  Color(0xFF14B8A6),
  Color(0xFFA855F7),
  Color(0xFF84CC16),
  Color(0xFFF97316),
  AppColors.neutral,
];

class ReportsPage extends StatelessWidget {
  const ReportsPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => ReportsCubit(ReportsRepository(sl<ApiClient>()), bus: sl<DataBus>())..load(),
        child: const _ReportsView(),
      );
}

class _ReportsView extends StatelessWidget {
  const _ReportsView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: BlocBuilder<ReportsCubit, ReportsState>(
            builder: (context, state) => Column(
              children: [
                const _Header(),
                _PeriodChips(state: state),
                Expanded(child: _Body(state: state)),
              ],
            ),
          ),
        ),
      );
}

class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Отчёты',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontSize: 30),
              ),
            ),
          ],
        ),
      );
}

class _PeriodChips extends StatelessWidget {
  const _PeriodChips({required this.state});

  final ReportsState state;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<ReportsCubit>();
    final theme = Theme.of(context);
    final busy = state.status == ReportsStatus.loading;

    Widget chip(int months, String label) {
      final active = state.months == months;
      return Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: InkWell(
            onTap: busy ? null : () => cubit.setMonths(months),
            borderRadius: BorderRadius.circular(AppRadii.pill),
            child: Container(
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: active ? AppColors.accent : AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadii.pill),
                border: Border.all(
                    color: active ? AppColors.accent : AppColors.border),
              ),
              child: Text(
                label,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: active ? Colors.white : AppColors.textSecondary,
                ),
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
      child: Row(
        children: [
          chip(1, 'Этот месяц'),
          chip(3, '3 мес.'),
          chip(6, '6 мес.'),
          chip(12, '12 мес.'),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.state});

  final ReportsState state;

  @override
  Widget build(BuildContext context) {
    switch (state.status) {
      case ReportsStatus.initial:
      case ReportsStatus.loading:
        return const Center(child: CircularProgressIndicator());
      case ReportsStatus.error:
        return _ErrorView(state: state);
      case ReportsStatus.ready:
        return _Content(data: state.data!);
    }
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.state});

  final ReportsState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final unauthorized = state.unauthorized;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(unauthorized ? LucideIcons.keyRound : LucideIcons.cloudOff,
                size: 40, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              unauthorized ? 'Нужен API-ключ' : 'Не удалось собрать отчёт',
              style: theme.textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              unauthorized
                  ? 'Укажите ключ в настройках, чтобы продолжить.'
                  : (state.error ?? 'Проверьте соединение и попробуйте снова.'),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 20),
            unauthorized
                ? FilledButton(
                    onPressed: () => context.push('/settings'),
                    child: const Text('Открыть настройки'),
                  )
                : FilledButton(
                    onPressed: () => context.read<ReportsCubit>().load(),
                    child: const Text('Повторить'),
                  ),
          ],
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.data});

  final ReportsData data;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: () => context.read<ReportsCubit>().load(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: [
            if (data.isEmpty)
              _EmptyWindow(data: data)
            else ...[
              _CashFlowCard(data: data),
              const SizedBox(height: 16),
              // За один месяц это один столбик: сравнивать не с чем, а место
              // занимает. Отдаём его категориям.
              if (data.months > 1) ...[
                _TrendCard(data: data),
                const SizedBox(height: 16),
              ],
              if (data.categories.isNotEmpty) ...[
                _CategoriesCard(data: data),
                const SizedBox(height: 16),
              ],
              if (data.payees.isNotEmpty) ...[
                _PayeesCard(data: data),
                const SizedBox(height: 16),
              ],
            ],
            _CurrencyNote(excludedCount: data.excludedCount),
          ],
        ),
      );
}

class _EmptyWindow extends StatelessWidget {
  const _EmptyWindow({required this.data});

  final ReportsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 56),
      child: Column(
        children: [
          const Icon(LucideIcons.barChart3, size: 36, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text(
            data.months == 1
                ? 'В этом месяце операций нет'
                : 'За ${data.months} мес. операций нет',
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              'Окно ${data.since} — ${data.until} пустое. '
              'Попробуйте период подлиннее.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

class _CashFlowCard extends StatelessWidget {
  const _CashFlowCard({required this.data});

  final ReportsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget cell(String label, String value, Color color) => Expanded(
          child: Column(
            children: [
              Text(
                label,
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 11, color: AppColors.textMuted),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: color,
                ),
              ),
            ],
          ),
        );

    const divider = SizedBox(
      height: 34,
      child: VerticalDivider(width: 1, thickness: 1, color: AppColors.border),
    );

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Приход и расход за период',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              cell('Пришло', '+${formatMoneySmart(data.incomeCents)}',
                  AppColors.positive),
              divider,
              cell('Ушло', '-${formatMoneySmart(data.expenseCents)}',
                  AppColors.textPrimary),
              divider,
              cell(
                'Разница',
                formatMoneySigned(data.netCents),
                data.netCents >= 0 ? AppColors.positive : AppColors.negative,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TrendCard extends StatelessWidget {
  const _TrendCard({required this.data});

  final ReportsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final peak = data.peakCents;

    Widget legendDot(String label, Color color) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration:
                  BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontSize: 11, color: AppColors.textMuted),
            ),
          ],
        );

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'По месяцам',
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
                ),
              ),
              legendDot('приход', AppColors.positive),
              const SizedBox(width: 12),
              legendDot('расход', AppColors.accent),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 140,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (final month in data.monthly)
                  Expanded(
                    child: _MonthColumn(month: month, peakCents: peak),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MonthColumn extends StatelessWidget {
  const _MonthColumn({required this.month, required this.peakCents});

  final MonthFlow month;
  final int peakCents;

  static const _barArea = 112.0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Empty months keep a 2px stub so gaps in the data stay visible instead of
    // reading as a missing chart.
    double barHeight(int cents) {
      if (peakCents <= 0 || cents <= 0) return 2;
      return (cents / peakCents * _barArea).clamp(2.0, _barArea);
    }

    Widget bar(int cents, Color color) => Container(
          width: 7,
          height: barHeight(cents),
          decoration: BoxDecoration(
            color: cents > 0 ? color : AppColors.border,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(3)),
          ),
        );

    final label = DateFormat('LLL', 'ru')
        .format(DateTime.parse('${month.month}-01'))
        .replaceAll('.', '');

    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        SizedBox(
          height: _barArea,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              bar(month.incomeCents, AppColors.positive),
              const SizedBox(width: 2),
              bar(month.expenseCents, AppColors.accent),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.clip,
          style: theme.textTheme.bodySmall
              ?.copyWith(fontSize: 9, color: AppColors.textMuted),
        ),
      ],
    );
  }
}

class _CategoriesCard extends StatelessWidget {
  const _CategoriesCard({required this.data});

  final ReportsData data;

  /// Сколько категорий показывать списком. Хвост сверх этого сворачивается в
  /// «Прочее» — иначе карточка превращается в простыню из строк по 0,1%.
  static const _limit = 12;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final top = data.topCategories(_limit);

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Куда уходят деньги',
            style: theme.textTheme.bodyMedium
                ?.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 16),
          // Пирог сверху во всю ширину, список под ним: категорий обычно
          // больше, чем влезает сбоку, и сбоку они сжимались до многоточий.
          Center(
            child: SizedBox(
              width: 190,
              height: 190,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  PieChart(
                    PieChartData(
                      startDegreeOffset: -90,
                      sectionsSpace: 2,
                      centerSpaceRadius: 58,
                      sections: [
                        for (var i = 0; i < top.length; i++)
                          PieChartSectionData(
                            value: top[i].cents.toDouble(),
                            color: _slicePalette[i % _slicePalette.length],
                            radius: 36,
                            showTitle: false,
                          ),
                      ],
                    ),
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        groupDigits(data.expenseCents ~/ 100),
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontSize: 19,
                          fontWeight: FontWeight.w800,
                          fontFeatures: kTabularFigures,
                        ),
                      ),
                      Text(
                        '₸ расход',
                        style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 11, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 18),
          for (var i = 0; i < top.length; i++) ...[
            if (i > 0) const SizedBox(height: 11),
            _CategoryLegendRow(
              category: top[i],
              color: _slicePalette[i % _slicePalette.length],
              share: data.shareOf(top[i]),
            ),
          ],
        ],
      ),
    );
  }
}

class _CategoryLegendRow extends StatelessWidget {
  const _CategoryLegendRow({
    required this.category,
    required this.color,
    required this.share,
  });

  final CategorySpend category;
  final Color color;
  final double share;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            category.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(fontSize: 12),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '${(share * 100).round()}%',
          style: theme.textTheme.bodySmall
              ?.copyWith(fontSize: 11, color: AppColors.textMuted),
        ),
        const SizedBox(width: 8),
        Text(
          groupDigits(category.cents ~/ 100),
          style: theme.textTheme.bodySmall?.copyWith(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            fontFeatures: kTabularFigures,
          ),
        ),
      ],
    );
  }
}

class _PayeesCard extends StatelessWidget {
  const _PayeesCard({required this.data});

  final ReportsData data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final top = data.payees.take(5).toList();

    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Кому платили больше всего',
            style: theme.textTheme.bodyMedium
                ?.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < top.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        top[i].name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 14, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${top[i].count} '
                        '${plural(top[i].count, 'операция', 'операции', 'операций')}',
                        style: theme.textTheme.bodySmall?.copyWith(
                            fontSize: 11, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  formatMoneySmart(top[i].cents),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    fontFeatures: kTabularFigures,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

}

class _CurrencyNote extends StatelessWidget {
  const _CurrencyNote({required this.excludedCount});

  final int excludedCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final text = excludedCount == 0
        ? 'Считается по счетам в ₸.'
        : 'Считается по счетам в ₸. Операций в других валютах '
            'исключено: $excludedCount — курса в API нет.';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(
        color: AppColors.neutralSoft,
        borderRadius: BorderRadius.circular(AppRadii.inner),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(LucideIcons.info, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontSize: 11, color: AppColors.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadii.card),
          border: Border.all(color: AppColors.border),
        ),
        child: child,
      );
}
