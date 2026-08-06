import 'package:flutter/material.dart';

import 'router.dart';
import 'theme.dart';

class PfmApp extends StatelessWidget {
  const PfmApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'PFM',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      routerConfig: appRouter,
    );
  }
}
