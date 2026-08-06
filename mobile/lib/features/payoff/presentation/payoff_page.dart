import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/text/plural.dart';
import '../../../core/widgets/states.dart';
import '../cubit/payoff_cubit.dart';
import '../data/payoff_models.dart';
import '../data/payoff_repository.dart';

class PayoffPage extends StatelessWidget {
  const PayoffPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => PayoffCubit(PayoffRepository(sl<ApiClient>()))..load(),
        child: const _PayoffView(),
      );
}

class _PayoffView extends StatelessWidget {
  const _PayoffView();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const DomainAppBar(title: 'Симулятор погашения'),
              Expanded(
                child: BlocBuilder<PayoffCubit, PayoffState>(
                  builder: (context, state) => switch (state.status) {
                    PayoffStatus.initial ||
                    PayoffStatus.loading =>
                      const Center(child: CircularProgressIndicator()),
                    PayoffStatus.error => ErrorStateView(
                        unauthorized: state.unauthorized,
                        error: state.error,
                        title: 'Не удалось посчитать',
                        onRetry: () => context.read<PayoffCubit>().load(),
                      ),
                    PayoffStatus.ready => _Content(state: state),
                  },
                ),
              ),
            ],
          ),
        ),
      );
}

class _Content extends StatelessWidget {
  const _Content({required this.state});

  final PayoffState state;

  @override
  Widget build(BuildContext context) {
    if (state.eligible.isEmpty) {
      return const EmptyStateView(
        icon: LucideIcons.calculator,
        text: 'Нечего считать',
        hint: 'Симулятор берёт кредиты с положительным остатком и заданным '
            'минимальным платежом.',
      );
    }

    final scenario = state.scenario;
    if (scenario == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        _HeroCard(state: state, scenario: scenario),
        const SizedBox(height: 16),
        _ExtraCard(state: state),
        const SizedBox(height: 16),
        _ChartCard(state: state, scenario: scenario),
        const SizedBox(height: 16),
        _OrderBlock(state: state, scenario: scenario),
        const SizedBox(height: 16),
        _StrategyCard(state: state),
        const SizedBox(height: 16),
        const InfoNote(
          text: 'Расчёт ничего не меняет в данных — сценарий считается на лету '
              'по остаткам и ставкам.',
        ),
      ],
    );
  }
}

