import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

/// Firebase Email Link / Password Reset screen for DuraSmart Workspace.
/// Powered directly by Google Firebase Auth service.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();

  bool _loading = false;
  bool _isSent = false;
  String? _submittedEmail;
  String? _errorMessage;
  int _cooldown = 0;
  Timer? _timer;

  @override
  void dispose() {
    _emailController.dispose();
    _timer?.cancel();
    super.dispose();
  }

  void _startCooldown() {
    _timer?.cancel();
    setState(() => _cooldown = 60);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_cooldown <= 1) {
        timer.cancel();
        setState(() => _cooldown = 0);
      } else {
        setState(() => _cooldown--);
      }
    });
  }

  String? _validateEmail(String? v) {
    final empty = Validation.required(v, field: 'Email address');
    if (empty != null) return empty;
    final clean = v!.trim();
    if (!clean.contains('@') || !clean.contains('.')) {
      return 'Enter a valid email address';
    }
    return null;
  }

  Future<void> _sendResetLink() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;

    final email = _emailController.text.trim().toLowerCase();

    setState(() {
      _loading = true;
      _errorMessage = null;
    });

    try {
      // 1. Send official Google Firebase Password Reset Email
      await FirebaseAuth.instance.sendPasswordResetEmail(email: email);
      if (!mounted) return;
      setState(() {
        _loading = false;
        _isSent = true;
        _submittedEmail = email;
      });
      _startCooldown();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Password reset link sent! Please check your Gmail.'),
          backgroundColor: AppColors.teal,
          duration: Duration(seconds: 3),
        ),
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      String err;
      if (e.code == 'user-not-found') {
        err = 'No registered account found with this email. Please check your spelling or contact the administrator.';
      } else if (e.code == 'invalid-email') {
        err = 'The email address is improperly formatted.';
      } else if (e.code == 'too-many-requests') {
        err = 'Too many attempts. Google Firebase has temporarily throttled requests. Please wait a few moments.';
      } else {
        // Fallback to backend REST endpoint in case of network constraint
        final backupOk = await _callBackendFirebaseReset(email);
        if (backupOk) {
          if (!mounted) return;
          setState(() {
            _loading = false;
            _isSent = true;
            _submittedEmail = email;
          });
          _startCooldown();
          return;
        }
        err = e.message ?? 'Could not send reset email. Please try again.';
      }

      setState(() {
        _loading = false;
        _errorMessage = err;
      });
    } catch (e) {
      if (!mounted) return;
      final backupOk = await _callBackendFirebaseReset(email);
      if (backupOk) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _isSent = true;
          _submittedEmail = email;
        });
        _startCooldown();
        return;
      }
      setState(() {
        _loading = false;
        _errorMessage = 'Connection error: ${e.toString()}';
      });
    }
  }

  Future<bool> _callBackendFirebaseReset(String email) async {
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
      final req = await client.postUrl(
        Uri.parse('https://durasmart2154.onrender.com/api/v1/auth/firebase-password-reset'),
      );
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'email': email}));
      final resp = await req.close();
      return resp.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reset Password'),
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
              if (!_isSent) _requestCard() else _successCard(),
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
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _isSent ? 'Check Your Gmail' : 'Reset with Firebase',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _isSent
                  ? 'Official Google reset link dispatched'
                  : 'Receive Google\'s official password reset link',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _requestCard() => WhitePanel(
    padding: const EdgeInsets.all(20),
    child: Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Google Firebase Reset', style: AppText.title),
          AppSpacing.gapXs,
          const Text(
            'Enter your registered email address. Firebase will send an official Google password reset link directly to your inbox.',
            style: AppText.caption,
          ),
          const SizedBox(height: 18),
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            onFieldSubmitted: (_) => _loading ? null : _sendResetLink(),
            validator: _validateEmail,
            decoration: const InputDecoration(
              labelText: 'Registered Gmail / Email',
              hintText: 'e.g. mohairsin@gmail.com',
              prefixIcon: Icon(
                Icons.mail_outline_rounded,
                color: AppColors.blue,
              ),
            ),
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: 12),
            _errorWidget(_errorMessage!),
          ],
          const SizedBox(height: 20),
          GradientButton(
            label: _loading ? 'Sending link…' : 'Send Reset Link',
            icon: Icons.send_rounded,
            loading: _loading,
            onPressed: _loading ? null : _sendResetLink,
          ),
          const SizedBox(height: 10),
          Center(
            child: TextButton.icon(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.arrow_back_rounded, size: 16),
              label: const Text('Back to sign in'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _successCard() => WhitePanel(
    padding: const EdgeInsets.all(22),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            width: 70,
            height: 70,
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
              Icons.mark_email_read_rounded,
              color: Colors.white,
              size: 36,
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Reset Link Dispatched!',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.ink,
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Google Firebase sent an official password reset link to:',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: AppColors.muted,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.blue.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.blue.withValues(alpha: .30)),
          ),
          child: Text(
            _submittedEmail ?? '',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.blue,
              fontWeight: FontWeight.w800,
              fontSize: 14,
            ),
          ),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _instructionStep('1', 'Open your Gmail app or mail inbox.'),
              const SizedBox(height: 8),
              _instructionStep('2', 'Click the secure link from Google Firebase.'),
              const SizedBox(height: 8),
              _instructionStep('3', 'Set your new password and return here to sign in.'),
            ],
          ),
        ),
        const SizedBox(height: 20),
        GradientButton(
          label: 'Return to Sign In',
          icon: Icons.login_rounded,
          onPressed: () => Navigator.pop(context),
        ),
        const SizedBox(height: 10),
        Center(
          child: TextButton.icon(
            onPressed: (_loading || _cooldown > 0) ? null : _sendResetLink,
            icon: Icon(
              Icons.replay_rounded,
              size: 16,
              color: _cooldown > 0 ? AppColors.muted : AppColors.purple,
            ),
            label: Text(
              _cooldown > 0 ? 'Resend link in ${_cooldown}s' : 'Resend reset link',
              style: TextStyle(
                color: _cooldown > 0 ? AppColors.muted : AppColors.purple,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        Center(
          child: TextButton(
            onPressed: () {
              setState(() {
                _isSent = false;
                _errorMessage = null;
              });
            },
            child: const Text(
              'Entered wrong email? Change email',
              style: TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _instructionStep(String stepNumber, String text) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 22,
        height: 22,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.purple.withValues(alpha: .15),
          shape: BoxShape.circle,
        ),
        child: Text(
          stepNumber,
          style: const TextStyle(
            color: AppColors.purple,
            fontWeight: FontWeight.w800,
            fontSize: 11,
          ),
        ),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: Text(
          text,
          style: const TextStyle(
            color: AppColors.ink,
            fontSize: 13,
            height: 1.35,
          ),
        ),
      ),
    ],
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
