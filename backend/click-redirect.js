import crypto from 'node:crypto';
import { db } from './_db.js';

export async function handleClickRedirect(req, res) {
  try {
    const secret = String(process.env.CLICK_SIGNING_SECRET || '');
    if (secret.length < 32) return res.status(503).send('Tracking links are not configured.');
    const token = String(req.params.token || '');
    const dot = token.lastIndexOf('.');
    if (dot < 1) return res.status(400).send('Invalid tracking link.');
    const payload = token.slice(0, dot);
    const supplied = Buffer.from(token.slice(dot + 1), 'base64url');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(400).send('Invalid tracking link.');
    }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.userId || !data.offerId || !Number.isFinite(data.exp) || data.exp < Date.now()) {
      return res.status(410).send('This tracking link has expired.');
    }
    const user = (await db('users?id=eq.' + encodeURIComponent(data.userId) + '&status=eq.active&select=id'))[0];
    const offer = (await db('offers?id=eq.' + encodeURIComponent(data.offerId) + '&status=eq.active&select=id,url,daily_cap'))[0];
    const membership = (await db('offer_memberships?user_id=eq.' + encodeURIComponent(data.userId) + '&offer_id=eq.' + encodeURIComponent(data.offerId) + '&select=user_id'))[0];
    if (!user || !offer || !membership) return res.status(404).send('This offer or account is no longer available.');

    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    if (Number(offer.daily_cap) > 0) {
      const today = await db('clicks?user_id=eq.' + encodeURIComponent(data.userId) + '&offer_id=eq.' + encodeURIComponent(data.offerId) +
        '&created_at=gte.' + encodeURIComponent(dayStart.toISOString()) + '&select=id&limit=10000');
      if (today.length >= Number(offer.daily_cap)) return res.status(429).send('Daily offer cap reached.');
    }
    const recent = await db('clicks?user_id=eq.' + encodeURIComponent(data.userId) + '&offer_id=eq.' + encodeURIComponent(data.offerId) +
      '&created_at=gte.' + encodeURIComponent(new Date(Date.now() - 5000).toISOString()) + '&select=id&limit=1');
    if (recent.length) return res.status(429).send('Please wait a few seconds before clicking this offer again.');

    const clickId = 'TN-' + crypto.randomBytes(12).toString('hex');
    const subs = data.subs && typeof data.subs === 'object' ? data.subs : {};
    await db('clicks', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        click_id: clickId, user_id: data.userId, offer_id: data.offerId,
        sub1: subs.sub1 || null, sub2: subs.sub2 || null, sub3: subs.sub3 || null,
        sub4: subs.sub4 || null, sub5: subs.sub5 || null, sub6: subs.sub6 || null,
        sub7: subs.sub7 || null, sub8: subs.sub8 || null
      })
    });
    const target = new URL(offer.url);
    target.searchParams.set('click_id', clickId);
    for (let i = 1; i <= 8; i++) if (subs['sub' + i]) target.searchParams.set('sub' + i, String(subs['sub' + i]));
    return res.redirect(302, target.toString());
  } catch {
    return res.status(500).send('Tracking redirect could not be completed.');
  }
}
