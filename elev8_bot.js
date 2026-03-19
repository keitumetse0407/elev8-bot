/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║     ELEV8 DIGITAL — AUTOMATED BOT v2.0                  ║
 * ║                                                          ║
 * ║  FLOW (zero human intervention):                         ║
 * ║  Client texts → Bot collects info →                      ║
 * ║  Bot sends Paystack payment link →                       ║
 * ║  Client pays → Paystack confirms →                       ║
 * ║  PDF auto-generates → Sends to client →                  ║
 * ║  Owner gets sale notification. Done.                     ║
 * ║                                                          ║
 * ║  INSTALL:                                                ║
 * ║    cd ~/elev8/whatsapp-bot                               ║
 * ║    npm install whatsapp-web.js qrcode-terminal axios     ║
 * ║                                                          ║
 * ║  RUN:                                                    ║
 * ║    node elev8_bot.js                                     ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { exec } = require('child_process');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

// ── CONFIG ────────────────────────────────────────────────
const OWNER_NUMBER   = '27799002951';
const PAYSTACK_KEY   = 'sk_live_YOUR_PAYSTACK_SECRET_KEY';
const OUTPUT_DIR     = '/data/data/com.termux/files/home/elev8_outputs';
const AGENT_SCRIPT   = '/data/data/com.termux/files/home/elev8_agent_cli.py';
const SESSIONS_FILE  = path.join(OUTPUT_DIR, '.sessions.json');
const POLL_INTERVAL  = 20000; // check payment every 20 seconds
const POLL_TIMEOUT   = 30 * 60 * 1000; // stop checking after 30 mins

// ── PRICING ───────────────────────────────────────────────
const PRICES = {
    cv:      { label: 'CV Package',          amount: 10000 }, // R100 in kobo
    content: { label: 'Content Pack',         amount: 7500  }, // R75
    replies: { label: 'Business Reply Pack',  amount: 5000  }, // R50
};

// ── SESSION STORE ─────────────────────────────────────────
let sessions = {};

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE))
            sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch(e) { sessions = {}; }
}

function saveSessions() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function setSession(number, data) {
    sessions[number] = { ...sessions[number], ...data, updated: Date.now() };
    saveSessions();
}

function clearSession(number) {
    delete sessions[number];
    saveSessions();
}

// ── CONVERSATION FLOWS ────────────────────────────────────
const FLOWS = {
    cv: {
        steps: [
            { key: 'name',       ask: '👤 What is your *full name*?' },
            { key: 'phone',      ask: '📱 What is your *phone number*?' },
            { key: 'email',      ask: '✉️ What is your *email address*?\n_(Reply "skip" if none)_' },
            { key: 'location',   ask: '📍 What *city or town* are you in?' },
            { key: 'role',       ask: '💼 What *job title* are you applying for?' },
            { key: 'company',    ask: '🏢 What is the *company name* you\'re applying to?' },
            { key: 'experience', ask: '📅 How many *years of experience* do you have?\n_(Reply "0" if none)_' },
            { key: 'skills',     ask: '⚡ List your *top skills*, separated by commas.' },
            { key: 'education',  ask: '🎓 What is your *highest qualification*?\n_(e.g. Matric, N6, Diploma)_' },
            { key: 'prev_jobs',  ask: '📋 Briefly describe your *previous jobs*.\n_(Reply "none" if none)_' },
            { key: 'extra',      ask: '✨ Any *extra info*? Awards, languages, etc.\n_(Reply "none" if nothing)_' },
        ]
    },
    content: {
        steps: [
            { key: 'business',   ask: '🏪 What is your *business or brand name*?' },
            { key: 'product',    ask: '📦 What *product or service* are you promoting?' },
            { key: 'audience',   ask: '🎯 Who is your *target audience*?\n_(e.g. young people in Dennilton)_' },
            { key: 'tone',       ask: '🎨 What *tone* do you want?\n\nReply:\n*1* - Professional\n*2* - Fun & vibey\n*3* - Urgent\n*4* - Inspiring' },
        ]
    },
    replies: {
        steps: [
            { key: 'business',   ask: '🏪 What is your *business name*?' },
            { key: 'service',    ask: '📦 What does your business *sell or offer*?' },
        ]
    }
};

