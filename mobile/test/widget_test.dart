import 'package:demo_operations_mobile/app.dart';
import 'package:demo_operations_mobile/data/mock_repository.dart';
import 'package:demo_operations_mobile/data/models.dart';
import 'package:demo_operations_mobile/features/auth/login_screen.dart';
import 'package:demo_operations_mobile/features/dispatch/dispatch_screen.dart';
import 'package:demo_operations_mobile/features/home/home_shell.dart';
import 'package:demo_operations_mobile/features/payments/customer_ledger_screen.dart';
import 'package:demo_operations_mobile/features/sales/customer_detail_screen.dart';
import 'package:demo_operations_mobile/features/sales/order_detail_screen.dart';
import 'package:demo_operations_mobile/features/sales/sales_dashboard_screen.dart';
import 'package:demo_operations_mobile/features/tasks/task_detail_screen.dart';
import 'package:demo_operations_mobile/features/tasks/task_dashboard_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

Widget _wrap(Widget child, MockRepository repo) =>
    ChangeNotifierProvider<MockRepository>.value(
      value: repo,
      child: MaterialApp(
        home: child,
        onGenerateRoute: (settings) => MaterialPageRoute<void>(
          settings: settings,
          builder: (context) =>
              Scaffold(body: Center(child: Text('route:${settings.name}'))),
        ),
      ),
    );

