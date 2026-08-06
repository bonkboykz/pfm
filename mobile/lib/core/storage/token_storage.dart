import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../env/env.dart';

/// Secure storage for the PFM API key (single-user Bearer) and an optional
/// base-URL override.
class TokenStorage {
  final FlutterSecureStorage _s;
  TokenStorage([FlutterSecureStorage? s])
      : _s = s ?? const FlutterSecureStorage();

  static const _kApiKey = 'pfm.apiKey';
  static const _kBaseUrl = 'pfm.baseUrl';

  Future<String?> apiKey() async {
    final stored = await _s.read(key: _kApiKey);
    if (stored != null && stored.isNotEmpty) return stored;
    return Env.apiKey.isNotEmpty ? Env.apiKey : null; // build-time fallback
  }

  Future<void> setApiKey(String value) =>
      _s.write(key: _kApiKey, value: value.trim());

  Future<String?> baseUrlOverride() => _s.read(key: _kBaseUrl);

  Future<void> setBaseUrlOverride(String? value) =>
      (value == null || value.trim().isEmpty)
          ? _s.delete(key: _kBaseUrl)
          : _s.write(key: _kBaseUrl, value: value.trim());
}