const TONE_MAP = { '1':'professional', '2':'fun and vibey', '3':'urgent', '4':'inspiring' };

// ── MENU ──────────────────────────────────────────────────
const MENU =
`*ELEV8 DIGITAL* 🚀
_We elevate your business. Elev8™_
━━━━━━━━━━━━━━━━━━━━

What do you need today?

*1* — 📄 CV Package _(R100)_
CV + Cover Letter + Job Message

*2* — 📢 Content Pack _(R75)_
Social media captions, ads & poster

*3* — 💬 Business Reply Pack _(R50)_
7 WhatsApp templates for your business

━━━━━━━━━━━━━━━━━━━━
Reply *1*, *2* or *3* to start 👇`;

// ── PAYSTACK ──────────────────────────────────────────────
async function createPaymentLink(clientNumber, service, email) {
    const price    = PRICES[service];
    const ref      = `ELEV8-${service.toUpperCase()}-${clientNumber}-${Date.now()}`;
    const useEmail = email && email !== 'Not provided' ? email : `${clientNumber}@elev8.app`;

    try {
        const res = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email:     useEmail,
                amount:    price.amount,
                reference: ref,
                metadata: {
                    client_number: clientNumber,
                    service:       service,
                    custom_fields: [
                        { display_name: 'Service', value: price.label },
                        { display_name: 'Client',  value: clientNumber }
                    ]
                }
            },
            { headers: { Authorization: `Bearer ${PAYSTACK_KEY}` } }
        );

        return {
            url: res.data.data.authorization_url,
            ref: ref
        };
    } catch(e) {
        console.error('[BOT] Paystack error:', e.response?.data || e.message);
        return null;
    }
}

async function checkPayment(ref) {
    try {
        const res = await axios.get(
            `https://api.paystack.co/transaction/verify/${ref}`,
            { headers: { Authorization: `Bearer ${PAYSTACK_KEY}` } }
        );
        return res.data.data.status === 'success';
    } catch(e) {
        return false;
    }
}

// ── PAYMENT POLLER ────────────────────────────────────────
// Runs in background. Checks every 20s. Auto-delivers on success.
function startPaymentPoller(client, clientNumber, ref, service, data) {
    const startTime = Date.now();

    const poll = async () => {
        // Timeout — stop polling after 30 mins
        if (Date.now() - startTime > POLL_TIMEOUT) {
            console.log(`[BOT] Payment poll timeout for ${clientNumber}`);
            clearSession(clientNumber);
            return;
        }

        const paid = await checkPayment(ref);

        if (paid) {
            console.log(`[BOT] Payment confirmed: ${ref}`);
            await onPaymentSuccess(client, clientNumber, service, data, ref);
        } else {
            // Keep polling
            setTimeout(poll, POLL_INTERVAL);
        }
    };

    // Start polling after 10s delay
    setTimeout(poll, 10000);
}

