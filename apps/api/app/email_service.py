"""Send Recall study reminder emails using Resend."""

import os
import resend
from html import escape
from resend.exceptions import ResendError


def send_reminder_email(to_email: str):
    """Send a study reminder to a student's email address."""

    api_key = os.environ.get("RESEND_API_KEY")

    if not api_key:
        raise ValueError("RESEND_API_KEY is not configured.")

    resend.api_key = api_key
    sender = os.environ.get("RESEND_FROM_EMAIL", "Recall <onboarding@resend.dev>")

    return resend.Emails.send({
        "from": sender,
        "to": [to_email],
        "subject": "Recall: Time to Study!",
        "html": """
            Hey!
            <p>Just a quick reminder to review your flashcards today. Happy Studying!</p>
            - The Recall Team
         
        """,
    })


def send_password_reset_email(to_email: str, token: str):
    """Send a password reset link to a student's email address."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY is not configured.")

    resend.api_key = api_key
    sender = os.environ.get("RESEND_FROM_EMAIL", "Recall <onboarding@resend.dev>")
    web_url = os.environ.get("WEB_URL", "http://localhost:3000").rstrip("/")
    reset_url = f"{web_url}/reset-password?token={token}"
    return resend.Emails.send({
        "from": sender,
        "to": [to_email],
        "subject": "Reset your Recall password",
        "html": (
            "<p>Use the link below to reset your Recall password. "
            "The link expires in 30 minutes.</p>"
            f'<p><a href="{escape(reset_url, quote=True)}">Reset password</a></p>'
            "<p>If you did not request this, you can ignore this email.</p>"
        ),
    })
