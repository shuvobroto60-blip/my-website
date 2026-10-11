import { db, auth, json } from '../backend/_db.js';

const clean = (v, max = 4000) => String(v ?? '').trim().slice(0, max);

export default async function handler(req, res) {
  try {
    const me = await auth(req);
    if (!me) return json(res, 401, { ok: false, message: 'Unauthorized' });

    if (req.method === 'GET') {
      const tickets = me.role === 'admin'
        ? await db('support_tickets?select=*&order=created_at.desc&limit=300')
        : await db('support_tickets?user_id=eq.' + encodeURIComponent(me.id) + '&select=*&order=created_at.desc&limit=100');
      if (!tickets.length) return json(res, 200, { ok: true, tickets: [] });
      const ids = tickets.map(t => t.id);
      const replies = await db('support_ticket_replies?ticket_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=*&order=created_at.asc&limit=2000');
      const users = await db('users?select=id,username,name');
      const names = Object.fromEntries(users.map(u => [u.id, u.name || u.username || 'User']));
      return json(res, 200, { ok: true, tickets: tickets.map(t => ({
        id: t.id, userId: t.user_id, subject: t.subject, message: t.message,
        status: t.status, priority: t.priority, date: t.created_at,
        replies: replies.filter(r => r.ticket_id === t.id).map(r => ({
          id: r.id, from: r.sender_id, name: names[r.sender_id] || 'User',
          text: r.body, time: r.created_at
        }))
      })) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, message: 'Method not allowed' });
    }
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (b.action === 'create') {
      const subject = clean(b.subject, 180), message = clean(b.message, 4000);
      if (!subject || !message) return json(res, 400, { ok: false, message: 'Subject and message are required' });
      const ticket = (await db('support_tickets', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: me.id, subject, message, status: 'open', priority: 'normal' })
      }))[0];
      return json(res, 201, { ok: true, ticket: { ...ticket, userId: ticket.user_id, date: ticket.created_at, replies: [] } });
    }

    const id = String(b.id || '');
    if (!id) return json(res, 400, { ok: false, message: 'Ticket id is required' });
    const ticket = (await db('support_tickets?id=eq.' + encodeURIComponent(id) + '&select=*'))[0];
    if (!ticket) return json(res, 404, { ok: false, message: 'Ticket not found' });
    if (me.role !== 'admin' && ticket.user_id !== me.id) return json(res, 403, { ok: false, message: 'Not allowed' });

    if (b.action === 'reply') {
      const body = clean(b.message, 4000);
      if (!body) return json(res, 400, { ok: false, message: 'Reply cannot be empty' });
      const reply = (await db('support_ticket_replies', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ticket_id: id, sender_id: me.id, body })
      }))[0];
      if (ticket.status === 'closed' && me.role === 'admin') {
        await db('support_tickets?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: 'open', updated_at: new Date().toISOString() }) });
      }
      return json(res, 201, { ok: true, reply: { id: reply.id, from: reply.sender_id, text: reply.body, time: reply.created_at } });
    }
    if (b.action === 'status') {
      if (me.role !== 'admin') return json(res, 403, { ok: false, message: 'Admin only' });
      const status = String(b.status || '');
      if (!['open', 'in_progress', 'closed'].includes(status)) return json(res, 400, { ok: false, message: 'Invalid ticket status' });
      const updated = (await db('support_tickets?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() })
      }))[0];
      return json(res, 200, { ok: true, ticket: updated });
    }
    return json(res, 400, { ok: false, message: 'Unknown action' });
  } catch (e) {
    return json(res, 500, { ok: false, message: e.message || 'Support error' });
  }
}
