import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// PFM design tokens. Accent is teal — deliberately distinct from HTR's indigo,
/// and kept away from the green/amber/red trio that carries budget semantics.
abstract class AppColors {
  static const accent = Color(0xFF0D9488);
  static const accentSoft = Color(0xFFE6F5F3);

  static const bg = Color(0xFFF6F7F9);
  static const surface = Color(0xFFFFFFFF);
  static const border = Color(0xFFECEEF1);

  static const textPrimary = Color(0xFF14161A);
  static const textSecondary = Color(0xFF6B7280);
  static const textMuted = Color(0xFF9AA1AC);

  // Budget semantics — never reuse these for branding.
  static const positive = Color(0xFF16A34A); // available > 0
  static const positiveSoft = Color(0xFFE7F6EC);
  static const neutral = Color(0xFF9AA1AC); // available == 0
  static const neutralSoft = Color(0xFFF1F3F5);
  static const negative = Color(0xFFDC2626); // overspent
  static const negativeSoft = Color(0xFFFDECEC);
  static const warning = Color(0xFFF59E0B); // underfunded
  static const warningSoft = Color(0xFFFEF4E3);

  /// Pill/text colour for a category's cumulative `available`.
  static Color forAvailable(int cents) {
    if (cents < 0) return negative;
    if (cents == 0) return neutral;
    return positive;
  }

  static Color forAvailableSoft(int cents) {
    if (cents < 0) return negativeSoft;
    if (cents == 0) return neutralSoft;
    return positiveSoft;
  }

  /// Colour for a signed transaction amount.
  static Color forAmount(int cents) =>
      cents > 0 ? positive : (cents == 0 ? textSecondary : textPrimary);
}

abstract class AppRadii {
  static const card = 20.0;
  static const inner = 14.0;
  static const pill = 999.0;
}

/// Money must line up in columns — every numeric style uses tabular figures.
const kTabularFigures = [FontFeature.tabularFigures()];

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: AppColors.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.accent,
      primary: AppColors.accent,
      error: AppColors.negative,
      surface: AppColors.surface,
    ),
  );

  final display = GoogleFonts.manropeTextTheme(base.textTheme);
  final body = GoogleFonts.interTextTheme(base.textTheme);
  final textTheme = body
      .copyWith(
        displayLarge: display.displayLarge,
        displayMedium: display.displayMedium,
        displaySmall: display.displaySmall,
        headlineLarge:
            display.headlineLarge?.copyWith(fontWeight: FontWeight.w800),
        headlineMedium:
            display.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
        headlineSmall:
            display.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
        titleLarge: display.titleLarge?.copyWith(fontWeight: FontWeight.w700),
      )
      .apply(
        bodyColor: AppColors.textPrimary,
        displayColor: AppColors.textPrimary,
      );

  return base.copyWith(
    textTheme: textTheme,
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bg,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      foregroundColor: AppColors.textPrimary,
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.card),
        side: const BorderSide(color: AppColors.border),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      indicatorColor: AppColors.accentSoft,
      elevation: 0,
      labelTextStyle: WidgetStateProperty.all(
        GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w500),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.accent,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.inner),
        ),
        textStyle: GoogleFonts.inter(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: AppColors.accent,
      foregroundColor: Colors.white,
      elevation: 2,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.textPrimary,
      contentTextStyle: GoogleFonts.inter(fontSize: 14, color: Colors.white),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.inner),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.bg,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.inner),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.inner),
        borderSide: const BorderSide(color: AppColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.inner),
        borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
  );
}
