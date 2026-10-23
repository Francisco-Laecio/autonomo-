'use strict';
/* Autonomo+ — versão demonstrativa com localStorage (NÃO use em produção). */

const KEYS = { users: 'autonomo_users', session: 'autonomo_session', tx: 'autonomo_tx', hide: 'autonomo_hide_' };
const CATS = {
  in: ['Serviços prestados', 'Vendas', 'Freelances', 'Comissões', 'Outros recebimentos'],
  out: ['Despesas pessoais', 'Alimentação', 'Transporte', 'Materiais de trabalho', 'Contas e pagamentos', 'Outros gastos']
};
const $ = id => document.getElementById(id);
let user = null;      // usuário logado
let txType = 'in';    // tipo do modal aberto
let pendingDelete = null;

/* ---------- Utilitários ---------- */
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = iso => iso.split('-').reverse().join('/');
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/** Converte "1.234,56" em centavos (inteiro). Retorna NaN se inválido. */
function parseMoney(str) {
  const s = str.trim().replace(/^R\$\s*/, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

async function hashPass(pass, salt) {
  if (!window.crypto || !crypto.subtle) throw new Error('Navegador sem suporte a criptografia.');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pass));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Dados ---------- */
const getUsers = () => load(KEYS.users, []);
const allTx = () => load(KEYS.tx, []);
const myTx = () => allTx().filter(t => t.userId === user.id);
const calcBalance = list => list.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);

/* ---------- Autenticação ---------- */
function showForm(id) {
  ['loginForm', 'registerForm', 'forgotForm'].forEach(f => {
    $(f).classList.toggle('hidden', f !== id);
    $(f).querySelector('.form-error').textContent = '';
  });
}
const formError = (form, msg) => { form.querySelector('.form-error').textContent = msg; };

document.querySelectorAll('[data-show]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showForm(a.dataset.show); }));
document.querySelectorAll('.toggle-pass').forEach(b => b.addEventListener('click', () => {
  const i = $(b.dataset.target); i.type = i.type === 'password' ? 'text' : 'password';
}));

$('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, name = $('regName').value.trim(), email = $('regEmail').value.trim().toLowerCase();
  const p1 = $('regPass').value, p2 = $('regPass2').value;
  if (!name || !email || !p1 || !p2) return formError(f, 'Preencha todos os campos.');
  if (!validEmail(email)) return formError(f, 'Informe um e-mail válido.');
  if (p1.length < 6) return formError(f, 'A senha deve ter ao menos 6 caracteres.');
  if (p1 !== p2) return formError(f, 'As senhas não conferem.');
  const users = getUsers();
  if (users.some(u => u.email === email)) return formError(f, 'Este e-mail já está cadastrado.');
  try {
    const salt = uid();
    const novo = { id: uid(), name, email, salt, hash: await hashPass(p1, salt) };
    users.push(novo); save(KEYS.users, users);
    // Exemplos para demonstrar a interface (podem ser excluídos)
    const hoje = new Date(), ontem = new Date(Date.now() - 864e5), at = Date.now();
    const ex = [
      ['in', 50000, 'Serviço de manutenção', 'Serviços prestados', isoDate(hoje)],
      ['out', 12000, 'Compra de materiais', 'Materiais de trabalho', isoDate(hoje)],
      ['in', 30000, 'Serviço particular', 'Serviços prestados', isoDate(ontem)]
    ].map((x, i) => ({ id: uid(), userId: novo.id, type: x[0], amount: x[1], desc: x[2], cat: x[3], date: x[4], at: at + i }));
    save(KEYS.tx, allTx().concat(ex));
    e.target.reset(); showForm('loginForm'); toast('Conta criada! Faça login.');
  } catch (err) { formError(f, err.message); }
});

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, email = $('loginEmail').value.trim().toLowerCase(), pass = $('loginPass').value;
  if (!email || !pass) return formError(f, 'Informe e-mail e senha.');
  if (!validEmail(email)) return formError(f, 'Informe um e-mail válido.');
  try {
    const u = getUsers().find(x => x.email === email);
    if (!u || u.hash !== await hashPass(pass, u.salt)) return formError(f, 'E-mail ou senha incorretos.');
    localStorage.setItem(KEYS.session, u.id);
    f.reset(); enterApp(u);
  } catch (err) { formError(f, err.message); }
});

