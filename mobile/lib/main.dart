import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'data/mock_repository.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => MockRepository(),
      child: const OperationsApp(),
    ),
  );
}
