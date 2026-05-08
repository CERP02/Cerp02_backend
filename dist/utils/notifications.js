"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
exports.sendSMS = sendSMS;
exports.notifyAdminOfNewIncident = notifyAdminOfNewIncident;
exports.notifyAgencyOfDispatch = notifyAgencyOfDispatch;
// Import nodemailer for sending emails
const nodemailer = __importStar(require("nodemailer"));
// Import Twilio for sending SMS
const twilio_1 = __importDefault(require("twilio"));
// Load environment variables for notification services
const EMAIL_HOST = process.env.EMAIL_HOST || "smtp.gmail.com";
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || "587");
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;
// Create nodemailer transporter for email sending
const emailTransporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465, // true for 465, false for other ports
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
});
// Create Twilio client for SMS sending (only if valid credentials are provided)
let smsClient = null;
if (TWILIO_SID && TWILIO_TOKEN && TWILIO_SID.startsWith("AC")) {
    try {
        smsClient = (0, twilio_1.default)(TWILIO_SID, TWILIO_TOKEN);
    }
    catch (error) {
        console.warn("Failed to initialize Twilio client:", error);
    }
}
// Mock agency contacts — in production, this would come from a database
const AGENCY_CONTACTS = {
    "Ghana Fire Service": { email: "fire@kasoa.gov.gh", phone: "+233501234567" },
    "NADMO": { email: "nadmo@kasoa.gov.gh", phone: "+233501234568" },
    "Road Safety Authority": { email: "roadsafety@kasoa.gov.gh", phone: "+233501234569" },
    "National Ambulance Service": { email: "ambulance@kasoa.gov.gh", phone: "+233501234570" },
};
// Admin contact — in production, this would come from user profile or config
const ADMIN_CONTACT = { email: "admin@kasoa.gov.gh", phone: "+233501234571" };
// Send an email notification
async function sendEmail(to, subject, text) {
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
    }
    catch (error) {
        console.error("Failed to send email:", error);
    }
}
// Send an SMS notification
async function sendSMS(to, message) {
    if (!smsClient || !TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
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
    }
    catch (error) {
        console.error("Failed to send SMS:", error);
    }
}
// Notify admin about a new incident report
async function notifyAdminOfNewIncident(incident) {
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
async function notifyAgencyOfDispatch(incident, agencyName) {
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
