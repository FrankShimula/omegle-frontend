// utils/twilioTurnCache.js
import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

let cachedCredentials = null;
let lastFetched = 0;
const TTL = 10 * 60 * 1000; // 10 minutes

export async function getTurnCredentials() {
    const now = Date.now();

    if (cachedCredentials && now - lastFetched < TTL) {
        return cachedCredentials;
    }

    try {
        const token = await client.tokens.create();
        cachedCredentials = token.iceServers;
        lastFetched = now;
        console.log("🔁 TURN credentials refreshed");
        return cachedCredentials;
    } catch (err) {
        console.error("❌ Failed to fetch TURN credentials", err);
        // fallback or throw depending on your strategy
        return cachedCredentials || []; // or throw err
    }
}
