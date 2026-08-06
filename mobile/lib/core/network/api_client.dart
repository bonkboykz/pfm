import 'package:dio/dio.dart';

import '../env/env.dart';
import '../storage/token_storage.dart';

class ApiException implements Exception {
  final String code;
  final String message;
  final String? suggestion;
  final int? status;

  ApiException(
    this.message, {
    this.code = 'ERROR',
    this.suggestion,
    this.status,
  });

  bool get isUnauthorized => status == 401;

  @override
  String toString() => message;
}

/// Thin Dio wrapper over the PFM REST API. Features call get/post/patch/delete
/// and parse their own JSON. The Bearer token is attached per-request from
/// [TokenStorage], so changing the key takes effect immediately.
class ApiClient {
  final Dio dio;
  final TokenStorage tokens;

  ApiClient(this.tokens, {String? baseUrl})
      : dio = Dio(
          BaseOptions(
            baseUrl: baseUrl ?? Env.apiBaseUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 20),
            headers: {'Content-Type': 'application/json'},
          ),
        ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final key = await tokens.apiKey();
          if (key != null && key.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $key';
          }
          handler.next(options);
        },
      ),
    );
  }

  set baseUrl(String value) => dio.options.baseUrl = value;
  String get baseUrl => dio.options.baseUrl;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _run(() => dio.get(path, queryParameters: query));

  Future<dynamic> post(String path, {Object? body}) =>
      _run(() => dio.post(path, data: body));

  Future<dynamic> patch(String path, {Object? body}) =>
      _run(() => dio.patch(path, data: body));

  Future<dynamic> delete(String path) => _run(() => dio.delete(path));

  Future<dynamic> _run(Future<Response> Function() call) async {
    try {
      return (await call()).data;
    } on DioException catch (e) {
      final data = e.response?.data;
      if (data is Map && data['error'] is Map) {
        final err = data['error'] as Map;
        throw ApiException(
          (err['message'] ?? 'Request failed').toString(),
          code: (err['code'] ?? 'ERROR').toString(),
          suggestion: err['suggestion']?.toString(),
          status: e.response?.statusCode,
        );
      }
      throw ApiException(
        e.message ?? 'Network error',
        status: e.response?.statusCode,
      );
    }
  }
}
