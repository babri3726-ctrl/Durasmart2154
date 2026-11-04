import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_sync_service.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Mock sign-in screen. Authentication here is a UI demo only — it does NOT
/// prove identity. A real backend must verify credentials and enforce roles.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _idController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _obscure = true;
  bool _loading = false;
  bool _demoExpanded = false;
  String? _inlineError;

  @override
  void dispose() {
    _idController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  String? _validateId(String? v) {
    final empty = Validation.required(v, field: 'Email or employee ID');
    if (empty != null) return empty;
    final value = v!.trim();
    final looksLikeEmail = value.contains('@');
    final looksLikeMobile = RegExp(r'^\+?[0-9 \-]{10,14}$').hasMatch(value);
    if (!looksLikeEmail && !looksLikeMobile && value.length < 3) {
      return 'Enter your email, mobile or employee ID';
    }
    return null;
  }

  String? _validatePassword(String? v) {
    if (v == null || v.isEmpty) return 'Password is required';
    if (v.length < 6) return 'Use at least 6 characters';
    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    final repo = context.read<MockRepository>();
    setState(() {
      _loading = true;
      _inlineError = null;
    });

    final onlineRes = await ApiSyncService.loginUser(
      _idController.text.trim(),
      _passwordController.text,
    );

    if (!mounted) return;

    if (onlineRes != null && onlineRes['user'] != null) {
      final appUser = AppUser.fromJson(onlineRes['user'] as Map<String, dynamic>);
      repo.setSignedInUser(appUser);
      setState(() => _loading = false);
      Navigator.pushReplacementNamed(context, '/home');
      return;
    }

    final user = repo.authenticate(
      _idController.text,
      _passwordController.text,
    );
    if (!mounted) return;
    setState(() => _loading = false);
    if (user == null) {
      setState(
        () => _inlineError = onlineRes?['error'] as String? ??
            'Incorrect ID / email or passcode. Please verify your credentials.',
      );
      return;
    }
    Navigator.pushReplacementNamed(context, '/home');
  }

  void _useAccount(AppUser account) {
    _idController.text = account.email;
    _passwordController.text = account.isOwner
        ? MockRepository.ownerPasscode
        : MockRepository.employeePasscode;
    setState(() => _inlineError = null);
  }

  @override
  Widget build(BuildContext context) {
    final accounts = context.watch<MockRepository>().demoAccounts;

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _hero(),
              const SizedBox(height: 20),
              _formCard(),
              AppSpacing.gap,
              _demoAccounts(accounts),
              AppSpacing.gap,
              const DemoNotice(
                text:
                    'This is local mock authentication, NOT secure authorization. '
                    'A real backend must verify every login and enforce roles in '
                    'production. Here the role only filters which tiles are shown.',
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _hero() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 26),
    decoration: BoxDecoration(
      gradient: AppGradients.brand,
      borderRadius: BorderRadius.circular(26),
      boxShadow: const [
        BoxShadow(
          color: Color(0x225034A0),
          blurRadius: 24,
          offset: Offset(0, 12),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
          ),
          child: const BrandMark(),
        ),
        const SizedBox(height: 18),
        const Text(
          'Sign in to your workspace',
          style: TextStyle(
            color: Colors.white,
            fontSize: 22,
            fontWeight: FontWeight.w900,
            height: 1.15,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Sales, dispatch, payments and teams — in one colourful app.',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: Color(0xE6FFFFFF), fontSize: 13, height: 1.4),
        ),
      ],
    ),
  );

  Widget _formCard() => WhitePanel(
    padding: const EdgeInsets.all(18),
    child: Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Welcome back', style: AppText.title),
          AppSpacing.gapXs,
          const Text(
            'Enter your email or employee ID to continue.',
            style: AppText.caption,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _idController,
            textInputAction: TextInputAction.next,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            validator: _validateId,
            decoration: const InputDecoration(
              labelText: 'Email or Employee ID',
              hintText: 'ishu.jindal@durasmart.com or EMP-SP-01',
              prefixIcon: Icon(Icons.badge_rounded, color: AppColors.purple),
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _passwordController,
            obscureText: _obscure,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _loading ? null : _submit(),
            validator: _validatePassword,
            decoration: InputDecoration(
              labelText: 'Passcode',
              hintText: 'Enter your passcode',
              prefixIcon: const Icon(
                Icons.lock_outline_rounded,
                color: AppColors.blue,
              ),
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscure = !_obscure),
                icon: Icon(
                  _obscure
                      ? Icons.visibility_off_rounded
                      : Icons.visibility_rounded,
                  color: AppColors.muted,
                ),
              ),
            ),
          ),
          if (_inlineError != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: AppColors.red.withValues(alpha: .10),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.red.withValues(alpha: .35)),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.error_outline_rounded,
                    color: AppColors.red,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _inlineError!,
                      style: const TextStyle(
                        color: AppColors.red,
                        fontSize: 12,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 18),
          GradientButton(
            label: _loading ? 'Signing in…' : 'Sign in',
            icon: Icons.login_rounded,
            loading: _loading,
            onPressed: _loading ? null : _submit,
          ),
          const SizedBox(height: 6),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => Navigator.pushNamed(context, '/forgot'),
              child: const Text('Forgot passcode?'),
            ),
          ),
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              const Text('New to Dura Smart?', style: AppText.caption),
              TextButton(
                onPressed: () => Navigator.pushNamed(context, '/register'),
                child: const Text('Create an account'),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _demoAccounts(List<AppUser> accounts) => WhitePanel(
    padding: const EdgeInsets.all(6),
    child: Column(
      children: [
        ListTile(
          leading: const Icon(Icons.groups_rounded, color: AppColors.teal),
          title: const Text('Authorized Team Accounts', style: AppText.heading),
          subtitle: const Text(
            'Tap one to autofill the form',
            style: AppText.caption,
          ),
          trailing: Icon(
            _demoExpanded
                ? Icons.expand_less_rounded
                : Icons.expand_more_rounded,
            color: AppColors.muted,
          ),
          onTap: () => setState(() => _demoExpanded = !_demoExpanded),
        ),
        if (_demoExpanded)
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 0, 6, 8),
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(10, 2, 10, 10),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Owner: Ishu Jindal | Sales Team: HR-PB Verified Officers',
                      style: TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                  ),
                ),
                for (final account in accounts)
                  ListTile(
                    dense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    leading: AvatarCircle(name: account.name, size: 34),
                    title: Text(
                      account.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
                    subtitle: Text(
                      '${account.email} • ${account.department}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                    trailing: StatusChip(
                      label: account.isOwner ? 'Owner' : 'Employee',
                      color: account.isOwner
                          ? AppColors.purple
                          : AppColors.blue,
                    ),
                    onTap: () => _useAccount(account),
                  ),
              ],
            ),
          ),
      ],
    ),
  );
}
