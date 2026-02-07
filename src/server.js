const express = require('express');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config();

const { forwardInstagramPayloadToTelegram, sendRequestBodyAsText } = require('./telegram');

const app = express();

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || null;

app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.type('text/html').send('hehe');
});

app.get('/privacy-policy', (req, res) => {
  res.type('text/html').send(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Privacy Policy</title></head>' +
    '<body><h1>Privacy Policy</h1><p>We do not collect or store your personal data. Incoming webhook data is used only to forward media to Telegram and is not retained.</p></body></html>'
  );
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Meta/Facebook webhook verification (GET).
 * When configuring webhooks in the App Dashboard, Meta sends a verification request.
 * Must verify hub.verify_token and respond with hub.challenge.
 */
app.get('/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (VERIFY_TOKEN && token !== VERIFY_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  if (challenge) {
    return res.type('text/plain').send(challenge);
  }

  res.status(400).send('Bad Request');
});

// Simple shared-secret check via query param or header, optional
// function validateSecret(req) {
//   if (!WEBHOOK_SECRET) return true;

//   const fromQuery = req.query.secret;
//   const fromHeader = req.get('x-webhook-secret');

//   return fromQuery === WEBHOOK_SECRET || fromHeader === WEBHOOK_SECRET;
// }

/**
 * Instagram webhook endpoint.
 *
 * Expected JSON body format (you can adapt it to your Instagram integration):
 * {
 *   "items": [
 *     {
 *       "type": "image" | "video" | "reel" | "carousel",
 *       "caption": "optional caption",
 *       "media": [
 *         { "type": "image" | "video", "url": "https://..." }
 *       ]
 *     }
 *   ],
 *   "sender": "optional-username-or-id"
 * }
 *
 * Any payload that can be mapped into this shape will work.
 */

/**
 * Temp endpoint: send received request body as a text message to Telegram (for debugging).
 */
// app.post('/instagram/webhook/debug', async (req, res) => {
//   try {
//     const payload = req.body;
//     await sendRequestBodyAsText(payload);
//     res.json({ status: 'sent_as_text' });
//   } catch (err) {
//     // eslint-disable-next-line no-console
//     console.error('Error sending debug payload:', err);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

app.post('/instagram/webhook', async (req, res) => {
  try {
    // if (!validateSecret(req)) {
    //   return res.status(401).json({ error: 'Invalid webhook secret' });
    // }

    const payload = req.body;

    // if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    //   return res.status(400).json({ error: 'Invalid payload: items array is required' });
    // }

    // await forwardInstagramPayloadToTelegram(payload);
    sendRequestBodyAsText(payload).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('sendRequestBodyAsText failed:', err);
    });

    res.json({ status: 'forwarded' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error handling Instagram webhook:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${PORT}`);
});

