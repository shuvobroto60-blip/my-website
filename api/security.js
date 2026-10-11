import { db, auth, json } from '../backend/_db.js';

export default async function handler(req, res) {
  try {
    const me = await auth(req);
    if (!me || me.role !== 'admin') return json(res, 403, { ok: false, message: 'Admin only' });
    if (req.method !== 'GET') return json(res, 405, { ok: false, message: 'Method not allowed' });
    const kind = String(req.query.kind || 's2s');

    if (kind === 's2s') {
      const posts = await db('postbacks?select=click_id,payout,status,received_at&order=received_at.desc&limit=200');
      const ids = [...new Set(posts.map(x => x.click_id).filter(Boolean))];
      const clicks = ids.length ? await db('clicks?click_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=click_id,offer_id') : [];
      const offers = await db('offers?select=id,name');
      const cm = Object.fromEntries(clicks.map(x => [x.click_id, x.offer_id]));
      const om = Object.fromEntries(offers.map(x => [x.id, x.name]));
      return json(res, 200, { ok: true, logs: posts.map(x => ({
        time: x.received_at, click_id: x.click_id,
        offer: om[cm[x.click_id]] || cm[x.click_id] || 'Unknown',
        payout: Number(x.payout || 0), status: x.status
      })) });
    }

    if (kind === 'audit') {
      const logs = await db('audit_logs?select=id,actor_id,action,details,created_at&order=created_at.desc&limit=300');
      const ids = [...new Set(logs.map(x => x.actor_id).filter(Boolean))];
      const users = ids.length ? await db('users?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,username,name') : [];
      const names = Object.fromEntries(users.map(x => [x.id, x.name || x.username || x.id]));
      return json(res, 200, { ok: true, logs: logs.map(x => ({
        id: x.id, time: x.created_at, actor: names[x.actor_id] || 'System',
        action: x.action + (x.details?.offer_id ? ' · offer ' + x.details.offer_id : '') +
          (x.details?.target_user_id ? ' · user ' + x.details.target_user_id : '') +
          (x.details?.withdrawal_id ? ' · withdrawal ' + x.details.withdrawal_id : '')
      })) });
    }

    if (kind === 'fraud') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const clicks = await db('clicks?created_at=gte.' + encodeURIComponent(since) +
        '&select=id,click_id,user_id,offer_id,created_at&order=created_at.desc&limit=10000');
      const offers = await db('offers?select=id,name');
      const users = await db('users?select=id,username,name');
      const offerNames = Object.fromEntries(offers.map(x => [x.id, x.name]));
      const userNames = Object.fromEntries(users.map(x => [x.id, x.name || x.username || x.id]));
      const buckets = new Map();
      for (const c of clicks) {
        if (!c.user_id || !c.offer_id || !c.created_at) continue;
        const key = c.user_id + '|' + c.offer_id;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(c);
      }
      const logs = [];
      for (const [key, items] of buckets) {
        if (items.length < 20) continue;
        const recent = items.filter(x => Date.now() - new Date(x.created_at).getTime() <= 5 * 60 * 1000);
        if (recent.length >= 20) {
          const [userId, offerId] = key.split('|');
          logs.push({ time: recent[0].created_at, userId, user: userNames[userId] || userId,
            offerId, offerName: offerNames[offerId] || offerId,
            reason: 'High click burst: ' + recent.length + ' clicks in 5 minutes' });
        }
      }
      return json(res, 200, { ok: true, logs: logs.sort((a,b) => new Date(b.time)-new Date(a.time)).slice(0,200) });
    }

    return json(res, 400, { ok: false, message: 'Unknown security view' });
  } catch (e) {
    return json(res, 500, { ok: false, message: e.message || 'Security error' });
  }
}
