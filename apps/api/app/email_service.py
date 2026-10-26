"""Send Recall study reminder emails using Resend."""

import os
import resend


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
