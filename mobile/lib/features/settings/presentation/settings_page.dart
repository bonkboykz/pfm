import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/di/di.dart';
import '../../../core/env/env.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';

/// No cubit here on purpose — it talks to TokenStorage/ApiClient directly.
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();

  bool _loading = true;
  bool _checking = false;
  bool _obscureKey = true;
  String? _status;
  bool _statusIsError = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final tokens = sl<TokenStorage>();
    final api = sl<ApiClient>();
    final key = await tokens.apiKey();
    if (!mounted) return;
    setState(() {
      _baseUrlController.text = api.baseUrl;
      _apiKeyController.text = key ?? '';
      _loading = false;
    });
  }

  Future<void> _checkAndSave() async {
    setState(() {
      _checking = true;
      _status = null;
    });

    final tokens = sl<TokenStorage>();
    final api = sl<ApiClient>();

    final baseUrl = _baseUrlController.text.trim().replaceAll(RegExp(r'/+$'), '');
    final key = _apiKeyController.text.trim();
    final previousBaseUrl = api.baseUrl;

    try {
      if (baseUrl.isNotEmpty) api.baseUrl = baseUrl;
      await tokens.setApiKey(key);

      // /health is public — proves the URL is reachable and the server is up.
      final health = await api.get('/health');
      final ok = health is Map && health['status'] == 'ok';
      if (!ok) throw ApiException('Неожиданный ответ /health');

      // Then one authenticated call to prove the key itself works.
      await api.get('/api/v1/accounts');

      await tokens.setBaseUrlOverride(
        baseUrl == Env.apiBaseUrl ? null : baseUrl,
      );

      if (!mounted) return;
      setState(() {
        _status = 'Подключение работает, настройки сохранены';
        _statusIsError = false;
      });
    } on ApiException catch (e) {
      api.baseUrl = previousBaseUrl;
      if (!mounted) return;
      setState(() {
        _status = e.isUnauthorized
            ? 'Сервер отвечает, но ключ неверный'
            : 'Не удалось подключиться: ${e.message}';
        _statusIsError = true;
      });
    } catch (e) {
      api.baseUrl = previousBaseUrl;
      if (!mounted) return;
      setState(() {
        _status = 'Не удалось подключиться: $e';
        _statusIsError = true;
      });
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Настройки')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              children: [
                Text('Подключение', style: theme.textTheme.titleLarge),
                const SizedBox(height: 12),
                TextField(
                  controller: _baseUrlController,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Адрес API',
                    prefixIcon: Icon(LucideIcons.globe, size: 18),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _apiKeyController,
                  obscureText: _obscureKey,
                  autocorrect: false,
                  enableSuggestions: false,
                  decoration: InputDecoration(
                    labelText: 'API-ключ',
                    prefixIcon: const Icon(LucideIcons.keyRound, size: 18),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _obscureKey ? LucideIcons.eye : LucideIcons.eyeOff,
                        size: 18,
                      ),
                      onPressed: () =>
                          setState(() => _obscureKey = !_obscureKey),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _checking ? null : _checkAndSave,
                  child: _checking
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Проверить и сохранить'),
                ),
                if (_status != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        _statusIsError
                            ? LucideIcons.alertCircle
                            : LucideIcons.checkCircle2,
                        size: 18,
                        color: _statusIsError
                            ? AppColors.negative
                            : AppColors.positive,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _status!,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: _statusIsError
                                ? AppColors.negative
                                : AppColors.positive,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 28),
                Text('О приложении', style: theme.textTheme.titleLarge),
                const SizedBox(height: 12),
                _InfoRow(label: 'Адрес по умолчанию', value: Env.apiBaseUrl),
                _InfoRow(
                  label: 'Ключ из сборки',
                  value: Env.apiKey.isEmpty ? 'не задан' : 'задан',
                ),
              ],
            ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}