/// Дата свободы от долгов крупно: «14 месяцев» — абстракция, «Октябрь 2027» —
/// то, что можно отметить в календаре.
class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.state, required this.scenario});

  final PayoffState state;
  final StrategyResult scenario;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final saved = state.monthsSaved;
    final interestSaved = state.interestSavedCents;

    return AnimatedOpacity(
      opacity: state.simulating ? 0.55 : 1,
      duration: const Duration(milliseconds: 150),
      child: SurfaceCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Свобода от долгов',
              style: theme.textTheme.bodyMedium?.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Flexible(
                  child: Text(
                    formatMonthLabel(scenario.debtFreeDate),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.headlineMedium?.copyWith(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      fontFeatures: kTabularFigures,
                      color: AppColors.positive,
                    ),
                  ),
                ),
                if (saved > 0) ...[
                  const SizedBox(width: 10),
                  _DeltaChip(months: saved),
                ],
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                _Metric(
                  label: 'Переплата',
                  value: formatMoneySmart(scenario.totalInterestCents),
                ),
                const SizedBox(
                  height: 32,
                  child: VerticalDivider(
                      width: 1, thickness: 1, color: AppColors.border),
                ),
                _Metric(
                  label: 'Всего выплат',
                  value: formatMoneySmart(scenario.totalPaidCents),
                ),
              ],
            ),
            if (interestSaved > 0) ...[
              const SizedBox(height: 12),
              Text(
                'На ${formatMoneySmart(interestSaved)} меньше процентов, '
                'чем на одних минимумах',
                style: theme.textTheme.bodySmall
                    ?.copyWith(fontSize: 12, color: AppColors.textMuted),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DeltaChip extends StatelessWidget {
  const _DeltaChip({required this.months});

  final int months;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: AppColors.positiveSoft,
          borderRadius: BorderRadius.circular(AppRadii.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(LucideIcons.arrowDown, size: 13, color: AppColors.positive),
            const SizedBox(width: 4),
            Text(
              '$months ${plural(months, 'месяц', 'месяца', 'месяцев')}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.positive,
              ),
            ),
          ],
        ),
      );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Expanded(
      child: Column(
        children: [
          Text(label,
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 3),
          Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              fontFeatures: kTabularFigures,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Ползунок вместо поля с кнопкой «Считать»: подбор добавки — это игра
/// «а если ещё чуть-чуть», а не заполнение формы.
class _ExtraCard extends StatelessWidget {
  const _ExtraCard({required this.state});

  final PayoffState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cubit = context.read<PayoffCubit>();
    final max = state.maxExtraCents.toDouble();
    final value = state.extraMonthlyCents.toDouble().clamp(0, max).toDouble();

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Сверх минимума',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                ),
              ),
              Text(
                '+${formatMoneySmart(state.extraMonthlyCents)}',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  fontFeatures: kTabularFigures,
                  color: AppColors.accent,
                ),
              ),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              trackHeight: 6,
              activeTrackColor: AppColors.accent,
              inactiveTrackColor: AppColors.neutralSoft,
              thumbColor: AppColors.surface,
              overlayColor: AppColors.accentSoft,
              thumbShape: const _RingThumbShape(),
              trackShape: const RoundedRectSliderTrackShape(),
              showValueIndicator: ShowValueIndicator.never,
            ),
            child: Slider(
              value: value,
              max: max,
              divisions: state.sliderDivisions,
              onChanged: (v) => cubit.setExtra(v.round()),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('0',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted)),
              Text(formatMoneySmart(state.maxExtraCents),
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontSize: 11, color: AppColors.textMuted)),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Divider(height: 1, thickness: 1, color: AppColors.border),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'В месяц всего',
                style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 13, color: AppColors.textSecondary),
              ),
              Text(
                formatMoneySmart(
                    state.minPaymentCents + state.extraMonthlyCents),
                style: theme.textTheme.titleMedium?.copyWith(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  fontFeatures: kTabularFigures,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Белая ручка с акцентным кольцом: стандартная RoundSliderThumbShape не умеет
/// обводку, а сплошная заливка на светлой карточке теряется на нулевом значении.
class _RingThumbShape extends SliderComponentShape {
  const _RingThumbShape();

  static const _radius = 10.0;

  @override
  Size getPreferredSize(bool isEnabled, bool isDiscrete) =>
      const Size.fromRadius(_radius);

  @override
  void paint(
    PaintingContext context,
    Offset center, {
    required Animation<double> activationAnimation,
    required Animation<double> enableAnimation,
    required bool isDiscrete,
    required TextPainter labelPainter,
    required RenderBox parentBox,
    required SliderThemeData sliderTheme,
    required TextDirection textDirection,
    required double value,
    required double textScaleFactor,
    required Size sizeWithOverflow,
  }) {
    final canvas = context.canvas;
    canvas.drawShadow(
      Path()..addOval(Rect.fromCircle(center: center, radius: _radius)),
      Colors.black.withValues(alpha: 0.25),
      2,
      true,
    );
    canvas.drawCircle(center, _radius, Paint()..color = AppColors.surface);
    canvas.drawCircle(
      center,
      _radius - 1.5,
      Paint()
        ..color = AppColors.accent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
  }
}

/// Две дорожки в одном масштабе. Разница длины и есть ответ на вопрос
/// «что если закидывать больше» — её видно до чтения подписей.
class _ChartCard extends StatelessWidget {
  const _ChartCard({required this.state, required this.scenario});

  final PayoffState state;
  final StrategyResult scenario;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final baseline = state.baseline;
    if (scenario.schedule.isEmpty) return const SizedBox.shrink();

    // На нулевой добавке сценарий и есть базовый: вторая дорожка была бы точной
    // копией первой, а подпись «С добавкой» — враньём.
    final hasExtra = state.extraMonthlyCents > 0;
    final baselineMonths =
        hasExtra ? (baseline?.schedule.length ?? 0) : scenario.schedule.length;
    final months = math.max(scenario.schedule.length, baselineMonths);
    final peak = [
      ...scenario.schedule.map((m) => m.totalRemainingCents),
      ...?baseline?.schedule.map((m) => m.totalRemainingCents),
    ].fold<int>(1, math.max);
    final extraMonths = baselineMonths - scenario.schedule.length;

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Как тает долг',
            style: theme.textTheme.titleMedium
                ?.copyWith(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 16),
          _Track(
            schedule: scenario.schedule,
            months: months,
            peak: peak,
            color: AppColors.accent,
            left: hasExtra
                ? 'С добавкой · ${scenario.schedule.length} мес.'
                : 'Сейчас · ${scenario.schedule.length} мес.',
            leftColor: AppColors.accent,
            right: 'финиш ${formatMonthInline(scenario.debtFreeDate)}',
          ),
          if (hasExtra && baseline != null && baseline.schedule.isNotEmpty) ...[
            const SizedBox(height: 16),
            _Track(
              schedule: baseline.schedule,
              months: months,
              peak: peak,
              color: AppColors.neutral,
              opacity: 0.4,
              tailFrom: extraMonths > 0 ? scenario.schedule.length : null,
              left: 'Только минимумы · ${baseline.schedule.length} мес.',
              leftColor: AppColors.textSecondary,
              right: extraMonths > 0
                  ? '+$extraMonths ${plural(extraMonths, 'месяц', 'месяца', 'месяцев')} долга'
                  : 'финиш ${formatMonthInline(baseline.debtFreeDate)}',
              rightColor: extraMonths > 0 ? AppColors.negative : null,
            ),
          ],
        ],
      ),
    );
  }
}

