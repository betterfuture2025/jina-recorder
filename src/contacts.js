// 원아·학부모 명단과, 녹음에 상대방 연결하기 (파트 3)
import { json, uid, readJson, HttpError, EMAIL_RE } from './util.js';

const KINDS = ['child', 'parent', 'staff', 'customer', 'other'];

function pick(body, cur = {}) {
  const s = (v, n) => (v === undefined ? undefined : (String(v ?? '').trim().slice(0, n) || null));
  const out = {
    kind: body.kind === undefined ? cur.kind : (KINDS.includes(body.kind) ? body.kind : 'other'),
    name: s(body.name, 60) ?? cur.name,
    relation: s(body.relation, 30) !== undefined ? s(body.relation, 30) : cur.relation,
    phone: s(body.phone, 30) !== undefined ? s(body.phone, 30) : cur.phone,
    email: s(body.email, 120) !== undefined ? s(body.email, 120) : cur.email,
    note: s(body.note, 500) !== undefined ? s(body.note, 500) : cur.note,
    related_child_id: body.related_child_id === undefined ? cur.related_child_id : (body.related_child_id || null),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) out[k] = null;
  if (!out.name) throw new HttpError(400, 'name_required', '이름을 넣어 주세요.');
  if (out.email && !EMAIL_RE.test(out.email)) throw new HttpError(400, 'bad_email', '이메일 형식을 확인해 주세요.');
  if (out.phone && !/^[0-9+()\-.\s]{6,30}$/.test(out.phone)) throw new HttpError(400, 'bad_phone', '전화번호를 확인해 주세요.');
  return out;
}

export async function listContacts(env, request) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 40);
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.kind, c.name, c.relation, c.phone, c.email, c.note, c.related_child_id, k.name AS child_name,
            (SELECT COUNT(*) FROM participants p WHERE p.contact_id = c.id) AS record_count,
            (SELECT MAX(r.started_at) FROM participants p JOIN recordings r ON r.id = p.recording_id WHERE p.contact_id = c.id) AS last_at
       FROM contacts c LEFT JOIN contacts k ON k.id = c.related_child_id
      ${q ? "WHERE c.name LIKE ? ESCAPE '\\' OR k.name LIKE ? ESCAPE '\\'" : ''}
      ORDER BY CASE c.kind WHEN 'child' THEN 0 WHEN 'parent' THEN 1 ELSE 2 END, c.name LIMIT 300`
  ).bind(...(q ? [like, like] : [])).all();
  return json({ contacts: results });
}

export async function createContact(env, request, me) {
  const c = pick(await readJson(request));
  const id = uid();
  await env.DB.prepare(
    `INSERT INTO contacts (id, kind, name, relation, phone, email, note, related_child_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, c.kind || 'other', c.name, c.relation, c.phone, c.email, c.note, c.related_child_id, me.id).run();
  return json({ contact: { id, ...c } }, 201);
}

async function loadContact(env, id) {
  const c = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  if (!c) throw new HttpError(404, 'not_found', '명단에서 찾을 수 없어요.');
  return c;
}

export async function updateContact(env, request, me, id) {
  const cur = await loadContact(env, id);
  if (me.role !== 'admin' && cur.created_by !== me.id) throw new HttpError(403, 'forbidden', '관리자나 등록한 사람만 고칠 수 있어요.');
  const c = pick(await readJson(request), cur);
  if (c.related_child_id === id) c.related_child_id = null;
  await env.DB.prepare(
    `UPDATE contacts SET kind = ?, name = ?, relation = ?, phone = ?, email = ?, note = ?, related_child_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(c.kind, c.name, c.relation, c.phone, c.email, c.note, c.related_child_id, id).run();
  return json({ contact: { id, ...c } });
}

export async function deleteContact(env, me, id) {
  const cur = await loadContact(env, id);
  if (me.role !== 'admin' && cur.created_by !== me.id) throw new HttpError(403, 'forbidden', '관리자나 등록한 사람만 지울 수 있어요.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM participants WHERE contact_id = ?').bind(id),
    env.DB.prepare('UPDATE contacts SET related_child_id = NULL WHERE related_child_id = ?').bind(id),
    env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

export async function peopleFor(env, recId) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.kind, c.name, c.relation, p.role FROM participants p JOIN contacts c ON c.id = p.contact_id
      WHERE p.recording_id = ? ORDER BY c.name`
  ).bind(recId).all();
  return results;
}

// 녹음의 상대방을 통째로 바꾼다 (사람이 고른 것)
export async function setPeople(env, request, user, recId) {
  const rec = await env.DB.prepare('SELECT owner_id FROM recordings WHERE id = ?').bind(recId).first();
  if (!rec || (rec.owner_id !== user.id && user.role !== 'admin')) throw new HttpError(404, 'not_found', '기록을 찾을 수 없어요.');
  const body = await readJson(request);
  const ids = [...new Set((Array.isArray(body.contactIds) ? body.contactIds : []).map(String))].slice(0, 10);
  const stmts = [env.DB.prepare('DELETE FROM participants WHERE recording_id = ? AND contact_id IS NOT NULL').bind(recId)];
  for (const cid of ids) {
    stmts.push(env.DB.prepare(
      `INSERT INTO participants (id, recording_id, contact_id, role) SELECT ?, ?, id, 'user' FROM contacts WHERE id = ?`
    ).bind(uid(), recId, cid));
  }
  await env.DB.batch(stmts);
  return json({ people: await peopleFor(env, recId) });
}
