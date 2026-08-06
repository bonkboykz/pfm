import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_errors.dart';
import '../data/scheduled_models.dart';
import '../data/scheduled_repository.dart';

enum ScheduledStatus { initial, loading, ready, error }

class ScheduledState extends Equatable {
  final ScheduledStatus status;
  final ScheduledData? data;
  final bool processing;
  final String? error;
  final bool unauthorized;

  const ScheduledState({
    this.status = ScheduledStatus.initial,
    this.data,
    this.processing = false,
    this.error,
    this.unauthorized = false,
  });

  ScheduledState copyWith({
    ScheduledStatus? status,
    ScheduledData? data,
    bool? processing,
    String? error,
    bool? unauthorized,
  }) =>
      ScheduledState(
        status: status ?? this.status,
        data: data ?? this.data,
        processing: processing ?? this.processing,
        error: error,
        unauthorized: unauthorized ?? this.unauthorized,
      );

  @override
  List<Object?> get props => [status, data, processing, error, unauthorized];
}

class ScheduledCubit extends Cubit<ScheduledState> {
  final ScheduledRepository _repo;
  ScheduledCubit(this._repo) : super(const ScheduledState());

  Future<void> load() async {
    emit(state.copyWith(status: ScheduledStatus.loading));
    try {
      emit(state.copyWith(
          status: ScheduledStatus.ready, data: await _repo.list()));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: ScheduledStatus.error,
        error: humanizeApiError(e),
        unauthorized: e.isUnauthorized,
      ));
    } catch (e) {
      emit(state.copyWith(status: ScheduledStatus.error, error: e.toString()));
    }
  }

  /// Returns the result on success, or throws nothing — errors come back as a
  /// message so the caller can surface them without losing the screen.
  Future<({ProcessResult? result, String? error})> process() async {
    emit(state.copyWith(processing: true));
    try {
      final result = await _repo.process();
      await load();
      emit(state.copyWith(processing: false));
      return (result: result, error: null);
    } on ApiException catch (e) {
      emit(state.copyWith(processing: false));
      return (result: null, error: humanizeApiError(e));
    } catch (e) {
      emit(state.copyWith(processing: false));
      return (result: null, error: e.toString());
    }
  }

  Future<String?> delete(String id) async {
    try {
      await _repo.delete(id);
      await load();
      return null;
    } on ApiException catch (e) {
      return humanizeApiError(e);
    } catch (e) {
      return e.toString();
    }
  }
}