class _Track extends StatelessWidget {
  const _Track({
    required this.schedule,
    required this.months,
    required this.peak,
    required this.color,
    required this.left,
    required this.leftColor,
    required this.right,
    this.opacity = 1,
    this.tailFrom,
    this.rightColor,
  });

  final List<MonthSnapshot> schedule;
  final int months;
  final int peak;
  final Color color;
  final String left;
  final Color leftColor;
  final String right;
  final double opacity;

  /// С какого месяца дорожка считается «лишней» — эти столбики красим красным.
  final int? tailFrom;
  final Color? rightColor;

  static const _height = 96.0;
  static const _gap = 3.0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final barWidth =
                ((constraints.maxWidth - _gap * (months - 1)) / months)
                    .clamp(2.0, 18.0);

            return SizedBox(
              height: _height,
              child: Opacity(
                opacity: opacity,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    for (var i = 0; i < schedule.length; i++) ...[
                      if (i > 0) const SizedBox(width: _gap),
                      Container(
                        width: barWidth,
                        height: math.max(
                          3,
                          schedule[i].totalRemainingCents / peak * _height,
                        ),
                        decoration: BoxDecoration(
                          color: tailFrom != null && i >= tailFrom!
                              ? AppColors.negative
                              : color,
                          borderRadius: const BorderRadius.vertical(
                              top: Radius.circular(3)),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 7),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              left,
              style: theme.textTheme.bodySmall?.copyWith(
                  fontSize: 11, fontWeight: FontWeight.w600, color: leftColor),
            ),
            Text(
              right,
              style: theme.textTheme.bodySmall?.copyWith(
                fontSize: 11,
                fontWeight:
                    rightColor == null ? FontWeight.normal : FontWeight.w600,
                color: rightColor ?? AppColors.textMuted,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Порядок закрытия с датами. Сервер отдаёт его в каждом ответе, но раньше
/// на экране он был виден только как строка идентификаторов.
class _OrderBlock extends StatelessWidget {
  const _OrderBlock({required this.state, required this.scenario});

  final PayoffState state;
  final StrategyResult scenario;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final names = {for (final l in state.loans) l.id: l.name};

    final closings = <MapEntry<String, String>>[];
    for (final month in scenario.schedule) {
      for (final id in month.paidOffIds) {
        closings.add(MapEntry(id, month.date));
      }
    }
    if (closings.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Порядок закрытия',
          style: theme.textTheme.titleMedium
              ?.copyWith(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        RowsCard(
          children: [
            for (var i = 0; i < closings.length; i++)
              _OrderRow(
                index: i + 1,
                name: names[closings[i].key] ?? closings[i].key,
                month: formatMonthInline(closings[i].value),
                isLast: i == closings.length - 1,
              ),
          ],
        ),
      ],
    );
  }
}

class _OrderRow extends StatelessWidget {
  const _OrderRow({
    required this.index,
    required this.name,
    required this.month,
    required this.isLast,
  });

  final int index;
  final String name;
  final String month;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accent = isLast ? AppColors.positive : AppColors.accent;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 24,
            height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: isLast ? AppColors.positiveSoft : AppColors.accentSoft,
              borderRadius: BorderRadius.circular(AppRadii.pill),
            ),
            child: Text(
              '$index',
              style: TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w700, color: accent),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            month,
            style: theme.textTheme.bodySmall
                ?.copyWith(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

/// Стратегия выбирается один раз, а крутить хочется добавку — поэтому она
/// свёрнута в строку, а не разложена таблицей на пол-экрана.
class _StrategyCard extends StatelessWidget {
  const _StrategyCard({required this.state});

  final PayoffState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SurfaceCard(
      padding: const EdgeInsets.all(14),
      child: InkWell(
        onTap: () => _pick(context),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Стратегия',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
                Row(
                  children: [
                    Text(
                      strategyName(state.strategy),
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(width: 6),
                    const Icon(LucideIcons.chevronRight,
                        size: 16, color: AppColors.textMuted),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              strategyHint(state.strategy),
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  void _pick(BuildContext context) {
    final cubit = context.read<PayoffCubit>();
    final ranked = state.comparison?.ranked ?? const <StrategyResult>[];
    if (ranked.isEmpty) return;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppRadii.card)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(AppRadii.pill),
              ),
            ),
            const SizedBox(height: 12),
            for (final s in ranked)
              ListTile(
                title: Text(strategyName(s.strategy),
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(
                  '${s.monthsToPayoff} мес. · переплата '
                  '${formatMoneySmart(s.totalInterestCents)}',
                  style: const TextStyle(
                      fontSize: 12, color: AppColors.textMuted),
                ),
                trailing: s.strategy == state.strategy
                    ? const Icon(LucideIcons.check,
                        size: 18, color: AppColors.accent)
                    : null,
                onTap: () {
                  cubit.setStrategy(s.strategy);
                  Navigator.of(sheetContext).pop();
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