$('forgotForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, email = $('fgEmail').value.trim().toLowerCase(), p1 = $('fgPass').value, p2 = $('fgPass2').value;
  if (!email || !p1 || !p2) return formError(f, 'Preencha todos os campos.');
  if (!validEmail(email)) return formError(f, 'Informe um e-mail válido.');
  if (p1.length < 6) return formError(f, 'A senha deve ter ao menos 6 caracteres.');
  if (p1 !== p2) return formError(f, 'As senhas não conferem.');
  const users = getUsers(), u = users.find(x => x.email === email);
  if (!u) return formError(f, 'E-mail não encontrado.');
  try {
    u.salt = uid(); u.hash = await hashPass(p1, u.salt); save(KEYS.users, users);
    f.reset(); showForm('loginForm'); toast('Senha redefinida com sucesso!');
  } catch (err) { formError(f, err.message); }
});

$('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem(KEYS.session); user = null;
  $('appView').classList.add('hidden'); $('authView').classList.remove('hidden'); showForm('loginForm');
});

function enterApp(u) {
  user = u;
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden');
  $('greeting').textContent = `Olá, ${u.name.split(' ')[0]}!`;
  $('avatar').textContent = u.name.charAt(0).toUpperCase();
  $('todayLabel').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  clearFilters(true);
}

/* ---------- Filtros ---------- */
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  return [`${ym}-01`, isoDate(new Date(y, m, 0))];
}
function clearFilters(currentMonth) {
  $('fSearch').value = ''; $('fType').value = ''; $('fFrom').value = ''; $('fTo').value = ''; $('fMonth').value = '';
  if (currentMonth === true) {
    const d = new Date(); $('fMonth').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    [$('fFrom').value, $('fTo').value] = monthRange($('fMonth').value);
  }
  render();
}
$('fMonth').addEventListener('change', () => {
  if ($('fMonth').value) [$('fFrom').value, $('fTo').value] = monthRange($('fMonth').value);
  else { $('fFrom').value = ''; $('fTo').value = ''; }
  render();
});
['fFrom', 'fTo'].forEach(id => $(id).addEventListener('change', () => { $('fMonth').value = ''; render(); }));
['fSearch', 'fType'].forEach(id => $(id).addEventListener('input', render));
$('clearBtn').addEventListener('click', () => clearFilters(false));

/* ---------- Renderização ---------- */
function render() {
  if (!user) return;
  const all = myTx();
  const from = $('fFrom').value, to = $('fTo').value, type = $('fType').value, q = $('fSearch').value.trim().toLowerCase();
  const inPeriod = all.filter(t => (!from || t.date >= from) && (!to || t.date <= to));
  const list = inPeriod
    .filter(t => (!type || t.type === type) && (!q || t.desc.toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);

  const balance = calcBalance(all); // saldo SEMPRE calculado das movimentações
  const hidden = load(KEYS.hide + user.id, false);
  $('balanceMain').textContent = hidden ? 'R$ ••••••' : brl(balance);
  $('totalBal').textContent = hidden ? 'R$ ••••••' : brl(balance);
  $('totalIn').textContent = brl(inPeriod.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0));
  $('totalOut').textContent = brl(inPeriod.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0));
  $('periodHint').textContent = (from || to)
    ? `Entradas e saídas do período: ${from ? fmtDate(from) : 'início'} a ${to ? fmtDate(to) : 'hoje'}. O saldo é acumulado.`
    : 'Entradas e saídas de todo o período. O saldo é acumulado.';

  $('emptyState').classList.toggle('hidden', list.length > 0);
  $('tableWrap').style.display = list.length ? '' : 'none';
  $('txBody').innerHTML = list.map(t => `
    <tr><td>${fmtDate(t.date)}</td><td>${esc(t.desc)}</td><td>${esc(t.cat)}</td>
    <td><span class="badge ${t.type}">${t.type === 'in' ? 'Entrada' : 'Saída'}</span></td>
    <td class="num ${t.type === 'in' ? 'v-in' : 'v-out'}">${t.type === 'in' ? '+' : '-'} ${brl(t.amount)}</td>
    <td><button class="del" data-id="${t.id}" aria-label="Excluir ${esc(t.desc)}">🗑</button></td></tr>`).join('');
  $('txCards').innerHTML = list.map(t => `
    <div class="tx-card ${t.type}">
      <div class="row"><strong>${esc(t.desc)}</strong><span class="${t.type === 'in' ? 'v-in' : 'v-out'}"><b>${t.type === 'in' ? '+' : '-'} ${brl(t.amount)}</b></span></div>
      <div class="row"><small>${fmtDate(t.date)} · ${esc(t.cat)}</small><span class="badge ${t.type}">${t.type === 'in' ? 'Entrada' : 'Saída'}</span></div>
      <div class="row"><span></span><button class="del" data-id="${t.id}" aria-label="Excluir ${esc(t.desc)}">🗑 Excluir</button></div>
    </div>`).join('');
}

