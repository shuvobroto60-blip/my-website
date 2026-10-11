import { db, auth, json } from '../backend/_db.js';
import { notifyUser } from '../backend/_notify.js';

function normalizeWithdrawal(w) {
  const details = w?.account_details && typeof w.account_details === 'object' ? w.account_details : {};
  const note = String(w?.admin_note || '');
  const match = note.match(/(?:Manual payment reference|Provider reference):\s*(.+)$/i);
  return { ...w, account_number: String(details.account_number || details.number || ''),
    provider_ref: match ? match[1].trim() : '', updated_at: w?.processed_at || w?.created_at };
}

async function patchWallet(userId, filters, values) {
  const query = 'wallets?user_id=eq.' + encodeURIComponent(userId) +
    filters.map(([key, value]) => '&' + key + '=eq.' + encodeURIComponent(String(value))).join('');
  return db(query, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
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
      return json(res, 200, { ok: true, wallet });
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

      const wallet = (await db('wallets?user_id=eq.' + encodeURIComponent(me.id) + '&select=*'))[0];
      if (!wallet || Number(wallet.balance || 0) < amount) {
        return json(res, 400, { ok: false, message: 'Insufficient balance' });
      }
      const oldBalance = Number(wallet.balance || 0);
      const oldPending = Number(wallet.pending || 0);
      const changed = await patchWallet(me.id, [['balance', oldBalance]], {
        balance: oldBalance - amount,
        pending: oldPending + amount
      });
      if (!changed.length) return json(res, 409, { ok: false, message: 'Balance changed. Please try again.' });

      try {
        const withdrawal = (await db('withdrawals', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            user_id: me.id, amount, method, account_details: { account_number: account }, status: 'pending'
          })
        }))[0];
        return json(res, 201, { ok: true, withdrawal });
      } catch (error) {
        await patchWallet(me.id, [['balance', oldBalance - amount], ['pending', oldPending + amount]], {
          balance: oldBalance, pending: oldPending
        }).catch(() => {});
        throw error;
      }
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
        return json(res, 400, { ok: false, message: 'Payment reference is required when marking a manual payment as paid' });
      }

      const withdrawal = (await db('withdrawals?id=eq.' + encodeURIComponent(id) + '&select=*'))[0];
      if (!withdrawal) return json(res, 404, { ok: false, message: 'Withdrawal not found' });
      if (withdrawal.status !== 'pending') {
        return json(res, 409, { ok: false, message: 'Withdrawal is already ' + withdrawal.status });
      }

      const wallet = (await db('wallets?user_id=eq.' + encodeURIComponent(withdrawal.user_id) + '&select=*'))[0];
      if (!wallet) return json(res, 500, { ok: false, message: 'Wallet not found' });
      const amount = Number(withdrawal.amount);
      const balance = Number(wallet.balance || 0);
      const pending = Number(wallet.pending || 0);
      const paid = Number(wallet.paid || 0);

      let walletUpdated;
      let rollbackFilters;
      let rollbackValues;
      if (next === 'approved') {
        walletUpdated = await patchWallet(withdrawal.user_id, [['pending', pending]], {
          pending: Math.max(0, pending - amount), paid: paid + amount
        });
        rollbackFilters = [['pending', Math.max(0, pending - amount)], ['paid', paid + amount]];
        rollbackValues = { pending, paid };
      } else {
        walletUpdated = await patchWallet(withdrawal.user_id, [['balance', balance], ['pending', pending]], {
          balance: balance + amount, pending: Math.max(0, pending - amount)
        });
        rollbackFilters = [['balance', balance + amount], ['pending', Math.max(0, pending - amount)]];
        rollbackValues = { balance, pending };
      }
      if (!walletUpdated.length) {
        return json(res, 409, { ok: false, message: 'Wallet changed. Refresh and try again.' });
      }

      try {
        const updated = (await db('withdrawals?id=eq.' + encodeURIComponent(id) + '&status=eq.pending', {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            status: next,
            admin_note: next === 'approved' ? ('Manual payment reference: ' + paymentRef) : (next === 'rejected' ? 'Withdrawal rejected by admin' : 'Withdrawal cancelled by admin'),
            processed_at: new Date().toISOString()
          })
        }))[0];
        if (!updated) throw new Error('Withdrawal was changed by another request');

        if (next === 'approved') {
          await notifyUser(withdrawal.user_id, 'Withdrawal paid',
            'Your TrackNest withdrawal of $' + amount.toFixed(2) + ' has been paid manually. Reference: ' + paymentRef);
        } else if (next === 'rejected') {
          await notifyUser(withdrawal.user_id, 'Withdrawal rejected',
            'Your TrackNest withdrawal of $' + amount.toFixed(2) + ' was rejected and returned to your balance.');
        } else {
          await notifyUser(withdrawal.user_id, 'Withdrawal cancelled',
            'Your TrackNest withdrawal of $' + amount.toFixed(2) + ' was cancelled.');
        }
        return json(res, 200, { ok: true, withdrawal: normalizeWithdrawal(updated) });
      } catch (error) {
        await patchWallet(withdrawal.user_id, rollbackFilters, rollbackValues).catch(() => {});
        throw error;
      }
    }

    return json(res, 400, { ok: false, message: 'Unknown action' });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || 'Server error' });
  }
}
