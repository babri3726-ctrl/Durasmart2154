import 'package:flutter/material.dart';

/// Dura Smart design system — approved Option 3 colourful gradient theme.
/// Blue, purple, orange, teal, pink on white/light surfaces.
class AppColors {
  AppColors._();

  static const navy = Color(0xFF172554);
  static const ink = Color(0xFF182033);
  static const muted = Color(0xFF738099);
  static const faint = Color(0xFF9AA4B7);
  static const background = Color(0xFFF5F6FC);
  static const line = Color(0xFFE4E8F2);

  static const blue = Color(0xFF3977F6);
  static const purple = Color(0xFF8750F5);
  static const orange = Color(0xFFFF9D43);
  static const teal = Color(0xFF19BBA5);
  static const pink = Color(0xFFED5DA8);
  static const green = Color(0xFF1DA96B);
  static const red = Color(0xFFE24B5A);
  static const whatsapp = Color(0xFF20AD6A);
}

class AppGradients {
  AppGradients._();

  static const brand = LinearGradient(
    colors: [Color(0xFF3178F6), Color(0xFF8050F3), Color(0xFFB74CEB)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static LinearGradient get sales => _g(AppColors.blue, AppColors.purple);
  static LinearGradient get payment => _g(AppColors.teal, AppColors.blue);
  static LinearGradient get area =>
      _g(AppColors.orange, const Color(0xFFFF6F61));
  static LinearGradient get tour => _g(const Color(0xFF9257F4), AppColors.pink);
  static LinearGradient get customer => _g(AppColors.teal, AppColors.blue);
  static LinearGradient get order => _g(AppColors.orange, AppColors.pink);
  static LinearGradient get task => _g(AppColors.blue, AppColors.purple);
  static LinearGradient get dispatch => _g(AppColors.purple, AppColors.pink);
  static LinearGradient get employee =>
      _g(AppColors.teal, const Color(0xFF9257F4));
  static LinearGradient get danger => _g(AppColors.orange, AppColors.red);
  static LinearGradient get success => _g(AppColors.green, AppColors.teal);

  static LinearGradient _g(Color a, Color b) => LinearGradient(
    colors: [a, b],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}

class AppRadius {
  AppRadius._();
  static const card = 20.0;
  static const tile = 22.0;
  static const field = 14.0;
}

class AppSpacing {
  AppSpacing._();
  static const page = EdgeInsets.symmetric(horizontal: 16, vertical: 16);
  static const gap = SizedBox(height: 14);
  static const gapLg = SizedBox(height: 22);
  static const gapSm = SizedBox(height: 8);
  static const gapXs = SizedBox(height: 5);
}

class AppText {
  AppText._();
  static const title = TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w900,
    color: AppColors.ink,
  );
  static const heading = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w900,
    color: AppColors.ink,
  );
  static const body = TextStyle(fontSize: 13, color: AppColors.ink);
  static const caption = TextStyle(fontSize: 11, color: AppColors.muted);
  static const value = TextStyle(
    fontSize: 23,
    fontWeight: FontWeight.w900,
    color: AppColors.ink,
    letterSpacing: -.5,
  );
}

class AppTheme {
  AppTheme._();

  static ThemeData get light => ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AppColors.background,
    colorScheme: ColorScheme.fromSeed(seedColor: AppColors.blue),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.background,
      foregroundColor: AppColors.ink,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontWeight: FontWeight.w900,
        fontSize: 19,
        color: AppColors.ink,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: AppColors.purple),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      labelStyle: const TextStyle(color: AppColors.muted),
      hintStyle: const TextStyle(color: AppColors.faint),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.field),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.field),
        borderSide: const BorderSide(color: AppColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.field),
        borderSide: const BorderSide(color: AppColors.blue, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.field),
        borderSide: const BorderSide(color: AppColors.red),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppField.radius),
        borderSide: const BorderSide(color: AppColors.red, width: 1.5),
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}

class AppField {
  AppField._();
  static const radius = 14.0;
}
