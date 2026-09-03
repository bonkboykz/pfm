import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/dates/months.dart';
import '../../../core/di/di.dart';
import '../../../core/events/data_bus.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../core/text/plural.dart';
import '../../../core/widgets/states.dart';
import '../cubit/overview_cubit.dart';
import '../data/overview_models.dart';
import '../data/overview_repository.dart';

/// Главный экран: что делать в этом месяце.
///
/// Первым, что видел человек, был бюджет — таблица категорий, по которой ещё
/// надо понять, всё ли в порядке. Здесь то же самое сказано прямо: сколько
/// свободно, где перерасход, что просят цели, что скоро спишется и что с этим
/// делать. Числа считает сервер одним ответом, чтобы их не пересобирали по
/// частям и не путали недофинансирование с перерасходом.
class OverviewPage extends StatelessWidget {
  const OverviewPage({super.key});

  @override
  Widget build(BuildContext context) => BlocProvider(
        create: (_) => OverviewCubit(
          OverviewRepository(sl<ApiClient>()),
          bus: sl.isRegistered<DataBus>() ? sl<DataBus>() : null,
        )..load(),
        child: const _OverviewView(),
      );
}

class _OverviewView extends StatelessWidget {
  const _OverviewView();

  @override
  Widget build(BuildContext context) =>
      BlocBuilder<OverviewCubit, OverviewState>(
        builder: (context, state) => Scaffold(
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                const _Header(),
                Expanded(child: _body(context, state)),
              ],
            ),
          ),
        ),
      );

  Widget _body(BuildContext context, OverviewState state) {
    final cubit = context.read<OverviewCubit>();

    if (state.status == OverviewStatus.error) {
      return ErrorStateView(
        unauthorized: state.unauthorized,
        error: state.error,
        title: state.unauthorized ? 'Нужен API-ключ' : 'Не удалось загрузить',
        onRetry: cubit.load,
      );
    }
    if (state.data == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final d = state.data!;
    return RefreshIndicator(
      onRefresh: cubit.load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        children: [
          _FreeMoney(data: d),
          const SizedBox(height: 14),
          _Actions(data: d),
          if (d.overspent.isNotEmpty) ...[
            const SizedBox(height: 16),
            _Lines(
              title: 'Перерасход',
              lines: d.overspent,
              negative: true,
            ),
          ],
          if (d.upcoming.isNotEmpty) ...[
            const SizedBox(height: 16),
            _Upcoming(items: d.upcoming),
          ],
          if (d.underfunded.isNotEmpty) ...[
            const SizedBox(height: 16),
            _Lines(
              title: 'Цели ждут пополнения',
              lines: d.underfunded,
              negative: false,
            ),
          ],
        ],
      ),
    );
  }
}

/// Заголовок корневой вкладки: без кнопки «назад», с настройками.
class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 12, 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Сводка',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontSize: 30),
              ),
            ),
            IconButton(
              icon: const Icon(LucideIcons.settings,
                  size: 20, color: AppColors.textSecondary),
              onPressed: () => context.push('/settings'),
            ),
          ],
        ),
      );
}

class _FreeMoney extends StatelessWidget {
  const _FreeMoney({required this.data});

  final MonthOverview data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = AppColors.forAvailable(data.readyToAssignCents);

    return SurfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            formatMonthLabel(data.month),
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 12,
              color: AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Свободно',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            data.readyToAssignFormatted,
            style: theme.textTheme.headlineMedium?.copyWith(
              fontSize: 34,
              fontWeight: FontWeight.w800,
              fontFeatures: kTabularFigures,
              color: color,
            ),
          ),
          if (data.isOverAssigned) ...[
            const SizedBox(height: 10),
            const InfoNote(
              icon: LucideIcons.alertTriangle,
              background: AppColors.warningSoft,
              foreground: Color(0xFF8A5A00),
              text: 'Роздано больше, чем есть. Пока это не выправить, '
                  'любое новое назначение отбирает деньги у другой категории.',
            ),
          ],
        ],
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  const _Actions({required this.data});

  final MonthOverview data;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Пустой список — это ответ, а не отсутствие ответа: сервер предлагает
    // только то, на что есть деньги.
    if (data.actions.isEmpty) {
      return SurfaceCard(
        child: Row(
          children: [
            const Icon(LucideIcons.checkCircle2,
                size: 18, color: AppColors.positive),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Сейчас ничего не требуется',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(
            'Что стоит сделать',
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: 6),
        RowsCard(
          children: [
            for (final a in data.actions)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(LucideIcons.arrowRightCircle,
                        size: 16, color: AppColors.accent),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        a.why,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontSize: 13,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _Lines extends StatelessWidget {
  const _Lines({
    required this.title,
    required this.lines,
    required this.negative,
  });

  final String title;
  final List<OverviewLine> lines;
  final bool negative;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(
            title,
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: 6),
        RowsCard(
          children: [
            for (final l in lines)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        l.categoryName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(fontSize: 14),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      l.amountFormatted,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        fontFeatures: kTabularFigures,
                        color: negative
                            ? AppColors.negative
                            : AppColors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _Upcoming extends StatelessWidget {
  const _Upcoming({required this.items});

  final List<UpcomingPayment> items;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final manual = items.where((i) => !i.autoPost).length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Text(
            manual == 0
                ? 'Скоро спишется'
                : 'Скоро спишется · $manual ${plural(manual, "вручную", "вручную", "вручную")}',
            style: theme.textTheme.bodySmall?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(height: 6),
        RowsCard(
          children: [
            for (final u in items)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            u.payeeName ?? 'Без плательщика',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            u.autoPost
                                ? formatDayLabel(u.nextDate)
                                : '${formatDayLabel(u.nextDate)} · завести руками',
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontSize: 11,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      formatMoneySmart(u.amountCents.abs()),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        fontFeatures: kTabularFigures,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}
