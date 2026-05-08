// Import nodemailer for sending emails
import nodemailer from "nodemailer";

// Import Twilio for sending SMS
import twilio from "twilio";

// Load environment variables for notification services
const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "587");
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;

// Create nodemailer transporter for email sending
const emailTransporter = nodemailer.createTransporter({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: EMAIL_PORT === 465, // true for 465, false for other ports
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// Create Twilio client for SMS sending
const smsClient = twilio(TWILIO_SID, TWILIO_TOKEN);

// Mock agency contacts — in production, this would come from a database
const AGENCY_CONTACTS: Record<string, { email: string; phone: string }> = {
  "Ghana Fire Service": { email: "fire@kasoa.gov.gh", phone: "+233501234567" },
  "NADMO": { email: "nadmo@kasoa.gov.gh", phone: "+233501234568" },
  "Road Safety Authority": { email: "roadsafety@kasoa.gov.gh", phone: "+233501234569" },
  "National Ambulance Service": { email: "ambulance@kasoa.gov.gh", phone: "+233501234570" },
};

// Admin contact — in production, this would come from user profile or config
const ADMIN_CONTACT = { email: "admin@kasoa.gov.gh", phone: "+233501234571" };

// Send an email notification
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn("Email credentials not configured, skipping email notification");
    return;
  }

  try {
    await emailTransporter.sendMail({
      from: EMAIL_USER,
      to,
      subject,
      text,
    });
    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

// Send an SMS notification
export async function sendSMS(to: string, message: string): Promise<void> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.warn("Twilio credentials not configured, skipping SMS notification");
    return;
  }

  try {
    await smsClient.messages.create({
      body: message,
      from: TWILIO_FROM,
      to,
    });
    console.log(`SMS sent to ${to}`);
  } catch (error) {
    console.error("Failed to send SMS:", error);
  }
}

// Notify admin about a new incident report
export async function notifyAdminOfNewIncident(incident: any): Promise<void> {
  const subject = `New Incident Report: ${incident.type.toUpperCase()} in ${incident.region}`;
  const text = `
New incident reported:

Type: ${incident.type}
Location: ${incident.location_text}
Region: ${incident.region}
Severity: ${incident.severity}
Description: ${incident.description}
Reported by: ${incident.reporter_name || "Anonymous"}
Time: ${new Date(incident.created_at).toLocaleString()}

Please review and dispatch as needed.
  `.trim();

  await Promise.all([
    sendEmail(ADMIN_CONTACT.email, subject, text),
    sendSMS(ADMIN_CONTACT.phone, `New ${incident.type} incident in ${incident.region}. Check dashboard.`),
  ]);
}

// Notify agency about dispatch
export async function notifyAgencyOfDispatch(incident: any, agencyName: string): Promise<void> {
  const contact = AGENCY_CONTACTS[agencyName];
  if (!contact) {
    console.warn(`No contact info for agency: ${agencyName}`);
    return;
  }

  const subject = `Incident Dispatch: ${incident.type.toUpperCase()} in ${incident.region}`;
  const text = `
You have been dispatched to handle an incident:

Type: ${incident.type}
Location: ${incident.location_text}
Region: ${incident.region}
Severity: ${incident.severity}
Description: ${incident.description}
Reported by: ${incident.reporter_name || "Anonymous"}
Time: ${new Date(incident.created_at).toLocaleString()}

Please respond immediately.
  `.trim();

  await Promise.all([
    sendEmail(contact.email, subject, text),
    sendSMS(contact.phone, `Dispatch: ${incident.type} incident in ${incident.region}. Respond now.`),
  ]);
}