$('eyeBtn').addEventListener('click', () => {
  save(KEYS.hide + user.id, !load(KEYS.hide + user.id, false)); render();
});

/* ---------- Entradas e retiradas ---------- */
function openTx(type) {
  txType = type;
  $('txTitle').textContent = type === 'in' ? 'Adicionar dinheiro' : 'Retirar dinheiro';
  $('txSubmit').textContent = type === 'in' ? 'Salvar entrada' : 'Confirmar retirada';
  $('txSubmit').className = 'btn ' + (type === 'in' ? 'primary' : 'danger');
  $('txCat').innerHTML = CATS[type].map(c => `<option>${c}</option>`).join('');
  $('txForm').reset(); $('txDate').value = isoDate(new Date());
  $('txForm').querySelector('.form-error').textContent = '';
  $('txModal').showModal(); $('txAmount').focus();
}
$('addBtn').addEventListener('click', () => openTx('in'));
$('withdrawBtn').addEventListener('click', () => openTx('out'));
$('txCancel').addEventListener('click', () => $('txModal').close());

$('txForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, amount = parseMoney($('txAmount').value), desc = $('txDesc').value.trim();
  const cat = $('txCat').value, date = $('txDate').value;
  if (!$('txAmount').value.trim()) return formError(f, 'Informe o valor.');
  if (isNaN(amount)) return formError(f, 'Valor inválido. Use o formato 1.234,56.');
  if (amount <= 0) return formError(f, 'O valor deve ser maior que zero.');
  if (desc.length < 2) return formError(f, 'Informe uma descrição.');
  if (!date || isNaN(new Date(date + 'T00:00:00'))) return formError(f, 'Informe uma data válida.');
  const balance = calcBalance(myTx());
  if (txType === 'out' && amount > balance) return formError(f, `Saldo insuficiente. Disponível: ${brl(balance)}.`);
  save(KEYS.tx, allTx().concat({ id: uid(), userId: user.id, type: txType, amount, desc, cat, date, at: Date.now() }));
  $('txModal').close(); render();
  toast(txType === 'in' ? 'Entrada registrada com sucesso!' : 'Retirada registrada com sucesso!');
});

/* ---------- Exclusão com confirmação ---------- */
function askDelete(e) {
  const btn = e.target.closest('.del'); if (!btn) return;
  const t = myTx().find(x => x.id === btn.dataset.id); if (!t) return;
  pendingDelete = t.id;
  $('confirmText').textContent = `Excluir "${t.desc}" (${brl(t.amount)}, ${fmtDate(t.date)})? Esta ação não pode ser desfeita.`;
  $('confirmModal').showModal();
}
$('txBody').addEventListener('click', askDelete);
$('txCards').addEventListener('click', askDelete);
$('confirmNo').addEventListener('click', () => $('confirmModal').close());
$('confirmYes').addEventListener('click', () => {
  const rest = allTx().filter(t => t.id !== pendingDelete);
  // Impede que a exclusão de uma entrada deixe o saldo negativo
  if (calcBalance(rest.filter(t => t.userId === user.id)) < 0) {
    $('confirmModal').close(); return toast('Não é possível excluir: o saldo ficaria negativo.', true);
  }
  save(KEYS.tx, rest); $('confirmModal').close(); render(); toast('Movimentação excluída.');
});

/* ---------- Início: restaura sessão ---------- */
(function init() {
  const sid = localStorage.getItem(KEYS.session);
  const u = sid && getUsers().find(x => x.id === sid);
  if (u) enterApp(u);
})();
