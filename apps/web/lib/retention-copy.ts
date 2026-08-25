// Transcribed from docs/RETENTION.md §1 — the plain-English contract that governs the whole
// product. Kept in sync by hand (the Markdown isn't served/parsed at runtime).
export const RETENTION_SUMMARY: { question: string; answer: string }[] = [
  { question: "Where does my chat history live?", answer: "On your device(s) only. The server is not a backup." },
  {
    question: "How long does the server hold a message after I send it?",
    answer: "Until every recipient's every device has confirmed receipt — then it's deleted immediately.",
  },
  {
    question: "What if a recipient never comes online?",
    answer: "The server holds it for up to 30 days, then deletes it — permanently, whether or not it was ever delivered.",
  },
  {
    question: "What if I lose my phone?",
    answer: "You lose your history too, unless you exported an encrypted backup or linked a new device to an old one while it was still around.",
  },
  {
    question: "What does the server keep forever?",
    answer: "Your account, your devices, who's in which conversation, and how many messages are queued for you — never the message text itself.",
  },
  {
    question: "Can Driftline read my messages?",
    answer: "No code path exists that parses a message body server-side. It is opaque bytes from the moment it arrives to the moment it's deleted.",
  },
];
