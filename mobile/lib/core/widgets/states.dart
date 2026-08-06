import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/theme.dart';

/// The five "Ещё" sub-screens share identical chrome, so unlike the tab
/// features — which keep their own private widgets — these live here rather
/// than being copied six times.

class DomainAppBar extends StatelessWidget {
  const DomainAppBar({super.key, required this.title, this.actions});

  final String title;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(8, 4, 16, 8),
        child: Row(
          children: [
            IconButton(
              icon: const Icon(LucideIcons.chevronLeft, size: 24),
              onPressed: () => context.pop(),
            ),
            Expanded(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontSize: 22, fontWeight: FontWeight.w800),
              ),
            ),
            ...?actions,
          ],
        ),
      );
}

class ErrorStateView extends StatelessWidget {
  const ErrorStateView({
    super.key,
    required this.unauthorized,
    required this.error,
    required this.title,
    required this.onRetry,
  });

  final bool unauthorized;
  final String? error;
  final String title;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

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
              unauthorized ? 'Нужен API-ключ' : title,
              style: theme.textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              unauthorized
                  ? 'Укажите ключ в настройках, чтобы продолжить.'
                  : (error ?? 'Проверьте соединение и попробуйте снова.'),
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
                    onPressed: onRetry,
                    child: const Text('Повторить'),
                  ),
          ],
        ),
      ),
    );
  }
}

class EmptyStateView extends StatelessWidget {
  const EmptyStateView({
    super.key,
    required this.icon,
    required this.text,
    this.hint,
  });

  final IconData icon;
  final String text;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 56, horizontal: 24),
      child: Column(
        children: [
          Icon(icon, size: 36, color: AppColors.textMuted),
          const SizedBox(height: 12),
          Text(
            text,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          if (hint != null) ...[
            const SizedBox(height: 6),
            Text(
              hint!,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: AppColors.textSecondary),
            ),
          ],
        ],
      ),
    );
  }
}

class SurfaceCard extends StatelessWidget {
  const SurfaceCard({super.key, required this.child, this.padding});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: padding ?? const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadii.card),
          border: Border.all(color: AppColors.border),
        ),
        child: child,
      );
}

/// A rounded container whose children are separated by hairlines.
class RowsCard extends StatelessWidget {
  const RowsCard({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1, indent: 14, endIndent: 14));
      rows.add(children[i]);
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: rows),
    );
  }
}

class InfoNote extends StatelessWidget {
  const InfoNote({
    super.key,
    required this.text,
    this.icon = LucideIcons.info,
    this.background = AppColors.neutralSoft,
    this.foreground = AppColors.textSecondary,
  });

  final String text;
  final IconData icon;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(AppRadii.inner),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 14, color: foreground),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(fontSize: 11, color: foreground),
              ),
            ),
          ],
        ),
      );
}

/// Confirmation for actions that write to production data.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
  bool destructive = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(
            minimumSize: const Size(88, 40),
            backgroundColor: destructive ? AppColors.negative : null,
          ),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok ?? false;
}

void showToast(BuildContext context, String message, {bool isError = false}) {
  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: isError ? AppColors.negative : AppColors.textPrimary,
    ),
  );
}
