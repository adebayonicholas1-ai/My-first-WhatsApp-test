import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -------------------------
// CHECK ENVIRONMENT VARIABLES
// -------------------------
const requiredEnv = [
  "GEMINI_API_KEY",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "META_API_VERSION"
];

for (const variable of requiredEnv) {
  if (!process.env[variable]) {
    console.error(`Missing environment variable: ${variable}`);
  }
}

// -------------------------
// GEMINI
// -------------------------
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// -------------------------
// HEALTH CHECK
// -------------------------
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "WhatsApp Gemini Bot is running"
  });
});

// -------------------------
// WHATSAPP WEBHOOK VERIFY
// -------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed.");
  return res.sendStatus(403);
});

// -------------------------
// WHATSAPP WEBHOOK
// -------------------------
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    console.log(
      "WhatsApp webhook received:",
      JSON.stringify(body, null, 2)
    );

    if (
      body.object !== "whatsapp_business_account" ||
      !body.entry
    ) {
      return res.sendStatus(200);
    }

    for (const entry of body.entry) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value;

        if (!value?.messages) {
          continue;
        }

        for (const message of value.messages) {

          // Only handle text messages
          if (message.type !== "text") {
            continue;
          }

          const from = message.from;
          const userMessage = message.text?.body;

          if (!userMessage) {
            continue;
          }

          console.log(`Message from ${from}: ${userMessage}`);

          // -------------------------
          // ASK GEMINI
          // -------------------------
          const geminiResponse =
            await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: `
You are a helpful customer support assistant.

Rules:
- Be friendly.
- Be clear.
- Keep responses short.
- Give useful answers.
- Be professional.

Customer message:
${userMessage}
              `
            });

          const reply =
            geminiResponse.text ||
            "Sorry, I could not generate a response right now.";

          console.log(`Gemini reply: ${reply}`);

          // -------------------------
          // SEND TO WHATSAPP
          // -------------------------
          await sendWhatsAppMessage(from, reply);
        }
      }
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error("Webhook error:", error);
    return res.sendStatus(500);
  }
});

// -------------------------
// SEND WHATSAPP MESSAGE
// -------------------------
async function sendWhatsAppMessage(to, message) {

  const url =
    `https://graph.facebook.com/${process.env.META_API_VERSION}` +
    `/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  console.log("Sending WhatsApp message...");
  console.log("To:", to);
  console.log("Phone Number ID:", process.env.WHATSAPP_PHONE_NUMBER_ID);

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization:
        `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,

      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    })
  });

  const data = await response.json();

  console.log("WhatsApp API response:", data);

  if (!response.ok) {
    throw new Error(
      `WhatsApp API error: ${JSON.stringify(data)}`
    );
  }

  return data;
}

// -------------------------
// TEST GEMINI WITHOUT WHATSAPP
// -------------------------
app.post("/test", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Please provide a message"
      });
    }

    console.log(`Test message: ${message}`);

    const geminiResponse =
      await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `
You are a helpful customer support assistant.

Rules:
- Be friendly.
- Be clear.
- Keep responses short.
- Give useful answers.
- Be professional.

Customer message:
${message}
        `
      });

    const reply =
      geminiResponse.text ||
      "Sorry, I could not generate a response right now.";

    res.json({
      success: true,
      customer_message: message,
      ai_reply: reply
    });

  } catch (error) {
    console.error("Test error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// -------------------------
// START SERVER
// -------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
