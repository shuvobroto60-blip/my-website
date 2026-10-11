import { db, auth, json } from '../backend/_db.js';

async function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

export default async function handler(req, res) {
  try {
    const me = await auth(req);
    if (!me) return json(res, 401, { ok: false, message: 'Unauthorized' });

    if (req.method === 'GET') {
      const rows = await db('notifications?user_id=eq.' + encodeURIComponent(me.id) +
        '&select=id,title,message,type,is_read,created_at&order=created_at.desc&limit=50');
      return json(res, 200, { ok: true, notifications: rows });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, message: 'Method not allowed' });
    }

    const b = await parseBody(req);
    if (b.action === 'mark_all_read') {
      await db('notifications?user_id=eq.' + encodeURIComponent(me.id) + '&is_read=eq.false', {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ is_read: true })
      });
      return json(res, 200, { ok: true });
    }
    if (b.action === 'mark_read') {
      const id = String(b.id || '');
      if (!id) return json(res, 400, { ok: false, message: 'Notification id required' });
      await db('notifications?id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(me.id), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ is_read: true })
      });
      return json(res, 200, { ok: true });
    }

    if (me.role !== 'admin') return json(res, 403, { ok: false, message: 'Admin only' });
    const channel = String(b.channel || '');
    const recipient = String(b.recipient || '').trim().slice(0, 254);
    const subject = String(b.subject || 'TrackNest').trim().slice(0, 180);
    const body = String(b.body || '').trim().slice(0, 4000);
    if (!['email', 'sms'].includes(channel) || !recipient || !body) {
      return json(res, 400, { ok: false, message: 'Channel, recipient and message are required' });
    }

    let sent = false, ref = null, providerConfigured = false;
    if (channel === 'email' && process.env.RESEND_API_KEY) {
      providerConfigured = true;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'TrackNest <onboarding@resend.dev>',
          to: [recipient], subject, html: '<p>' + body.replace(/</g, '&lt;') + '</p>'
        })
      });
      const j = await r.json().catch(() => ({}));
      sent = r.ok; ref = j.id || null;
    }
    if (channel === 'sms' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
      providerConfigured = true;
      const basic = Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64');
      const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: process.env.TWILIO_FROM, To: recipient, Body: body })
      });
      const j = await r.json().catch(() => ({}));
      sent = r.ok; ref = j.sid || null;
    }

    await db('notifications', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: null, title: subject, message: body,
        type: channel + (sent ? '_sent' : '_queued'), is_read: false
      })
    });
    return json(res, 200, { ok: true, sent, providerConfigured, provider_ref: ref });
  } catch (e) {
    return json(res, 500, { ok: false, message: e.message || 'Notification error' });
  }
}
