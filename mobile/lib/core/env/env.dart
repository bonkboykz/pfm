/// Compile-time config (override with --dart-define=API_BASE_URL=...).
class Env {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api-production-a69c.up.railway.app',
  );

  /// Optional build-time key (--dart-define=API_KEY=...). Used only as a fallback
  /// when the user hasn't set a key in Settings. Never committed.
  static const apiKey = String.fromEnvironment('API_KEY', defaultValue: '');
}
