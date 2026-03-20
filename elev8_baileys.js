// elev8_baileys.js (CLEAN + STABLE + QR FIXED)

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const fs = require("fs");
const { exec } = require("child_process");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth");

    const sock = makeWASocket({
        auth: state
    });

    sock.ev.on("creds.update", saveCreds);

    // ✅ FIXED CONNECTION HANDLER (NO DEPRECATED OPTIONS)
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📱 SCAN THIS QR IN WHATSAPP:\n");
            console.log(qr);
        }

        if (connection === "open") {
            console.log("✅ BOT FULLY CONNECTED");
        }

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            console.log("❌ Disconnected. Reconnecting:", shouldReconnect);

            if (shouldReconnect) {
                setTimeout(startBot, 3000); // prevent spam reconnect
            }
        }
    });

    // ✅ MESSAGE HANDLER (ROBUST)
    sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
            console.log("🔥 EVENT TRIGGERED");

            const msg = messages[0];
            if (!msg.message) return;

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text;

            if (!text) return;

            const sender = msg.key.remoteJid;
            const lower = text.toLowerCase();

            console.log("📩 Incoming:", text);

            // ===== MENU =====
            if (lower === "hi" || lower === "menu") {
                await sock.sendMessage(sender, {
                    text: `👋 *Elev8 Digital*

1️⃣ CV (R100)
2️⃣ Content (R50)
3️⃣ Replies (R30)

Reply with number.`
                });
            }

            // ===== CV START =====
            else if (lower === "1") {
                await sock.sendMessage(sender, {
                    text: `📄 Send details:

Full Name:
Education:
Experience:
Skills:`
                });
            }

            // ===== CV PROCESS =====
            else if (text.includes("Full Name")) {
                await sock.sendMessage(sender, {
                    text: "⚙️ Generating CV..."
                });

                fs.writeFileSync("input.txt", text);

                exec("python ~/elev8/cv.py < input.txt", (err, stdout) => {
                    if (err) {
                        sock.sendMessage(sender, {
                            text: "❌ Error generating CV"
                        });
                        return;
                    }

                    sock.sendMessage(sender, {
                        text: `✅ CV Preview:\n\n${stdout}\n\n💰 Pay R100 for PDF`
                    });
                });
            }

            // ===== DEFAULT =====
            else {
                await sock.sendMessage(sender, {
                    text: "Type *hi*"
                });
            }

        } catch (err) {
            console.log("ERROR:", err);
        }
    });
}

startBot();

