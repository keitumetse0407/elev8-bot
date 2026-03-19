/**
 * ELEV8 DIGITAL — WhatsApp Bot (Baileys)
 * Runs on Android/Termux. No Puppeteer. No browser.
 *
 * INSTALL:
 *   cd ~/elev8/whatsapp-bot
 *   npm install @whiskeysockets/baileys qrcode-terminal axios
 *
 * RUN:
 *   node elev8_baileys.js
 *
 * FIRST RUN: Scan QR with WhatsApp → Linked Devices → Link a Device
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const qrcode  = require('qrcode-terminal');
const axios   = require('axios');
const { exec } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const P       = require('pino');

// ── CONFIG ────────────────────────────────────────────────
const OWNER          = '27799002951';
const PAYSTACK_KEY   = 'sk_test_8465fa75a822ad9c30c64e2ac2702106ba0e878f';
const OUTPUT_DIR     = '/data/data/com.termux/files/home/elev8_outputs';
const AGENT_SCRIPT   = '/data/data/com.termux/files/home/elev8_agent_cli.py';
const AUTH_DIR       = '/data/data/com.termux/files/home/elev8_auth';
const SESSIONS_FILE  = path.join(OUTPUT_DIR, '.sessions.json');
const POLL_INTERVAL  = 20000;
const POLL_TIMEOUT   = 30 * 60 * 1000;

// ── PRICES ────────────────────────────────────────────────
const PRICES = {
    cv:      { label: 'CV Package',         amount: 10000 },
    content: { label: 'Content Pack',        amount: 7500  },
    replies: { label: 'Business Reply Pack', amount: 5000  },
};

// ── SESSIONS ──────────────────────────────────────────────
let sessions = {};
let sock;

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE))
            sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch(e) { sessions = {}; }
}

function setSession(num, data) {
    sessions[num] = { ...sessions[num], ...data, updated: Date.now() };
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function clearSession(num) {
    delete sessions[num];
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

// ── SEND MESSAGE ──────────────────────────────────────────
async function send(jid, text) {
    try {
        await sock.sendMessage(jid, { text });
    } catch(e) {
        console.error('[send error]', e.message);
    }
}

async function sendPDF(jid, filePath, caption) {
    try {
        const data     = fs.readFileSync(filePath);
        const filename = path.basename(filePath);
        await sock.sendMessage(jid, {
            document: data,
            fileName: filename,
            mimetype: 'application/pdf',
            caption:  caption || ''
        });
    } catch(e) {
        console.error('[sendPDF error]', e.message);
        throw e;
    }
}

// ── FLOWS ─────────────────────────────────────────────────
const FLOWS = {
    cv: {
        steps: [
            { key: 'name',       ask: '👤 Full name?' },
            { key: 'phone',      ask: '📱 Phone number?' },
            { key: 'email',      ask: '✉️ Email address? (Reply "skip" if none)' },
            { key: 'location',   ask: '📍 City or town?' },
            { key: 'role',       ask: '💼 Job title applying for?' },
            { key: 'company',    ask: '🏢 Company name applying to?' },
            { key: 'experience', ask: '📅 Years of experience? (0 if none)' },
            { key: 'skills',     ask: '⚡ Top skills, separated by commas?' },
            { key: 'education',  ask: '🎓 Highest qualification? (e.g. Matric, N6, Diploma)' },
            { key: 'prev_jobs',  ask: '📋 Previous jobs briefly? (Reply "none" if none)' },
            { key: 'extra',      ask: '✨ Extra info? Awards, languages, etc. (Reply "none" if nothing)' },
        ]
    },
    content: {
        steps: [
            { key: 'business', ask: '🏪 Business or brand name?' },
            { key: 'product',  ask: '📦 Product or service promoting?' },
            { key: 'audience', ask: '🎯 Target audience?' },
            { key: 'tone',     ask: '🎨 Tone?\n\n1 - Professional\n2 - Fun\n3 - Urgent\n4 - Inspiring' },
        ]
    },
    replies: {
        steps: [
            { key: 'business', ask: '🏪 Business name?' },
            { key: 'service',  ask: '📦 What does your business sell or offer?' },
        ]
    }
};

const TONE_MAP = { '1':'professional','2':'fun and vibey','3':'urgent','4':'inspiring' };

// ── MENU ──────────────────────────────────────────────────
const MENU =
`*ELEV8 DIGITAL* 🚀
_We elevate your business. Elev8™_
━━━━━━━━━━━━━━━━━━━━

*1* — 📄 CV Package _(R100)_
CV + Cover Letter + Job Message as PDF

*2* — 📢 Content Pack _(R75)_
Social media captions, ads & poster

*3* — 💬 Business Reply Pack _(R50)_
7 WhatsApp templates for your business

━━━━━━━━━━━━━━━━━━━━
Reply *1*, *2* or *3* to start 👇`;

// ── PAYSTACK ──────────────────────────────────────────────
async function createPaymentLink(clientNum, service, email) {
    const price = PRICES[service];
    const ref   = `ELEV8-${service.toUpperCase()}-${clientNum}-${Date.now()}`;
    const mail  = (email && email !== 'Not provided') ? email : `${clientNum}@elev8.app`;

    try {
        const res = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            { email: mail, amount: price.amount, reference: ref,
              metadata: { client_number: clientNum, service } },
            { headers: { Authorization: `Bearer ${PAYSTACK_KEY}` } }
        );
        return { url: res.data.data.authorization_url, ref };
    } catch(e) {
        console.error('[Paystack]', e.response?.data || e.message);
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
    } catch(e) { return false; }
}

// ── PAYMENT POLLER ────────────────────────────────────────
function startPoller(clientNum, ref, service, data) {
    const start = Date.now();
    const jid   = `${clientNum}@s.whatsapp.net`;

    const poll = async () => {
        if (Date.now() - start > POLL_TIMEOUT) {
            clearSession(clientNum); return;
        }
        const paid = await checkPayment(ref);
        if (paid) {
            await onPaid(clientNum, jid, service, data, ref);
        } else {
            setTimeout(poll, POLL_INTERVAL);
        }
    };
    setTimeout(poll, 10000);
}

// ── ON PAYMENT SUCCESS ────────────────────────────────────
async function onPaid(clientNum, jid, service, data, ref) {
    const ownerJid = `${OWNER}@s.whatsapp.net`;
    const price    = PRICES[service];

    try {
        await send(jid,
            `✅ *Payment confirmed!*\n\n` +
            `Generating your *${price.label}* now...\n` +
            `About 30 seconds. 🔄`
        );

        const pdfPath = await runAgent(service, data);

        await sendPDF(jid, pdfPath,
            `🎉 Here is your *${price.label}*!\n\n` +
            `_ELEV8 DIGITAL — We elevate your business. Elev8™_\n\n` +
            `Need changes? Reply *REVISE*\n` +
            `Happy? Share us with a friend! 🙏`
        );

        await send(ownerJid,
            `💰 *SALE COMPLETE*\n\n` +
            `Service : ${price.label}\n` +
            `Amount  : R${price.amount/100}\n` +
            `Client  : ${clientNum}\n` +
            `File    : ${path.basename(pdfPath)}\n\n` +
            `_Delivered automatically._`
        );

        clearSession(clientNum);
        console.log(`[BOT] ✅ Delivered: ${service} → ${clientNum}`);

    } catch(e) {
        console.error('[onPaid error]', e.message);
        await send(ownerJid,
            `⚠️ *DELIVERY FAILED*\n` +
            `Client: ${clientNum}\nService: ${service}\n` +
            `Ref: ${ref}\nError: ${e.message}\n\n` +
            `Payment received. Handle manually.`
        );
        await send(jid,
            `Sorry, slight delay. We'll send manually within 5 mins. 🙏\n` +
            `Contact: +27 79 900 2951`
        );
    }
}

// ── RUN PYTHON AGENT ──────────────────────────────────────
function runAgent(service, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ service, ...data });
        const escaped = payload.replace(/'/g, "'\\''");
        exec(`python3 ${AGENT_SCRIPT} '${escaped}'`, { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) { reject(new Error(stderr || err.message)); return; }
            const line = stdout.trim().split('\n').find(l => l.startsWith('PDF:'));
            if (line) resolve(line.replace('PDF:','').trim());
            else reject(new Error('No PDF: ' + stdout.slice(0,200)));
        });
    });
}

// ── MESSAGE HANDLER ───────────────────────────────────────
async function handleMessage(from, body) {
    const lower   = body.toLowerCase().trim();
    const isOwner = from === OWNER;
    const jid     = `${from}@s.whatsapp.net`;
    const ownerJid= `${OWNER}@s.whatsapp.net`;
    const session = sessions[from] || null;

    console.log(`[${from}]: ${body}`);

    // ── OWNER COMMANDS ──
    if (isOwner) {
        if (lower === 'stats') {
            const lines = Object.entries(sessions)
                .map(([n,s]) => `${n} — ${s.serviceLabel||'?'} — step ${s.stepIndex||'?'}`)
                .join('\n');
            await send(ownerJid, `*Sessions:* ${Object.keys(sessions).length}\n\n${lines||'None'}`);
            return;
        }
    }

    // ── COLLECTING INFO ──
    if (session && session.service && !session.awaitingPayment) {
        const flow    = FLOWS[session.service];
        const stepIdx = session.stepIndex || 0;
        const step    = flow.steps[stepIdx];
        const data    = session.data || {};

        let answer = body.trim();
        if (step.key === 'tone') answer = TONE_MAP[answer] || answer;
        if (['skip','none'].includes(answer.toLowerCase())) answer = 'Not provided';
        data[step.key] = answer;

        const next = stepIdx + 1;
        if (next < flow.steps.length) {
            setSession(from, { data, stepIndex: next });
            await send(jid, `${flow.steps[next].ask}\n\n_Step ${next+1} of ${flow.steps.length}_`);
        } else {
            setSession(from, { data, awaitingPayment: true });
            const email   = data.email || data.business || '';
            const result  = await createPaymentLink(from, session.service, email);
            const price   = PRICES[session.service];

            if (result) {
                setSession(from, { payRef: result.ref });
                await send(jid,
                    `✅ *Got all your details!*\n\n` +
                    `Your *${price.label}* is ready to generate.\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `💰 *Amount:* R${price.amount/100}\n` +
                    `🔗 *Pay here:*\n${result.url}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `Once payment goes through, your package will be *automatically delivered here* within 60 seconds. 🚀\n\n` +
                    `_Fully automated — no need to message us._`
                );
                startPoller(from, result.ref, session.service, data);
            } else {
                await send(jid,
                    `✅ *Got your details!*\n\n` +
                    `*${price.label}* — R${price.amount/100}\n\n` +
                    `Pay via EFT or SnapScan:\n📞 +27 79 900 2951\n\n` +
                    `Reply *PAID* once done.`
                );
            }
        }
        return;
    }

    // ── MANUAL PAID FALLBACK ──
    if (session?.awaitingPayment && !session?.payRef && lower === 'paid') {
        await send(jid, `⏳ Generating now... 30 seconds 🔄`);
        try {
            const pdfPath = await runAgent(session.service, session.data);
            await sendPDF(jid, pdfPath, `🎉 Your *${PRICES[session.service].label}* is here! Enjoy! 🚀`);
            await send(ownerJid, `💰 MANUAL SALE\n${session.service}\n${from}\n${path.basename(pdfPath)}`);
            clearSession(from);
        } catch(e) {
            await send(jid, `Error generating. Contact: +27 79 900 2951`);
        }
        return;
    }

    // ── SERVICE SELECTION ──
    if (['1','2','3'].includes(body.trim())) {
        const map     = {'1':'cv','2':'content','3':'replies'};
        const service = map[body.trim()];
        const flow    = FLOWS[service];

        setSession(from, { service, serviceLabel: PRICES[service].label, stepIndex:0, data:{} });
        await send(jid,
            `🔥 Let's build your *${PRICES[service].label}*!\n\n` +
            `${flow.steps.length} quick questions.\n\n` +
            `${flow.steps[0].ask}\n\n_Step 1 of ${flow.steps.length}_`
        );
        return;
    }

    // ── DEFAULT ──
    const greetings = ['hi','hello','hey','hie','howzit','yo','start','menu','help','info'];
    if (greetings.some(g => lower.includes(g)) || !session) {
        await send(jid, MENU);
    }
}

// ── START BOT ─────────────────────────────────────────────
loadSessions();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(AUTH_DIR,   { recursive: true });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
        auth:   state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['ELEV8 DIGITAL', 'Chrome', '1.0.0'],
        version: [2, 3000, 1035194821],
        connectTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n[BOT] Scan this QR code with WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('\n✅ ELEV8 DIGITAL Bot is LIVE (Baileys)');
            console.log(`Owner  : ${OWNER}`);
            console.log('Waiting for messages...\n');
            try {
                await send(`${OWNER}@s.whatsapp.net`,
                    `✅ *ELEV8 BOT ONLINE*\n\nFully automated. Ready to take orders.\nType *stats* to see sessions.`
                );
            } catch(e) {}
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            console.log('[BOT] Disconnected. Code:', code, '| Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            } else {
                console.log('[BOT] Logged out. Delete auth folder and restart to re-scan QR.');
                process.exit(1);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            const from = msg.key.remoteJid?.replace('@s.whatsapp.net','');
            if (!from || from.includes('g.us')) continue; // skip groups
            const body = msg.message?.conversation
                      || msg.message?.extendedTextMessage?.text
                      || '';
            if (!body) continue;
            handleMessage(from, body).catch(e => console.error('[handler]', e.message));
        }
    });
}

startBot().catch(console.error);
