import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Invitation-based mock registration. Submissions are not persisted — in a
/// production build the owner must approve before an account is created.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const _departments = <String>[
    'Sales',
    'Dispatch',
    'Accounts',
    'Stores',
    'Marketing',
  ];
  static const _demoInviteCode = 'DURA-2026';

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _contactController = TextEditingController();
  final _employeeIdController = TextEditingController();
  final _inviteController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  String _department = 'Sales';
  bool _obscure = true;
  bool _loading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _contactController.dispose();
    _employeeIdController.dispose();
    _inviteController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  String? _validateName(String? v) =>
      Validation.required(v, field: 'Full name');

  String? _validateContact(String? v) {
    final empty = Validation.required(v, field: 'Email or mobile');
    if (empty != null) return empty;
    final value = v!.trim();
    if (value.contains('@')) {
      final valid = RegExp(r'^[\w.\-+]+@[\w\-]+\.[\w.\-]+$').hasMatch(value);
      return valid ? null : 'Enter a valid email address';
    }
    return Validation.mobile(value);
  }

  String? _validateInvite(String? v) {
    final empty = Validation.required(v, field: 'Invite code');
    if (empty != null) return empty;
    final matches = v!.trim().toUpperCase() == _demoInviteCode;
    return matches
        ? null
        : 'Invite code not recognised (demo: $_demoInviteCode)';
  }

  String? _validatePassword(String? v) {
    if (v == null || v.isEmpty) return 'Password is required';
    if (v.length < 6) return 'Use at least 6 characters';
    return null;
  }

  String? _validateConfirm(String? v) {
    if (v != _passwordController.text) return 'Passwords do not match';
    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    final ok = await ConfirmDialog.show(
      context,
      title: 'Submit registration?',
      message:
          'A request will be sent to the owner for approval. This is a demo flow — '
          'nothing is stored on a server.',
      confirmLabel: 'Submit',
    );
    if (!ok || !mounted) return;
    setState(() => _loading = true);
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;
    setState(() => _loading = false);
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        icon: const Icon(Icons.hourglass_top_rounded, color: AppColors.purple),
        title: const Text('Registration submitted', style: AppText.title),
        content: const Text(
          'Registration submitted — demo: owner approval required.\n\n'
          'Once approved, you can sign in with your email or employee ID.',
          style: TextStyle(fontSize: 13, height: 1.45),
        ),
        actions: [
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.purple),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('OK'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    Navigator.pushReplacementNamed(context, '/login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Create account'),
        leading: const BackButton(),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 30),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              WhitePanel(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('Join your team', style: AppText.title),
                    AppSpacing.gapXs,
                    const Text(
                      'Registration is by invitation and needs owner approval.',
                      style: AppText.caption,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _nameController,
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.words,
                      validator: _validateName,
                      decoration: const InputDecoration(
                        labelText: 'Full name',
                        prefixIcon: Icon(
                          Icons.person_outline_rounded,
                          color: AppColors.teal,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _contactController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      validator: _validateContact,
                      decoration: const InputDecoration(
                        labelText: 'Email or mobile',
                        hintText: 'name@durasmart.in or 10-digit mobile',
                        prefixIcon: Icon(
                          Icons.contact_page_rounded,
                          color: AppColors.blue,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _employeeIdController,
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.characters,
                      validator: (v) =>
                          Validation.required(v, field: 'Employee ID'),
                      decoration: const InputDecoration(
                        labelText: 'Employee ID',
                        hintText: 'EMP-104',
                        prefixIcon: Icon(
                          Icons.badge_outlined,
                          color: AppColors.purple,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: _department,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Department',
                        prefixIcon: Icon(
                          Icons.account_tree_rounded,
                          color: AppColors.orange,
                        ),
                      ),
                      items: [
                        for (final dept in _departments)
                          DropdownMenuItem(value: dept, child: Text(dept)),
                      ],
                      onChanged: (value) =>
                          setState(() => _department = value ?? _department),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _inviteController,
                      textInputAction: TextInputAction.next,
                      textCapitalization: TextCapitalization.characters,
                      validator: _validateInvite,
                      decoration: const InputDecoration(
                        labelText: 'Invite code',
                        hintText: 'Ask your owner (demo: DURA-2026)',
                        helperText: 'Demo invite code: DURA-2026',
                        prefixIcon: Icon(
                          Icons.vpn_key_rounded,
                          color: AppColors.pink,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscure,
                      textInputAction: TextInputAction.next,
                      validator: _validatePassword,
                      decoration: InputDecoration(
                        labelText: 'Password',
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
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _confirmController,
                      obscureText: _obscure,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _loading ? null : _submit(),
                      validator: _validateConfirm,
                      decoration: const InputDecoration(
                        labelText: 'Confirm password',
                        prefixIcon: Icon(
                          Icons.lock_reset_rounded,
                          color: AppColors.teal,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    GradientButton(
                      label: _loading ? 'Submitting…' : 'Submit registration',
                      icon: Icons.how_to_reg_rounded,
                      loading: _loading,
                      onPressed: _loading ? null : _submit,
                    ),
                    const SizedBox(height: 4),
                    Center(
                      child: TextButton(
                        onPressed: () =>
                            Navigator.pushReplacementNamed(context, '/login'),
                        child: const Text('Already registered? Sign in'),
                      ),
                    ),
                  ],
                ),
              ),
              AppSpacing.gap,
              const DemoNotice(
                text:
                    'Mock invitation form only. There is no backend user store here, and '
                    'the owner-approval step is simulated for the UI demo.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
