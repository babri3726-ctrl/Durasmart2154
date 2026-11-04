import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:demo_operations_mobile/data/mock_repository.dart';
import 'package:demo_operations_mobile/data/models.dart';
import 'package:demo_operations_mobile/features/auth/login_screen.dart';
import 'package:demo_operations_mobile/features/auth/register_screen.dart';
import 'package:demo_operations_mobile/features/org/profile_screen.dart';

Widget _wrap(Widget child, MockRepository repo) {
  return ChangeNotifierProvider<MockRepository>.value(
    value: repo,
    child: MaterialApp(
      routes: {
        '/home': (_) => const Scaffold(body: Text('route:/home')),
        '/login': (_) => const Scaffold(body: Text('route:/login')),
        '/register': (_) => const Scaffold(body: Text('route:/register')),
        '/profile': (_) => const Scaffold(body: Text('route:/profile')),
        '/settings': (_) => const Scaffold(body: Text('route:/settings')),
      },
      home: child,
    ),
  );
}

void _useWideScreen(WidgetTester tester, {double height = 3200}) {
  tester.view.physicalSize = Size(1200, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  group('Mobile APK Auth & Registration Security Suite', () {
    testWidgets('LoginScreen: rejects empty credentials with validation messages', (tester) async {
      _useWideScreen(tester);
      final repo = MockRepository();
      await tester.pumpWidget(_wrap(const LoginScreen(), repo));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Email or employee ID is required'), findsOneWidget);
      expect(find.text('Password is required'), findsOneWidget);
      expect(repo.signedIn, isFalse);
    });

    testWidgets('LoginScreen: rejects short passwords under 6 characters', (tester) async {
      _useWideScreen(tester);
      final repo = MockRepository();
      await tester.pumpWidget(_wrap(const LoginScreen(), repo));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).first, 'user@durasmart.in');
      await tester.enterText(find.byType(TextFormField).last, '123');
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Use at least 6 characters'), findsOneWidget);
      expect(repo.signedIn, isFalse);
    });

    testWidgets('LoginScreen: rejects wrong passcode and keeps session signed out', (tester) async {
      _useWideScreen(tester);
      final repo = MockRepository();
      await tester.pumpWidget(_wrap(const LoginScreen(), repo));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextFormField).first, 'owner@example.test');
      await tester.enterText(find.byType(TextFormField).last, 'IncorrectPassword123');
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(repo.signedIn, isFalse);
      expect(find.textContaining('Incorrect ID / email or passcode'), findsOneWidget);
    });

    testWidgets('RegisterScreen: validates required fields and password matching', (tester) async {
      _useWideScreen(tester);
      final repo = MockRepository();
      await tester.pumpWidget(_wrap(const RegisterScreen(), repo));
      await tester.pumpAndSettle();

      // Submit empty form
      await tester.tap(find.text('Complete Registration'));
      await tester.pumpAndSettle();

      expect(find.text('Full name is required'), findsOneWidget);
      expect(find.text('Email or mobile is required'), findsOneWidget);
      expect(find.text('Invite code is required'), findsOneWidget);

      // Fill mismatched passwords
      await tester.enterText(find.byType(TextFormField).at(0), 'Simranjit Singh');
      await tester.enterText(find.byType(TextFormField).at(1), '9814012345');
      await tester.enterText(find.byType(TextFormField).at(3), 'DURA-2026');
      await tester.enterText(find.byType(TextFormField).at(4), 'SecretPassword123');
      await tester.enterText(find.byType(TextFormField).at(5), 'MismatchedPassword');

      await tester.tap(find.text('Complete Registration'));
      await tester.pumpAndSettle();

      expect(find.text('Passwords do not match'), findsOneWidget);
    });

    testWidgets('ProfileScreen: displays user details, role badge, and change password action', (tester) async {
      _useWideScreen(tester, height: 3500);
      final repo = MockRepository();
      repo.authenticate('harpreet@example.test', MockRepository.demoPasscode);

      await tester.pumpWidget(_wrap(const ProfileScreen(), repo));
      await tester.pumpAndSettle();

      expect(find.text('Account details'), findsOneWidget);
      expect(find.text('Change Password'), findsOneWidget);
      expect(find.text('Sign out'), findsOneWidget);

      // Open Change Password Dialog
      await tester.tap(find.text('Change Password'));
      await tester.pumpAndSettle();

      expect(find.text('Current password'), findsOneWidget);
      expect(find.text('New password'), findsOneWidget);
    });
  });
}
