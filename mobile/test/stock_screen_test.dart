import 'package:demo_operations_mobile/data/mock_repository.dart';
import 'package:demo_operations_mobile/features/stock/stock_home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

Widget _wrap(Widget child, MockRepository repo) =>
    ChangeNotifierProvider<MockRepository>.value(
      value: repo,
      child: MaterialApp(
        home: child,
      ),
    );

void main() {
  testWidgets('StockHomeScreen renders tabs, 1-Click Sync, and KPIs', (tester) async {
    tester.view.physicalSize = const Size(411, 891);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_wrap(const StockHomeScreen(), MockRepository()));
    await tester.pump();

    // Verify AppBar title
    expect(find.text('Stock Inventory'), findsOneWidget);

    // Verify Tab headers
    expect(find.text('Overview & Sync'), findsOneWidget);
    expect(find.textContaining('Steel Coils'), findsOneWidget);
    expect(find.textContaining('UPVC Matrix'), findsOneWidget);

    // Verify 1-Click Sync button
    expect(find.text('1-Click Sync Now'), findsOneWidget);

    // Verify Metrics
    expect(find.text('Total Metal'), findsOneWidget);
    expect(find.text('UPVC Roofing'), findsOneWidget);
    expect(find.text('Accessories (UPVC ITEM)'), findsOneWidget);
    expect(find.text('RIDGE'), findsOneWidget);
    expect(find.text('JHALLAR'), findsOneWidget);
    expect(find.text('CAPS'), findsOneWidget);
  });
}
