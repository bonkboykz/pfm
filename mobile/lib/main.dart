import 'package:flutter/material.dart';

import 'app/app.dart';
import 'core/di/di.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await setupDependencies();
  runApp(const PfmApp());
}
