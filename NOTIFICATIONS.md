# Notification Setup Guide

This guide explains how to configure email and SMS notifications for the CERP backend.

## Features Added

- **Admin Notifications**: When a new incident is reported, the admin receives both email and SMS notifications.
- **Agency Notifications**: When an incident is dispatched to an agency, that agency receives email and SMS notifications.

## Configuration

### 1. Email Setup (Gmail Example)

1. Enable 2-factor authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account settings
   - Security > 2-Step Verification > App passwords
   - Generate a password for "Mail"
3. Update `.env` file:
   ```
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   ```

### 2. SMS Setup (Twilio)

1. Sign up for a Twilio account at https://www.twilio.com
2. Get your Account SID and Auth Token from the dashboard
3. Purchase a phone number for sending SMS
4. Update `.env` file:
   ```
   TWILIO_SID=your-twilio-account-sid
   TWILIO_TOKEN=your-twilio-auth-token
   TWILIO_FROM=+1234567890  # Your Twilio phone number
   ```

### 3. Contact Information

The system uses hardcoded contact information for demo purposes:

- **Admin**: admin@kasoa.gov.gh, +233501234571
- **Agencies**: See `src/utils/notifications.ts` for the contact mapping

In production, you would store these in the database and retrieve them dynamically.

## Testing

1. Start the backend: `npm run dev`
2. Submit a report from the frontend
3. Check that admin receives notification
4. Dispatch an incident from the admin dashboard
5. Check that the agency receives notification

## Notes

- If credentials are not configured, notifications will be skipped with a console warning
- Notifications are sent asynchronously and won't block the API response
- Failed notifications are logged to the console but don't affect the main operation