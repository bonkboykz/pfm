import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/theme.dart';

/// Stub for a tab that hasn't been built yet. Every route ships with one so the
/// shell is navigable from wave 0 onward; replaced as each feature lands.
class FeaturePlaceholder extends StatelessWidget {
  const FeaturePlaceholder({
    super.key,
    required this.title,
    required this.note,
    this.showSettings = false,
  });

  final String title;
  final String note;
  final bool showSettings;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          if (showSettings)
            IconButton(
              icon: const Icon(LucideIcons.settings, size: 20),
              onPressed: () => context.push('/settings'),
            ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(LucideIcons.hammer, size: 40, color: AppColors.textMuted),
              const SizedBox(height: 12),
              Text('Экран в разработке', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(
                note,
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
