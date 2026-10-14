import { db, auth, json } from '../backend/_db.js';

async function getConversation(me, kind, other) {
  if (kind === 'global') {
    let row = (await db('conversations?kind=eq.global&select=id&limit=1'))[0];
    if (!row) {
      row = (await db('conversations', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ user_a: me.id, kind: 'global' })
      }))[0];
    }
    return row;
  }
  if (!other || other === me.id) return null;
  const target = (await db('users?id=eq.' + encodeURIComponent(other) + '&status=eq.active&select=id'))[0];
  if (!target) return null;
  let row = (await db('conversations?kind=eq.dm&or=(and(user_a.eq.' + encodeURIComponent(me.id) + ',user_b.eq.' + encodeURIComponent(other) + '),and(user_a.eq.' + encodeURIComponent(other) + ',user_b.eq.' + encodeURIComponent(me.id) + '))&select=id&limit=1'))[0];
  if (!row) {
    row = (await db('conversations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_a: me.id, user_b: other, kind: 'dm' })
    }))[0];
  }
  return row;
}

export default async function handler(req, res) {
  try {
    const me = await auth(req);
    if (!me) return json(res, 401, { ok: false, message: 'Unauthorized' });
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, message: 'Method not allowed' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const kind = String(body.kind || req.query.kind || 'global');
    if (!['global', 'dm'].includes(kind)) return json(res, 400, { ok: false, message: 'Invalid conversation type' });
    const other = String(body.userId || req.query.userId || '');
    const conversation = await getConversation(me, kind, other);
    if (!conversation?.id) return json(res, 404, { ok: false, message: 'Conversation target not found' });

    if (req.method === 'GET') {
      const messages = await db('messages?conversation_id=eq.' + encodeURIComponent(conversation.id) + '&select=id,sender_id,body,created_at,edited_at&order=created_at.asc&limit=200');
      const ids = [...new Set(messages.map(m => m.sender_id))];
      const users = ids.length ? await db('users?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,name,username') : [];
      const map = Object.fromEntries(users.map(u => [u.id, u]));
      return json(res, 200, { ok: true, messages: messages.map(m => ({ ...m, users: map[m.sender_id] || null })) });
    }

    if (body.action === 'edit') {
      const id = String(body.id || '').trim();
      const text = String(body.text || '').trim().slice(0, 2000);
      if (!id || !text) return json(res, 400, { ok: false, message: 'Message id and text are required' });
      const message = (await db('messages?id=eq.' + encodeURIComponent(id) + '&select=id,sender_id,conversation_id'))[0];
      if (!message) return json(res, 404, { ok: false, message: 'Message not found' });
      if (message.sender_id !== me.id || message.conversation_id !== conversation.id) {
        return json(res, 403, { ok: false, message: 'Not allowed' });
      }
      await db('messages?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ body: text, edited_at: new Date().toISOString() })
      });
      return json(res, 200, { ok: true });
    }

    const text = String(body.text || '').trim().slice(0, 2000);
    if (!text) return json(res, 400, { ok: false, message: 'Message required' });
    await db('messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conversation_id: conversation.id, sender_id: me.id, body: text })
    });
    return json(res, 201, { ok: true });
  } catch {
    return json(res, 500, { ok: false, message: 'Chat request could not be completed' });
  }
}