// ── ON PAYMENT SUCCESS — AUTO PIPELINE ───────────────────
async function onPaymentSuccess(client, clientNumber, service, data, ref) {
    const clientChat = `${clientNumber}@c.us`;
    const ownerChat  = `${OWNER_NUMBER}@c.us`;
    const price      = PRICES[service];

    try {
        // 1. Notify client payment received
        await client.sendMessage(clientChat,
            `✅ *Payment confirmed!*\n\n` +
            `Generating your *${price.label}* now...\n` +
            `This takes about 30 seconds. 🔄`
        );

        // 2. Generate PDF via Python agent
        console.log(`[BOT] Generating ${service} for ${clientNumber}...`);
        const pdfPath = await runAgent(service, data);

        // 3. Send PDF directly to client
        const media = MessageMedia.fromFilePath(pdfPath);
        await client.sendMessage(clientChat, media, {
            caption:
                `🎉 Here is your *${price.label}*!\n\n` +
                `_ELEV8 DIGITAL — We elevate your business. Elev8™_\n\n` +
                `Need changes? Reply *REVISE*\n` +
                `Happy with it? Share us with a friend! 🙏`
        });

        // 4. Notify owner of sale (no action needed)
        await client.sendMessage(ownerChat,
            `💰 *SALE COMPLETED*\n\n` +
            `Service  : ${price.label}\n` +
            `Amount   : R${price.amount / 100}\n` +
            `Client   : ${clientNumber}\n` +
            `Ref      : ${ref}\n` +
            `File     : ${path.basename(pdfPath)}\n\n` +
            `_Delivered automatically. No action needed._`
        );

        // 5. Clear session
        clearSession(clientNumber);
        console.log(`[BOT] Job complete: ${clientNumber} | ${service} | R${price.amount/100}`);

    } catch(e) {
        console.error('[BOT] Delivery error:', e.message);

        // Fallback — notify owner to handle manually
        await client.sendMessage(ownerChat,
            `⚠️ *DELIVERY FAILED*\n\n` +
            `Client: ${clientNumber}\n` +
            `Service: ${service}\n` +
            `Ref: ${ref}\n` +
            `Error: ${e.message}\n\n` +
            `Payment WAS received. Handle manually.`
        );

        await client.sendMessage(clientChat,
            `Sorry, there was a small delay with your delivery. ` +
            `We will send it to you manually within 5 minutes. 🙏`
        );
    }
}

// ── RUN PYTHON AGENT ──────────────────────────────────────
function runAgent(service, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ service, ...data });
        const escaped = payload.replace(/'/g, "'\\''");
        const cmd     = `python3 ${AGENT_SCRIPT} '${escaped}'`;

        exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) { reject(new Error(stderr || err.message)); return; }
            const pdfLine = stdout.trim().split('\n').find(l => l.startsWith('PDF:'));
            if (pdfLine) resolve(pdfLine.replace('PDF:', '').trim());
            else reject(new Error('No PDF path: ' + stdout.slice(0, 200)));
        });
    });
}

