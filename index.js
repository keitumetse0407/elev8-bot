console.log("🚀 Starting bot...");

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const pino = require('pino')

const MENU = `🔥 *ELEV8 DIGITAL*
━━━━━━━━━━━━━━━
We help you get hired faster.

Reply:
*1* — CV + Job Application (R50 intro)
*0* — Talk to me`

const RESPONSES = {
  '1': `📄 *CV + Job Application — R50 (Intro Offer)*
━━━━━━━━━━━━━━━
✅ Professional CV
✅ Ready-to-send job message
✅ Delivered same day

Send me:
1. Your full name
2. Job you're applying for
3. Work experience (if any)
4. Your qualifications

🟢 Pay after delivery`,

  '0': `👋 You're now talking directly to Elkai.
I'll reply shortly.
━━━━━━━━━━━━━━━
⏱ Response time: under 1 hour`
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'debug' }),
    printQRInTerminal: true
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Scan this QR code with WhatsApp:\n')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      if (shouldReconnect) startBot()
    }

    if (connection === 'open') {
      console.log('✅ ELEV8 Bot is live!')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text || ''
    ).trim().toLowerCase()

    const greetings = ['hi','hello','hey','hie','helo','sawubona','dumela','start','menu','?']

    if (greetings.some(g => text.includes(g)) || text === '') {
      await sock.sendMessage(from, { text: MENU })
      return
    }

    if (RESPONSES[text]) {
      await sock.sendMessage(from, { text: RESPONSES[text] })
      return
    }

    if (text.includes('cv') || text.includes('job')) {
      await sock.sendMessage(from, { text: RESPONSES['1'] })
      return
    }

    await sock.sendMessage(from, {
      text: `Thanks for messaging *ELEV8 DIGITAL*.\n\nReply *menu* to see options or *0* to talk to me.`
    })
  })
}

startBot()
