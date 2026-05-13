// Import nodemailer for sending emails
import * as nodemailer from "nodemailer";

// Import Twilio for sending SMS
import twilio from "twilio";

// Load environment variables for notification services
const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
// Parse the email port as an integer, defaulting to 587
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "587");
// Email username from environment config
const EMAIL_USER = process.env.EMAIL_USER;
// Email password (app password) from environment config
const EMAIL_PASS = process.env.EMAIL_PASS;
// Twilio account SID for SMS
const TWILIO_SID = process.env.TWILIO_SID;
// Twilio auth token for SMS
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
// Twilio sender phone number
const TWILIO_FROM = process.env.TWILIO_FROM;

// Create nodemailer transporter for email sending
const emailTransporter = nodemailer.createTransport({
  // SMTP server hostname
  host: EMAIL_HOST,
  // SMTP server port number
  port: EMAIL_PORT,
  // Use TLS for port 465, STARTTLS for others
  secure: EMAIL_PORT === 465,
  // Authentication credentials
  auth: {
    // Email account username
    user: EMAIL_USER,
    // Email account password or app password
    pass: EMAIL_PASS,
  },
});

// Create Twilio client for SMS sending (only if valid credentials are provided)
let smsClient: any = null;
// Only initialise Twilio if the SID starts with "AC" (valid Twilio SID format)
if (TWILIO_SID && TWILIO_TOKEN && TWILIO_SID.startsWith("AC")) {
  try {
    // Create the Twilio client instance
    smsClient = twilio(TWILIO_SID, TWILIO_TOKEN);
  } catch (error) {
    // Log warning if Twilio fails to initialise but continue running
    console.warn("Failed to initialize Twilio client:", error);
  }
}

// Agency contacts for the Kasoa community — maps agency names to their contact info
// In production, this would come from a database table
const AGENCY_CONTACTS: Record<string, { email: string; phone: string }> = {
  // Ghana Police Service handles traffic congestion and noise complaints
  "Ghana Police Service": { email: "police@kasoa.gov.gh", phone: "+233501234567" },
  // Ghana Water Company Ltd handles burst water pipes and water supply issues
  "Ghana Water Company Ltd (GWCL)": { email: "gwcl@kasoa.gov.gh", phone: "+233501234568" },
  // Electricity Company of Ghana handles electrical faults and streetlight outages
  "Electricity Company of Ghana (ECG)": { email: "ecg@kasoa.gov.gh", phone: "+233501234569" },
  // Ghana Highway Authority handles weak bridges, potholes, and bad roads
  "Ghana Highway Authority (GHA)": { email: "gha@kasoa.gov.gh", phone: "+233501234570" },
  // Zoomlion Ghana Ltd handles illegal dumping and sanitation issues
  "Zoomlion Ghana Ltd": { email: "zoomlion@kasoa.gov.gh", phone: "+233501234571" },
  // Hydrological Services Department handles open manholes and blocked drains
  "Hydrological Services Department": { email: "hsd@kasoa.gov.gh", phone: "+233501234572" },
  // Municipal Assembly handles general community issues
  "Municipal Assembly": { email: "assembly@kasoa.gov.gh", phone: "+233501234573" },
};

// Admin contact — in production, this would come from user profile or config
const ADMIN_CONTACT = { email: "admin@kasoa.gov.gh", phone: "+233501234574" };

// Send an email notification to a specified recipient
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  // Skip if email credentials are not configured
  if (!EMAIL_USER || !EMAIL_PASS) {
    // Log a warning so developers know notifications are being skipped
    console.warn("Email credentials not configured, skipping email notification");
    // Exit without sending
    return;
  }

  try {
    // Send the email using the configured transporter
    await emailTransporter.sendMail({
      // From address matches the configured email account
      from: EMAIL_USER,
      // Recipient address
      to,
      // Email subject line
      subject,
      // Plain text body
      text,
    });
    // Log successful delivery
    console.log(`Email sent to ${to}`);
  } catch (error) {
    // Log the error but don't throw — notifications are best-effort
    console.error("Failed to send email:", error);
  }
}

// Send an SMS notification via Twilio
export async function sendSMS(to: string, message: string): Promise<void> {
  // Skip if Twilio credentials are not configured
  if (!smsClient || !TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    // Log a warning so developers know SMS is being skipped
    console.warn("Twilio credentials not configured, skipping SMS notification");
    // Exit without sending
    return;
  }

  try {
    // Create and send the SMS message
    await smsClient.messages.create({
      // The SMS text content
      body: message,
      // The Twilio sender phone number
      from: TWILIO_FROM,
      // The recipient phone number
      to,
    });
    // Log successful delivery
    console.log(`SMS sent to ${to}`);
  } catch (error) {
    // Log the error but don't throw
    console.error("Failed to send SMS:", error);
  }
}

// Notify the admin about a new community issue report
export async function notifyAdminOfNewIssue(issue: any): Promise<void> {
  // Build a descriptive email subject line with the issue type and location
  const subject = `New Community Issue: ${issue.type.replace(/_/g, " ").toUpperCase()} in ${issue.region}`;
  // Build the full email body with all relevant issue details
  const text = `
New community issue reported:

Type: ${issue.type.replace(/_/g, " ")}
Location: ${issue.location_text}
Region: ${issue.region}
Severity: ${issue.severity}
Description: ${issue.description}
Reported by: ${issue.reporter_name || "Anonymous"}
Time: ${new Date(issue.created_at).toLocaleString()}

Please review and assign to the appropriate agency.
  `.trim();

  // Send both email and SMS notifications in parallel
  await Promise.all([
    // Send email to the admin
    sendEmail(ADMIN_CONTACT.email, subject, text),
    // Send a short SMS summary to the admin
    sendSMS(ADMIN_CONTACT.phone, `New ${issue.type.replace(/_/g, " ")} issue in ${issue.region}. Check dashboard.`),
  ]);
}

// Notify an agency that they have been assigned a community issue
export async function notifyAgencyOfAssignment(issue: any, agencyName: string): Promise<void> {
  // Look up the agency's contact information from the contacts map
  const contact = AGENCY_CONTACTS[agencyName];
  // If no contact info exists for this agency, log a warning and skip
  if (!contact) {
    // Log that notification was skipped due to missing contact info
    console.warn(`No contact info for agency: ${agencyName}`);
    // Exit without sending
    return;
  }

  // Build a descriptive email subject line
  const subject = `Issue Assignment: ${issue.type.replace(/_/g, " ").toUpperCase()} in ${issue.region}`;
  // Build the full email body with issue details for the agency
  const text = `
You have been assigned a community issue to handle:

Type: ${issue.type.replace(/_/g, " ")}
Location: ${issue.location_text}
Region: ${issue.region}
Severity: ${issue.severity}
Description: ${issue.description}
Reported by: ${issue.reporter_name || "Anonymous"}
Time: ${new Date(issue.created_at).toLocaleString()}

Please respond and address this issue as soon as possible.
  `.trim();

  // Send both email and SMS notifications in parallel
  await Promise.all([
    // Send detailed email to the agency
    sendEmail(contact.email, subject, text),
    // Send a short SMS to the agency
    sendSMS(contact.phone, `Assigned: ${issue.type.replace(/_/g, " ")} issue in ${issue.region}. Respond now.`),
  ]);
}