// ── MESSAGE HANDLER ───────────────────────────────────────
async function handleMessage(client, msg) {
    const from   = msg.from.replace('@c.us', '');
    const body   = msg.body.trim();
    const lower  = body.toLowerCase();
    const isOwner= from === OWNER_NUMBER;

    console.log(`[${from}]: ${body}`);

    // ── OWNER STATS COMMAND ───────────────────────────────
    if (isOwner && lower === 'stats') {
        const active = Object.entries(sessions)
            .map(([num, s]) => `${num} — ${s.serviceLabel || '?'} — ${s.step || 'pending'}`)
            .join('\n');
        await msg.reply(
            `*Active Sessions:* ${Object.keys(sessions).length}\n\n` +
            (active || 'None') + '\n\n' +
            `Output folder: ${OUTPUT_DIR}`
        );
        return;
    }

    const session = sessions[from] || null;

    // ── ACTIVE CONVERSATION ───────────────────────────────
    if (session && session.service && !session.awaitingPayment) {
        const flow    = FLOWS[session.service];
        const stepIdx = session.stepIndex || 0;
        const step    = flow.steps[stepIdx];
        const data    = session.data || {};

        // Map tone numbers
        let answer = body;
        if (step.key === 'tone') answer = TONE_MAP[body] || body;
        if (answer.toLowerCase() === 'skip' || answer.toLowerCase() === 'none') {
            answer = 'Not provided';
        }

        data[step.key] = answer;
        const nextStep = stepIdx + 1;

        if (nextStep < flow.steps.length) {
            setSession(from, { data, stepIndex: nextStep });
            await msg.reply(
                `${flow.steps[nextStep].ask}\n\n` +
                `_Step ${nextStep + 1} of ${flow.steps.length}_`
            );
        } else {
            // All collected — create payment link
            setSession(from, { data, awaitingPayment: true });

            const email      = data.email || data.business;
            const payResult  = await createPaymentLink(from, session.service, email);
            const price      = PRICES[session.service];

            if (payResult) {
                setSession(from, { payRef: payResult.ref });
                await msg.reply(
                    `✅ *Got all your details!*\n\n` +
                    `Your *${price.label}* is ready to generate.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `💰 *Amount:* R${price.amount / 100}\n` +
                    `🔗 *Pay here:*\n${payResult.url}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `Once payment goes through, your package will be *automatically delivered here* within 60 seconds. 🚀\n\n` +
                    `_No need to message us — it's fully automated._`
                );

                // Start background payment poller
                startPaymentPoller(client, from, payResult.ref, session.service, data);

            } else {
                // Paystack failed — fallback to manual
                await msg.reply(
                    `✅ *Got your details!*\n\n` +
                    `*${price.label}* — R${price.amount / 100}\n\n` +
                    `Pay via EFT or SnapScan:\n` +
                    `📞 +27 79 900 2951\n\n` +
                    `Reply *PAID* once done and your package will be generated immediately.`
                );
            }
        }
        return;
    }

    // Manual PAID fallback (if Paystack link failed)
    if (session && session.awaitingPayment && !session.payRef && lower === 'paid') {
        await msg.reply(`⏳ Generating your package now... 30 seconds 🔄`);
        try {
            const pdfPath = await runAgent(session.service, session.data);
            const media   = MessageMedia.fromFilePath(pdfPath);
            await msg.reply(media, { caption: `🎉 Here is your *${PRICES[session.service].label}*! Enjoy! 🚀` });
            await client.sendMessage(`${OWNER_NUMBER}@c.us`,
                `💰 MANUAL SALE\nService: ${session.service}\nClient: ${from}\nFile: ${path.basename(pdfPath)}`
            );
            clearSession(from);
        } catch(e) {
            await msg.reply(`Sorry, error generating. We'll send manually. Contact: +27 79 900 2951`);
        }
        return;
    }

    // ── SERVICE SELECTION ─────────────────────────────────
    if (['1','2','3'].includes(body)) {
        const map     = { '1':'cv', '2':'content', '3':'replies' };
        const service = map[body];
        const flow    = FLOWS[service];

        setSession(from, {
            service,
            serviceLabel: PRICES[service].label,
            stepIndex: 0,
            data: {}
        });

        await msg.reply(
            `🔥 Let\'s build your *${PRICES[service].label}*!\n\n` +
            `I\'ll ask ${flow.steps.length} quick questions.\n\n` +
            `${flow.steps[0].ask}\n\n` +
            `_Step 1 of ${flow.steps.length}_`
        );
        return;
    }

    // ── DEFAULT / GREETING ────────────────────────────────
    const greetings = ['hi','hello','hey','hie','howzit','yo','sup','start','menu','help','info'];
    if (greetings.some(g => lower.includes(g)) || !session) {
        await msg.reply(MENU);
    }
}

// ── INIT ──────────────────────────────────────────────────
loadSessions();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'elev8-bot' }),
    puppeteer: {
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
        headless: true
    }
});

client.on('qr', qr => {
    console.log('\n[BOT] Scan QR code:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('\n✅ ELEV8 DIGITAL Bot is LIVE');
    console.log(`Owner  : ${OWNER_NUMBER}`);
    console.log(`Outputs: ${OUTPUT_DIR}`);
    console.log('Waiting for messages...\n');

    // Notify owner bot is online
    try {
        await client.sendMessage(`${OWNER_NUMBER}@c.us`,
            `✅ *ELEV8 BOT ONLINE*\n\nFully automated. Ready to take orders.\nType *stats* to see active sessions.`
        );
    } catch(e) {}
});

client.on('message', msg => {
    if (msg.fromMe) return;
    handleMessage(client, msg).catch(e =>
        console.error('[BOT] Error:', e.message)
    );
});

client.on('disconnected', reason => {
    console.log('[BOT] Disconnected:', reason);
    process.exit(1);
});

client.initialize();
