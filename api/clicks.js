import crypto from 'node:crypto';
import { db, auth, json } from '../backend/_db.js';

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, message: 'Method not allowed' });
    }
    const me = await auth(req);
    if (!me) return json(res, 401, { ok: false, message: 'Unauthorized' });
    if (!process.env.CLICK_SIGNING_SECRET || process.env.CLICK_SIGNING_SECRET.length < 32) {
      return json(res, 503, { ok: false, message: 'Tracking links are not configured' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const offerId = clean(body.offerId, 80);
    if (!offerId) return json(res, 400, { ok: false, message: 'Offer id is required' });
    const offer = (await db('offers?id=eq.' + encodeURIComponent(offerId) + '&status=eq.active&select=id,name,daily_cap'))[0];
    if (!offer) return json(res, 404, { ok: false, message: 'Active offer not found' });
    const membership = (await db('offer_memberships?user_id=eq.' + encodeURIComponent(me.id) + '&offer_id=eq.' + encodeURIComponent(offerId) + '&select=user_id'))[0];
    if (!membership) return json(res, 403, { ok: false, message: 'Join the offer before generating a tracking link' });

    const subs = {};
    for (let i = 1; i <= 8; i++) {
      const value = clean(body.subs?.['sub' + i], 200);
      if (value) subs['sub' + i] = value;
    }
    const payload = Buffer.from(JSON.stringify({
      userId: me.id, offerId: offer.id, subs,
      exp: Date.now() + 24 * 60 * 60 * 1000,
      nonce: crypto.randomBytes(12).toString('hex')
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', process.env.CLICK_SIGNING_SECRET).update(payload).digest('base64url');
    const origin = String(process.env.PUBLIC_API_ORIGIN || ('https://' + req.get('host'))).replace(/\/+$/, '');
    return json(res, 201, { ok: true, url: origin + '/go/' + payload + '.' + signature, expiresInSeconds: 86400 });
  } catch {
    return json(res, 500, { ok: false, message: 'Tracking link could not be created' });
  }
}
