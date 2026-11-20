"""
Production Email Delivery Service for DuraSmart Operations Suite.
Supports TLS/SSL SMTP with beautiful responsive HTML templates.
"""
import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger("durasmart.mailer")

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "noreply@durasmart.com")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes")

def is_smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

def send_password_reset_email(to_email: str, otp_code: str, user_name: str = "Team Member") -> dict:
    """
    Delivers a real one-time password (OTP) email for password recovery.
    """
    clean_to = to_email.strip().lower()
    subject = f"DuraSmart Verification Code: {otp_code}"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Code</title>
      <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B; }}
        .card {{ max-width: 500px; margin: 0 auto; background: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #E2E8F0; }}
        .header {{ background: linear-gradient(135deg, #4338CA 0%, #6366F1 50%, #8B5CF6 100%); padding: 32px 24px; text-align: center; color: #FFFFFF; }}
        .header h1 {{ margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }}
        .header p {{ margin: 6px 0 0; font-size: 14px; opacity: 0.9; }}
        .content {{ padding: 32px 28px; }}
        .greeting {{ font-size: 16px; font-weight: 600; margin-bottom: 12px; }}
        .instruction {{ font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }}
        .otp-box {{ background: #EEF2FF; border: 2px dashed #6366F1; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px; }}
        .otp-code {{ font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4338CA; font-family: monospace; }}
        .timer {{ font-size: 12px; color: #64748B; margin-top: 6px; font-weight: 500; }}
        .security-note {{ font-size: 12px; color: #94A3B8; line-height: 1.5; border-top: 1px solid #F1F5F9; padding-top: 20px; }}
        .footer {{ background: #F8FAFC; padding: 18px; text-align: center; font-size: 12px; color: #94A3B8; border-top: 1px solid #E2E8F0; }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>DuraSmart Operations</h1>
          <p>Enterprise Workspace Security</p>
        </div>
        <div class="content">
          <div class="greeting">Hello {user_name},</div>
          <div class="instruction">
            We received a request to reset your password for your DuraSmart workspace account. Use the 6-digit verification code below to complete your password reset:
          </div>
          <div class="otp-box">
            <div class="otp-code">{otp_code}</div>
            <div class="timer">⏱ Valid for 10 minutes only</div>
          </div>
          <div class="security-note">
            <strong>Security Warning:</strong> If you did not request this password reset, please ignore this email or notify your system administrator immediately. Never share this code with anyone.
          </div>
        </div>
        <div class="footer">
          &copy; DuraSmart Operations Suite &bull; Punjab &amp; Haryana Regional Office
        </div>
      </div>
    </body>
    </html>
    """

    plain_content = f"""
DuraSmart Operations Suite - Password Reset

Hello {user_name},

Your verification code to reset your password is: {otp_code}

This code is valid for 10 minutes.
If you did not request this code, please ignore this message.
"""

    if is_smtp_configured():
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"DuraSmart Operations <{SMTP_FROM}>"
            msg["To"] = clean_to

            msg.attach(MIMEText(plain_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, [clean_to], msg.as_string())
            server.quit()
            logger.info("Successfully delivered OTP email to %s via %s", clean_to, SMTP_HOST)
            return {"sent": True, "error": None}
        except Exception as e:
            logger.error("Failed to deliver OTP email to %s: %s", clean_to, e)
            return {"sent": False, "error": str(e)}
    else:
        logger.warning(
            "SMTP is not configured in environment (SMTP_HOST=%s, SMTP_USER=%s). "
            "[SIMULATION] OTP code for %s is %s",
            SMTP_HOST, SMTP_USER, clean_to, otp_code
        )
        return {"sent": False, "error": "SMTP credentials not configured on server (simulation mode)"}
