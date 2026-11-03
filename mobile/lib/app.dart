import 'package:flutter/material.dart';

import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/forgot_password_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/home/home_shell.dart';
import 'features/sales/sales_dashboard_screen.dart';
import 'features/sales/customer_list_screen.dart';
import 'features/sales/debtor_list_screen.dart';
import 'features/sales/customer_detail_screen.dart';
import 'features/sales/performance_screen.dart';
import 'features/sales/new_customer_screen.dart';
import 'features/sales/order_form_screen.dart';
import 'features/sales/order_list_screen.dart';
import 'features/sales/order_detail_screen.dart';
import 'features/dispatch/dispatch_screen.dart';
import 'features/dispatch/dispatch_history_screen.dart';
import 'features/payments/payment_dashboard_screen.dart';
import 'features/payments/record_payment_screen.dart';
import 'features/payments/customer_ledger_screen.dart';
import 'features/payments/outstanding_screen.dart';
import 'features/areas/vaccant_area_screen.dart';
import 'features/tours/tour_plan_screen.dart';
import 'features/tasks/task_dashboard_screen.dart';
import 'features/tasks/create_task_screen.dart';
import 'features/tasks/task_detail_screen.dart';
import 'features/tasks/completion_photo_review_screen.dart';
import 'features/org/employee_list_screen.dart';
import 'features/org/profile_screen.dart';
import 'features/org/settings_screen.dart';
import 'features/stock/stock_home_screen.dart';

class OperationsApp extends StatelessWidget {
  const OperationsApp({super.key, this.initialRoute = '/login'});

  final String initialRoute;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Demo Operations',
    debugShowCheckedModeBanner: false,
    theme: AppTheme.light,
    initialRoute: initialRoute,
    routes: {
      '/login': (_) => const LoginScreen(),
      '/forgot': (_) => const ForgotPasswordScreen(),
      '/register': (_) => const RegisterScreen(),
      '/home': (_) => const HomeShell(),
      '/sales': (_) => const SalesDashboardScreen(),
      '/customers': (_) => const DebtorListScreen(),
      '/debtors': (_) => const DebtorListScreen(),
      '/new-customer': (_) => const DebtorListScreen(),
      '/performance': (_) => const PerformanceScreen(),
      '/orders': (_) => const OrderListScreen(),
      '/new-order': (_) => const OrderFormScreen(),
      '/dispatch': (_) => const DispatchScreen(),
      '/dispatch-history': (_) => const DispatchHistoryScreen(),
      '/payments': (_) => const PaymentDashboardScreen(),
      '/record-payment': (_) => const RecordPaymentScreen(),
      '/outstanding': (_) => const OutstandingScreen(),
      '/areas': (_) => const VaccantAreaScreen(),
      '/tours': (_) => const TourPlanScreen(),
      '/tasks': (_) => const TaskDashboardScreen(),
      '/create-task': (_) => const CreateTaskScreen(),
      '/task-review': (_) => const CompletionPhotoReviewScreen(),
      '/employees': (_) => const EmployeeListScreen(),
      '/profile': (_) => const ProfileScreen(),
      '/settings': (_) => const SettingsScreen(),
      '/stock': (_) => const StockHomeScreen(),
    },
    onGenerateRoute: (settings) {
      final args = settings.arguments;
      if (settings.name == '/customer' && args is Map<String, String>) {
        return MaterialPageRoute(
          builder: (_) => CustomerDetailScreen(customerId: args['customerId']!),
        );
      }
      if (settings.name == '/order' && args is Map<String, String>) {
        return MaterialPageRoute(
          builder: (_) => OrderDetailScreen(orderId: args['orderId']!),
        );
      }
      if (settings.name == '/ledger' && args is Map<String, String>) {
        return MaterialPageRoute(
          builder: (_) => CustomerLedgerScreen(customerId: args['customerId']!),
        );
      }
      if (settings.name == '/task' && args is Map<String, String>) {
        return MaterialPageRoute(
          builder: (_) => TaskDetailScreen(taskId: args['taskId']!),
        );
      }
      return null;
    },
  );
}

typedef DuraSmartApp = OperationsApp;
