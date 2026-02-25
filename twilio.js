// Download the helper library from https://www.twilio.com/docs/node/install
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();

// Find your Account SID and Auth Token at twilio.com/console
// and set the environment variables. See http://twil.io/secure
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

async function createToken() {
    try {
        const token = await client.tokens.create();
        console.log("TURN Servers:", token.iceServers);
    } catch (error) {
        console.error("Error generating TURN credentials:", error);
    }
}

createToken();
