import 'package:get_it/get_it.dart';

import '../network/api_client.dart';
import '../storage/token_storage.dart';

final sl = GetIt.instance;

/// Registers shared singletons. Features build their own repository/cubit from
/// `sl<ApiClient>()` in their page (so feature code never edits this file).
Future<void> setupDependencies() async {
  final tokens = TokenStorage();
  sl.registerSingleton<TokenStorage>(tokens);

  final api = ApiClient(tokens);
  final override = await tokens.baseUrlOverride();
  if (override != null && override.isNotEmpty) api.baseUrl = override;
  sl.registerSingleton<ApiClient>(api);
}