void _useWideScreen(WidgetTester tester, {double height = 2600}) {
  tester.view.physicalSize = Size(1200, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void _usePhoneScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(411, 891);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  group('login screen', () {
    testWidgets('renders identity and password fields', (tester) async {
      _useWideScreen(tester);
      await tester.pumpWidget(_wrap(const LoginScreen(), MockRepository()));
      await tester.pumpAndSettle();

      expect(find.byType(TextFormField), findsNWidgets(2));
      expect(find.byType(Form), findsOneWidget);
    });

    testWidgets('rejects an empty password with an inline message', (
      tester,
    ) async {
      _useWideScreen(tester);
      final repo = MockRepository();
      await tester.pumpWidget(_wrap(const LoginScreen(), repo));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byType(TextFormField).first,
        'ishu.jindal@durasmart.com',
      );
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(find.text('Password is required'), findsOneWidget);
      expect(repo.signedIn, isFalse);
    });

    testWidgets('demo credentials sign in the owner and open the workspace', (
      tester,
    ) async {
      _useWideScreen(tester);
      final repo = MockRepository();
      await tester.pumpWidget(_wrap(const LoginScreen(), repo));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byType(TextFormField).first,
        'ishu.jindal@durasmart.com',
      );
      await tester.enterText(
        find.byType(TextFormField).last,
        MockRepository.ownerPasscode,
      );
      await tester.tap(find.text('Sign in'));
      await tester.pumpAndSettle();

      expect(repo.signedIn, isTrue);
      expect(repo.currentUser!.role, UserRole.owner);
      expect(repo.currentUser!.name, 'Ishu Jindal');
      expect(find.text('route:/home'), findsOneWidget);
    });
  });

  group('home dashboard', () {
    testWidgets('shows the approved department menu labels', (tester) async {
      _useWideScreen(tester, height: 3200);
      final repo = MockRepository()
        ..authenticate('ishu.jindal@durasmart.com', MockRepository.ownerPasscode);
      await tester.pumpWidget(_wrap(const HomeShell(), repo));
      await tester.pumpAndSettle();

      for (final label in [
        'Sales',
        'Payment',
        'Vaccant Area',
        'Tour Plan',
        'New Customer Add',
        'New Order',
        'Task Alarm',
      ]) {
        expect(
          find.text(label),
          findsWidgets,
          reason: 'missing menu label: $label',
        );
      }
    });
  });

  group('sales dashboard', () {
    testWidgets('renders the metric cards', (tester) async {
      _useWideScreen(tester, height: 3400);
      final repo = MockRepository()
        ..authenticate('ishu.jindal@durasmart.com', MockRepository.ownerPasscode);
      await tester.pumpWidget(_wrap(const SalesDashboardScreen(), repo));
      await tester.pumpAndSettle();

      for (final label in [
        'Monthly Target',
        'Order Received',
        'Order Pending',
        'Pending for Dispatch',
        'Pending Target',
        'Payment Balance',
      ]) {
        expect(
          find.text(label),
          findsWidgets,
          reason: 'missing metric card: $label',
        );
      }
    });
  });

  group('mock repository derives figures from records', () {
    test('a recorded payment moves cash from balance to received', () {
      final repo = MockRepository();
      final order = repo.orders.firstWhere((o) => repo.orderBalance(o.id) > 0);
      final before = repo.salesMetrics();
      final amount = repo.orderBalance(order.id) / 2;

      final saved = repo.recordPayment(
        customerId: order.customerId,
        orderId: order.id,
        amount: amount,
        method: PaymentMethod.upi,
        notes: 'part payment',
      );

      expect(saved, isNotNull);
      final after = repo.salesMetrics();
      expect(
        after.paymentReceived,
        closeTo(before.paymentReceived + amount, 0.01),
      );
      expect(
        after.paymentBalance,
        closeTo(before.paymentBalance - amount, 0.01),
      );
    });

    test('a negative or over-balance payment is refused', () {
      final repo = MockRepository();
      final order = repo.orders.firstWhere((o) => repo.orderBalance(o.id) > 0);

      expect(
        repo.recordPayment(
          customerId: order.customerId,
          orderId: order.id,
          amount: -500,
          method: PaymentMethod.cash,
        ),
        isNull,
      );
      expect(
        repo.recordPayment(
          customerId: order.customerId,
          orderId: order.id,
          amount: repo.orderBalance(order.id) + 10000,
          method: PaymentMethod.cash,
        ),
        isNull,
      );
    });

    test('a new order appears in the dashboard counts', () {
      final repo = MockRepository();
      final customer = repo.customers.first;
      final before = repo.salesMetrics().ordersReceived;

      repo.addOrder(
        customerId: customer.id,
        items: [
          OrderItem(product: 'PPGI Coil', quantity: 2, unit: 'MT', rate: 60000),
        ],
        expectedDispatchDate: DateTime.now().add(const Duration(days: 3)),
      );

      expect(repo.salesMetrics().ordersReceived, before + 1);
    });

    test('partial dispatch never marks an order fully dispatched', () {
      final repo = MockRepository();
      final order = repo.orders.firstWhere(
        (o) => o.status == OrderStatus.pendingDispatch,
      );
      final item = order.items.first;

      repo.addDispatch(
        orderId: order.id,
        lines: [
          DispatchLine(
            product: item.product,
            quantity: item.quantity / 2,
            unit: item.unit,
          ),
        ],
        vehicle: 'PB-01-A-1234',
        driver: 'Test Driver',
      );

      final refreshed = repo.orderById(order.id)!;
      expect(refreshed.status, isNot(OrderStatus.dispatched));
      expect(repo.orderDispatchedQty(order.id), lessThan(order.totalQty));
    });

    test('a new customer waits for approval before it is active', () {
      final repo = MockRepository();
      final created = repo.addCustomer(
        name: 'Test Traders',
        contactPerson: 'Test Person',
        mobile: '9814000000',
        city: 'Ludhiana',
        salespersonId: 'EMP-101',
        approvalRequired: true,
      );

      expect(created.status, CustomerStatus.pendingApproval);
      repo.approveCustomer(created.id);
      expect(repo.customerById(created.id)!.status, CustomerStatus.active);
    });
  });

  group('screens render on a phone without layout errors', () {
    const routes = [
      '/login',
      '/forgot',
      '/register',
      '/home',
      '/sales',
      '/customers',
      '/debtors',
      '/new-customer',
      '/performance',
      '/orders',
      '/new-order',
      '/dispatch',
      '/dispatch-history',
      '/payments',
      '/record-payment',
      '/outstanding',
      '/areas',
      '/tours',
      '/tasks',
      '/create-task',
      '/task-review',
      '/employees',
      '/profile',
      '/settings',
    ];

    for (final route in routes) {
      testWidgets('$route renders', (tester) async {
        _usePhoneScreen(tester);
        final repo = MockRepository()
          ..authenticate('ishu.jindal@durasmart.com', MockRepository.ownerPasscode);
        await tester.pumpWidget(
          ChangeNotifierProvider<MockRepository>.value(
            value: repo,
            child: DuraSmartApp(initialRoute: route),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          tester.takeException(),
          isNull,
          reason: 'layout error on $route',
        );
        expect(find.byType(Scaffold), findsWidgets);
      });
    }

    testWidgets('detail screens render with real record ids', (tester) async {
      _usePhoneScreen(tester);
      final repo = MockRepository()
        ..authenticate('ishu.jindal@durasmart.com', MockRepository.ownerPasscode);
      final screens = <Widget>[
        CustomerDetailScreen(customerId: repo.customers.first.id),
        OrderDetailScreen(orderId: repo.orders.first.id),
        CustomerLedgerScreen(customerId: repo.customers.first.id),
        TaskDetailScreen(taskId: repo.tasks.first.id),
        DispatchSuccessScreen(dispatchId: repo.dispatches.first.id),
      ];
      for (final screen in screens) {
        await tester.pumpWidget(_wrap(screen, repo));
        await tester.pumpAndSettle();
        expect(
          tester.takeException(),
          isNull,
          reason: 'layout error on $screen',
        );
      }
    });

    testWidgets('task dashboard renders employee buckets and test alarm dialog', (tester) async {
      _usePhoneScreen(tester);
      final repo = MockRepository()
        ..authenticate('ajay.ji@durasmart.com', MockRepository.employeePasscode);
      
      await tester.pumpWidget(_wrap(const TaskDashboardScreen(), repo));
      await tester.pumpAndSettle();

      // Check the 4 buckets requested by the user: Today, Pending, Overdue, Completed
      expect(find.textContaining('Today'), findsWidgets);
      expect(find.textContaining('Pending'), findsWidgets);
      expect(find.textContaining('Overdue'), findsWidgets);
      expect(find.textContaining('Completed'), findsWidgets);

      // Verify Test Alarm action button is present in app bar
      final testAlarmBtn = find.byTooltip('Test Alarm (Chime & Vibrate)');
      expect(testAlarmBtn, findsOneWidget);

      // Tap test alarm button
      await tester.tap(testAlarmBtn);
      // Advance clock past the 3x350ms vibration & alert sound pulses
      await tester.pump(const Duration(milliseconds: 1200));
      await tester.pumpAndSettle();

      // Verify alarm popup dialog appears
      expect(find.textContaining('Test Alarm Triggered'), findsOneWidget);
      expect(find.text('Acknowledge'), findsOneWidget);
      expect(find.text('Mark Complete'), findsOneWidget);
      expect(find.text('Dismiss'), findsOneWidget);

      // Dismiss dialog
      await tester.tap(find.text('Dismiss'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Test Alarm Triggered'), findsNothing);
    });
  });
}
