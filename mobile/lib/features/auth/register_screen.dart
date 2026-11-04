import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_sync_service.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';
import '../../data/models.dart';

/// Invitation-based registration. Checks with the live FastAPI backend
/// to verify the owner-generated invitation code and persist user credentials.
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
  String? _verifiedDept;

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
    final clean = v!.trim().toUpperCase();
    if (clean == _demoInviteCode || clean.startsWith('DURA-')) {
      return null;
    }
    return 'Invite code must be valid (e.g. DURA-XXXX)';
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

  Future<void> _checkInviteCode() async {
    final code = _inviteController.text.trim().toUpperCase();
    if (code.isEmpty) return;
    final res = await ApiSyncService.verifyInviteCode(code);
    if (!mounted) return;
    if (res != null && res['valid'] == true) {
      final dept = res['department'] as String? ?? 'Sales';
      setState(() {
        _department = dept;
        _verifiedDept = dept;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Verified code for $dept department'),
          backgroundColor: AppColors.teal,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    setState(() => _loading = true);

    final contact = _contactController.text.trim();
    final isEmail = contact.contains('@');
    final res = await ApiSyncService.signupUser(
      name: _nameController.text.trim(),
      identifier: contact,
      password: _passwordController.text,
      phone: isEmail ? null : contact,
      inviteCode: _inviteController.text.trim().toUpperCase(),
    );

    if (!mounted) return;
    setState(() => _loading = false);

    if (res != null && res['user'] != null) {
      final appUser = AppUser.fromJson(res['user'] as Map<String, dynamic>);
      context.read<MockRepository>().setSignedInUser(appUser);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Account registered! Welcome, ${appUser.name}'),
          backgroundColor: AppColors.teal,
        ),
      );
      Navigator.pushReplacementNamed(context, '/home');
      return;
    }

    // If server returned a business error (e.g. code expired or duplicate account)
    if (res != null && res['error'] != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${res['error']}'),
          backgroundColor: AppColors.red,
        ),
      );
      return;
    }

    // Offline / fallback flow
    final ok = await ConfirmDialog.show(
      context,
      title: 'Submit registration?',
      message:
          'Backend is currently offline or unreachable. Complete offline demo registration?',
      confirmLabel: 'Register Offline',
    );
    if (!ok || !mounted) return;

    final mockUser = AppUser(
      id: 'usr-offline',
      name: _nameController.text.trim(),
      email: contact,
      role: UserRole.employee,
      department: _department,
      employeeId: _employeeIdController.text.trim(),
    );
    context.read<MockRepository>().setSignedInUser(mockUser);
    Navigator.pushReplacementNamed(context, '/home');
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
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text('Join your team', style: AppText.title),
                      AppSpacing.gapXs,
                      const Text(
                        'Registration is secured by owner invitation codes.',
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
                        decoration: const InputDecoration(
                          labelText: 'Employee ID (optional)',
                          hintText: 'e.g. EMP-SP-04',
                          prefixIcon: Icon(
                            Icons.badge_outlined,
                            color: AppColors.purple,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      DropdownButtonFormField<String>(
                        value: _department,
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
                        onEditingComplete: _checkInviteCode,
                        decoration: InputDecoration(
                          labelText: 'Invite code',
                          hintText: 'Enter code from owner (e.g. DURA-XXXX)',
                          prefixIcon: const Icon(
                            Icons.vpn_key_rounded,
                            color: AppColors.pink,
                          ),
                          suffixIcon: IconButton(
                            icon: const Icon(Icons.check_circle_outline_rounded),
                            tooltip: 'Verify code',
                            onPressed: _checkInviteCode,
                          ),
                        ),
                      ),
                      if (_verifiedDept != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          '✓ Verified for $_verifiedDept department',
                          style: const TextStyle(
                            color: AppColors.teal,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
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
                        label: _loading ? 'Creating account…' : 'Complete Registration',
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
              ),
              AppSpacing.gap,
              const DemoNotice(
                text:
                    'Connected to Dura Smart Operations API. Real invitation codes '
                    'generated by the owner are validated and persisted to SQLite.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
