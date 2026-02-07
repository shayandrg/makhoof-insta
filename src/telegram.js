const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FormData = require('form-data');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('TELEGRAM_BOT_TOKEN is not set. Telegram forwarding will fail until it is configured.');
}

if (!TELEGRAM_CHAT_ID) {
  // eslint-disable-next-line no-console
  console.warn('TELEGRAM_CHAT_ID is not set. Telegram forwarding will fail until it is configured.');
}

const TELEGRAM_API_BASE = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

async function sendTextMessage(text) {
  if (!TELEGRAM_API_BASE || !TELEGRAM_CHAT_ID) return;
  await axios.post(`${TELEGRAM_API_BASE}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: undefined,
  });
}

const MAX_MESSAGE_LENGTH = 4096;

/**
 * Temp: send received request body as a text message to Telegram (for debugging).
 */
async function sendRequestBodyAsText(body) {
  let text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = `${text.slice(0, MAX_MESSAGE_LENGTH - 20)}\n\n... (truncated)`;
  }
  await sendTextMessage(text);
}

async function downloadToFile(url) {
  const tempDir = os.tmpdir();

  let ext = '';
  try {
    const u = new URL(url);
    ext = path.extname(u.pathname) || '';
  } catch (_) {
    // ignore URL parse errors, just skip extension
  }

  const fileName = `insta_tg_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const filePath = path.join(tempDir, fileName);

  const response = await axios({
    method: 'get',
    url,
    responseType: 'stream',
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return filePath;
}

async function sendPhoto(url, caption) {
  if (!TELEGRAM_API_BASE || !TELEGRAM_CHAT_ID) return;

  let filePath;
  try {
    filePath = await downloadToFile(url);
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    if (caption) {
      form.append('caption', caption);
    }
    form.append('photo', fs.createReadStream(filePath));

    await axios.post(`${TELEGRAM_API_BASE}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });
  } finally {
    if (filePath) {
      fs.promises.unlink(filePath).catch(() => {});
    }
  }
}

async function sendVideo(url, caption) {
  if (!TELEGRAM_API_BASE || !TELEGRAM_CHAT_ID) return;

  let filePath;
  try {
    filePath = await downloadToFile(url);
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    if (caption) {
      form.append('caption', caption);
    }
    form.append('video', fs.createReadStream(filePath));

    await axios.post(`${TELEGRAM_API_BASE}/sendVideo`, form, {
      headers: form.getHeaders(),
    });
  } finally {
    if (filePath) {
      fs.promises.unlink(filePath).catch(() => {});
    }
  }
}

async function sendMediaGroup(items, caption) {
  if (!TELEGRAM_API_BASE || !TELEGRAM_CHAT_ID) return;
  if (!items || !items.length) return;

  const files = [];

  try {
    const form = new FormData();
    const media = [];

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const type = item.type === 'video' ? 'video' : 'photo';
      const filePath = await downloadToFile(item.url);
      const fieldName = `file${i}`;

      files.push(filePath);

      media.push({
        type,
        media: `attach://${fieldName}`,
        ...(i === 0 && caption ? { caption } : {}),
      });

      form.append(fieldName, fs.createReadStream(filePath));
    }

    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('media', JSON.stringify(media));

    await axios.post(`${TELEGRAM_API_BASE}/sendMediaGroup`, form, {
      headers: form.getHeaders(),
    });
  } finally {
    await Promise.all(
      files.map((filePath) => fs.promises.unlink(filePath).catch(() => {})),
    );
  }
}

function normalizeItemType(type) {
  if (!type) return 'image';
  const t = String(type).toLowerCase();
  if (t === 'reel') return 'video';
  if (t === 'carousel' || t === 'album' || t === 'sidecar') return 'carousel';
  if (t === 'video') return 'video';
  return 'image';
}

async function forwardInstagramPayloadToTelegram(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const sender = payload.sender;

  for (const rawItem of items) {
    const type = normalizeItemType(rawItem.type);
    const captionParts = [];

    if (sender) {
      captionParts.push(`From Instagram @${sender}`);
    }
    if (rawItem.caption) {
      captionParts.push(rawItem.caption);
    }

    const caption = captionParts.join('\n\n') || undefined;

    const mediaArray = Array.isArray(rawItem.media) ? rawItem.media : [];

    if (type === 'carousel') {
      const cleanedItems = mediaArray
        .filter((m) => m && m.url)
        .map((m) => ({
          type: m.type === 'video' ? 'video' : 'image',
          url: m.url,
        }));

      if (cleanedItems.length === 1) {
        const single = cleanedItems[0];
        if (single.type === 'video') {
          await sendVideo(single.url, caption);
        } else {
          await sendPhoto(single.url, caption);
        }
      } else if (cleanedItems.length > 1) {
        await sendMediaGroup(cleanedItems, caption);
      }
    } else if (type === 'video') {
      const video = mediaArray.find((m) => m && m.url && (m.type === 'video' || !m.type));
      if (video) {
        await sendVideo(video.url, caption);
      }
    } else {
      // image (single)
      const image = mediaArray.find((m) => m && m.url && (m.type === 'image' || !m.type));
      if (image) {
        await sendPhoto(image.url, caption);
      }
    }
  }
}

module.exports = {
  forwardInstagramPayloadToTelegram,
  sendRequestBodyAsText,
};

