import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';

import 'app.dart';
import 'core/api_sync_service.dart';
import 'data/mock_repository.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  } catch (e) {
    debugPrint('Firebase init note: $e');
  }
  await ApiSyncService.initStorage();
  final repo = MockRepository();
  final restored = repo.restoreSession();
  runApp(
    ChangeNotifierProvider.value(
      value: repo,
      child: OperationsApp(
        initialRoute: restored ? '/home' : '/login',
      ),
    ),
  );
}
