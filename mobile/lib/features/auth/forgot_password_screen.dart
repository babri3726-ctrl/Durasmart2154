import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_sync_service.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import '../../data/mock_repository.dart';

/// Password recovery screen for Owner Ishu Jindal and HR-PB Sales Officers.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _step1FormKey = GlobalKey<FormState>();
  final _step2FormKey = GlobalKey<FormState>();

  final _idController = TextEditingController();
  final _otpController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  int _step = 1;
  bool _loading = false;
  bool _obscure = true;
  String? _errorMessage;

  String? _userName;
  String? _userRole;
  String? _maskedContact;
  String? _devOtp;

  @override
  void dispose() {
    _idController.dispose();
    _otpController.dispose();
    _newPasswordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  String? _validateIdentifier(String? v) {
    final empty = Validation.required(v, field: 'Email or employee ID');
    if (empty != null) return empty;
    if (v!.trim().length < 3) return 'Enter a valid identifier';
    return null;
  }

  String? _validateOtp(String? v) {
    if (v == null || v.trim().isEmpty) return 'Enter the 6-digit code';
    if (v.trim().length != 6) return 'Code must be 6 digits';
    return null;
  }

  String? _validatePassword(String? v) {
    if (v == null || v.isEmpty) return 'New password is required';
    if (v.length < 6) return 'Password must be at least 6 characters';
    return null;
  }

  String? _validateConfirmPassword(String? v) {
    if (v == null || v.isEmpty) return 'Please confirm your new password';
    if (v != _newPasswordController.text) return 'Passwords do not match';
    return null;
  }

  Future<void> _requestOtp() async {
    FocusScope.of(context).unfocus();
    if (!_step1FormKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    final identifier = _idController.text.trim();
    final res = await ApiSyncService.requestPasswordReset(identifier);

    if (!mounted) return;

    if (res != null && res['status'] == 'ok') {
      final user = res['user'] as Map<String, dynamic>?;
      setState(() {
        _loading = false;
        _userName = user?['name'] as String? ?? 'Authorized Staff';
        _userRole = user?['role'] as String? ?? 'employee';
        _maskedContact = user?['maskedContact'] as String? ?? identifier;
        _devOtp = res['devOtp'] as String?;
        if (_devOtp != null) {
          _otpController.text = _devOtp!;
        }
        _step = 2;
      });
      return;
    }

    // Offline / Mock fallback check
    final repo = context.read<MockRepository>();
    final key = identifier.toLowerCase();
    final match = repo.demoAccounts.where((a) =>
        a.email.toLowerCase() == key ||
        a.id.toLowerCase() == key ||
        a.employeeId?.toLowerCase() == key ||
        a.name.toLowerCase() == key ||
        (key == 'owner' && a.isOwner) ||
        (key == 'ishujindal' && a.isOwner)).firstOrNull;

    setState(() => _loading = false);

    if (match != null) {
      setState(() {
        _userName = match.name;
        _userRole = match.isOwner ? 'owner' : 'employee';
        _maskedContact = match.email;
        _devOtp = '123456';
        _otpController.text = '123456';
        _step = 2;
      });
      return;
    }

    setState(() {
      _errorMessage = res?['error'] as String? ??
          'No account found matching "$identifier". Please check your registered email or employee ID.';
    });
  }

  Future<void> _submitReset() async {
    FocusScope.of(context).unfocus();
    if (!_step2FormKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    final identifier = _idController.text.trim();
    final otp = _otpController.text.trim();
    final newPassword = _newPasswordController.text;

    final res = await ApiSyncService.resetPassword(
      identifier: identifier,
      otp: otp,
      newPassword: newPassword,
      confirmPassword: _confirmPasswordController.text,
    );

    if (!mounted) return;

    if (res != null && res['status'] == 'ok') {
      final repo = context.read<MockRepository>();
      repo.resetUserPassword(identifier, newPassword);
      setState(() {
        _loading = false;
        _step = 3;
      });
      return;
    }

    // Offline verification
    if (otp == _devOtp || otp == '123456') {
      final repo = context.read<MockRepository>();
      final ok = repo.resetUserPassword(identifier, newPassword);
      if (ok) {
        setState(() {
          _loading = false;
          _step = 3;
        });
        return;
      }
    }

    setState(() {
      _loading = false;
      _errorMessage = res?['error'] as String? ?? 'Verification failed. Please check the 6-digit code.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reset Passcode'),
        leading: const BackButton(),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _hero(),
              const SizedBox(height: 20),
              if (_step == 1) _step1Card(),
              if (_step == 2) _step2Card(),
              if (_step == 3) _successCard(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _hero() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
    decoration: BoxDecoration(
      gradient: AppGradients.brand,
      borderRadius: BorderRadius.circular(24),
      boxShadow: const [
        BoxShadow(
          color: Color(0x225034A0),
          blurRadius: 22,
          offset: Offset(0, 11),
        ),
      ],
    ),
    child: Row(
      children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Icon(
            Icons.lock_reset_rounded,
            color: AppColors.purple,
            size: 28,
          ),
        ),
        const SizedBox(width: 14),
        const Expanded(
          child: Text(
            'Forgot your passcode?\nReset with instant OTP.',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.w900,
              height: 1.3,
            ),
          ),
        ),
      ],
    ),
  );

  Widget _step1Card() => WhitePanel(
    padding: const EdgeInsets.all(18),
    child: Form(
      key: _step1FormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Account Recovery', style: AppText.title),
          AppSpacing.gapXs,
          const Text(
            'Enter your registered email, Employee ID (e.g. EMP-SP-01), or username.',
            style: AppText.caption,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _idController,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _loading ? null : _requestOtp(),
            validator: _validateIdentifier,
            decoration: const InputDecoration(
              labelText: 'Email / Employee ID / Username',
              hintText: 'ishu.jindal@durasmart.com or EMP-SP-01',
              prefixIcon: Icon(
                Icons.badge_rounded,
                color: AppColors.blue,
              ),
            ),
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            _errorWidget(_errorMessage!),
          ],
          const SizedBox(height: 18),
          GradientButton(
            label: _loading ? 'Sending…' : 'Send OTP Code',
            icon: Icons.send_rounded,
            loading: _loading,
            onPressed: _loading ? null : _requestOtp,
          ),
          const SizedBox(height: 6),
          Center(
            child: TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Back to sign in'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _step2Card() => WhitePanel(
    padding: const EdgeInsets.all(18),
    child: Form(
      key: _step2FormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              AvatarCircle(name: _userName ?? 'User', size: 36),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _userName ?? 'Staff Member',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                    ),
                    Text(
                      _maskedContact ?? '',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              StatusChip(
                label: _userRole == 'owner' ? 'Owner' : 'Sales Officer',
                color: _userRole == 'owner' ? AppColors.purple : AppColors.blue,
              ),
            ],
          ),
          if (_devOtp != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.teal.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.teal.withValues(alpha: .3)),
              ),
              child: Text(
                'Demo / Verification Code: $_devOtp',
                style: const TextStyle(
                  color: AppColors.teal,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ),
          ],
          const SizedBox(height: 16),
          TextFormField(
            controller: _otpController,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            textInputAction: TextInputAction.next,
            validator: _validateOtp,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              letterSpacing: 6,
            ),
            decoration: const InputDecoration(
              labelText: '6-Digit Verification Code',
              hintText: '••••••',
              counterText: '',
              prefixIcon: Icon(Icons.pin_rounded, color: AppColors.purple),
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _newPasswordController,
            obscureText: _obscure,
            textInputAction: TextInputAction.next,
            validator: _validatePassword,
            decoration: InputDecoration(
              labelText: 'New Passcode',
              hintText: 'At least 6 characters',
              prefixIcon: const Icon(Icons.lock_outline_rounded, color: AppColors.blue),
              suffixIcon: IconButton(
                onPressed: () => setState(() => _obscure = !_obscure),
                icon: Icon(
                  _obscure ? Icons.visibility_off_rounded : Icons.visibility_rounded,
                  color: AppColors.muted,
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _confirmPasswordController,
            obscureText: _obscure,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _loading ? null : _submitReset(),
            validator: _validateConfirmPassword,
            decoration: const InputDecoration(
              labelText: 'Confirm New Passcode',
              hintText: 'Re-enter new passcode',
              prefixIcon: Icon(Icons.check_circle_outline_rounded, color: AppColors.teal),
            ),
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            _errorWidget(_errorMessage!),
          ],
          const SizedBox(height: 18),
          GradientButton(
            label: _loading ? 'Updating Passcode…' : 'Update Passcode',
            icon: Icons.check_rounded,
            loading: _loading,
            onPressed: _loading ? null : _submitReset,
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton(
                onPressed: () => setState(() => _step = 1),
                child: const Text('Change account'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel'),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _successCard() => WhitePanel(
    padding: const EdgeInsets.all(24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              gradient: AppGradients.success,
              shape: BoxShape.circle,
              boxShadow: const [
                BoxShadow(
                  color: Color(0x221DA96B),
                  blurRadius: 20,
                  offset: Offset(0, 8),
                ),
              ],
            ),
            child: const Icon(
              Icons.check_rounded,
              color: Colors.white,
              size: 38,
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Passcode Updated!',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.ink,
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Your new passcode is active. You can now sign in with your updated credentials.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.muted,
            fontSize: 13,
            height: 1.45,
          ),
        ),
        const SizedBox(height: 22),
        GradientButton(
          label: 'Proceed to Sign in',
          icon: Icons.login_rounded,
          onPressed: () => Navigator.pushReplacementNamed(context, '/login'),
        ),
      ],
    ),
  );

  Widget _errorWidget(String msg) => Container(
    padding: const EdgeInsets.all(11),
    decoration: BoxDecoration(
      color: AppColors.red.withValues(alpha: .10),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.red.withValues(alpha: .35)),
    ),
    child: Row(
      children: [
        const Icon(Icons.error_outline_rounded, color: AppColors.red, size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            msg,
            style: const TextStyle(
              color: AppColors.red,
              fontSize: 12,
              height: 1.35,
            ),
          ),
        ),
      ],
    ),
  );
}
