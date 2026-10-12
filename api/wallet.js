import { db, auth, json, auditLog } from '../backend/_db.js';
import { notifyUser } from '../backend/_notify.js';

function normalizeWithdrawal(w) {
  const details = w?.account_details && typeof w.account_details === 'object' ? w.account_details : {};
  const note = String(w?.admin_note || '');
  const match = note.match(/(?:Manual payment reference|Provider reference):\s*(.+)$/i);
  return {
    ...w,
    account_number: String(details.account_number || details.number || w?.account_number || ''),
    provider_ref: w?.provider_ref || (match ? match[1].trim() : ''),
    updated_at: w?.processed_at || w?.updated_at || w?.created_at
  };
}

function rpcPayload(result) {
  return Array.isArray(result) ? result[0] : result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  try {
    const me = await auth(req);
    if (!me) return json(res, 401, { ok: false, message: 'Unauthorized' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (body.action === 'get') {
      let wallet = (await db('wallets?user_id=eq.' + encodeURIComponent(me.id) + '&select=*'))[0];
      if (!wallet) {
        wallet = (await db('wallets', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ user_id: me.id, balance: 0, pending: 0, paid: 0 })
        }))[0];
      }
      const balance = Number(wallet?.balance || 0);
      const pending = Number(wallet?.pending || 0);
      return json(res, 200, { ok: true, wallet: { ...wallet, balance, pending, available: Math.max(0, balance - pending) } });
    }

    if (body.action === 'withdraw') {
      const amount = Number(body.amount);
      const method = String(body.method || '').trim();
      const account = String(body.account_number || '').trim();
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !method || !account) {
        return json(res, 400, { ok: false, message: 'Invalid withdrawal request' });
      }
      if (!['bKash', 'Nagad', 'Rocket'].includes(method)) {
        return json(res, 400, { ok: false, message: 'Unsupported payment method' });
      }
      if (!/^[0-9+ -]{8,25}$/.test(account)) {
        return json(res, 400, { ok: false, message: 'Invalid account number' });
      }

      const result = rpcPayload(await db('rpc/request_manual_withdrawal', {
        method: 'POST',
        body: JSON.stringify({ p_user_id: me.id, p_amount: amount, p_method: method, p_account_number: account })
      }));
      if (!result?.ok) {
        const status = Number(result?.status || 400);
        return json(res, status >= 400 && status <= 599 ? status : 400,
          { ok: false, message: result?.message || 'Withdrawal request failed' });
      }
      await auditLog(me.id, 'withdrawal.requested', {
        withdrawal_id: result.withdrawal?.id, amount, method
      });
      return json(res, 201, { ok: true, withdrawal: normalizeWithdrawal(result.withdrawal),
        available_balance: result.available_balance, pending: result.pending });
    }

    if (body.action === 'list') {
      const query = me.role === 'admin'
        ? 'withdrawals?select=*&order=created_at.desc&limit=200'
        : 'withdrawals?user_id=eq.' + encodeURIComponent(me.id) + '&select=*&order=created_at.desc&limit=200';
      return json(res, 200, { ok: true, withdrawals: (await db(query)).map(normalizeWithdrawal) });
    }

    if (body.action === 'update') {
      if (me.role !== 'admin') return json(res, 403, { ok: false, message: 'Admin only' });
      const id = String(body.id || '').trim();
      const next = String(body.status || '');
      const paymentRef = String(body.payment_ref || '').trim().slice(0, 120);
      if (!id || !['approved', 'rejected', 'cancelled'].includes(next)) {
        return json(res, 400, { ok: false, message: 'Invalid withdrawal status update' });
      }
      if (next === 'approved' && !paymentRef) {
        return json(res, 400, { ok: false, message: 'Payment reference is required after sending the manual payment' });
      }

      const result = rpcPayload(await db('rpc/process_manual_withdrawal', {
        method: 'POST',
        body: JSON.stringify({
          p_withdrawal_id: id,
          p_admin_id: me.id,
          p_status: next,
          p_payment_ref: paymentRef || null
        })
      }));
      if (!result?.ok) {
        const status = Number(result?.status || 400);
        return json(res, status >= 400 && status <= 599 ? status : 400,
          { ok: false, message: result?.message || 'Withdrawal update failed' });
      }

      const withdrawal = normalizeWithdrawal(result.withdrawal);
      if (next === 'approved') {
        await notifyUser(withdrawal.user_id, 'Withdrawal paid',
          'Your TrackNest withdrawal of ৳' + Number(withdrawal.amount).toFixed(2) +
          ' has been paid manually. Reference: ' + paymentRef);
      } else {
        await notifyUser(withdrawal.user_id, next === 'rejected' ? 'Withdrawal rejected' : 'Withdrawal cancelled',
          'Your TrackNest withdrawal of ৳' + Number(withdrawal.amount).toFixed(2) +
          ' was ' + next + '. The reserved amount is available again.');
      }
      return json(res, 200, { ok: true, withdrawal });
    }

    return json(res, 400, { ok: false, message: 'Unknown action' });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || 'Server error' });
  }
}
