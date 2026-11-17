import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'core/api_sync_service.dart';
import 'data/mock_repository.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  ApiSyncService.initAuthToken();
  runApp(
    ChangeNotifierProvider(
      create: (_) => MockRepository(),
      child: const OperationsApp(),
    ),
  );
}
