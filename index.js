const express = require('express');
const cron = require('node-cron');
const { Anthropic } = require('@anthropic-ai/sdk');
const makro = require('./makrosystem');
const { solicitarAprovacao, aprovar, rejeitar, listarPendentes } = require('./aprovacoes');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TACILLA_NUMERO = process.env.TACILLA_NUMERO || '558591627988';

async function enviarWhatsApp(para, mensagem) {
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/whatsapp-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ to: para, message: mensagem })
    });
    return await res.json();
  } catch (err) { console.error('[WA] Erro:', err.message); }
}

async function interpretarPedido(mensagem) {
  const prompt = 'Analise: "' + mensagem + '". Responda APENAS JSON: {"e_tarefa":bool,"tipo":"cadastrar_empresa|admitir_funcionario|demitir_funcionario|lancar_ferias|outro","dados":{},"resumo":"","dados_faltando":[]}';
  const r = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
  try { return JSON.parse(r.content[0].text.replace(/```json|```/g, '').trim()); } catch { return { e_tarefa: false }; }
}

async function executarTarefa(tipo, dados, numero) {
  let res;
  if (tipo === 'cadastrar_empresa') res = await makro.cadastrarEmpresa(dados);
  else if (tipo === 'admitir_funcionario') res = await makro.admitirFuncionario(dados);
  else if (tipo === 'demitir_funcionario') res = await makro.demitirFuncionario(dados);
  else if (tipo === 'lancar_ferias') res = await makro.lancarFerias(dados);
  else res = { sucesso: false, mensagem: 'Tarefa nao reconhecida' };
  await enviarWhatsApp(numero, res.mensagem);
  return res;
}

app.get('/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': t, 'hub.challenge': c } = req.query;
  (mode === 'subscribe' && t === 'tcadvisory2026') ? res.status(200).send(c) : res.sendStatus(403);
});

app.post('/whatsapp', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;
    const de = msg.from;
    const texto = msg.text?.body?.trim() || '';
    const up = texto.toUpperCase();
    const mSim = up.match(/^(SIM|OK)\s+([A-Z0-9]{6})$/);
    const mNao = up.match(/^(NAO|NÃO)\s+([A-Z0-9]{6})$/);
    if (mSim && de === TACILLA_NUMERO) { await enviarWhatsApp(de, aprovar(mSim[2]).msg); return; }
    if (mNao && de === TACILLA_NUMERO) { await enviarWhatsApp(de, rejeitar(mNao[2]).msg); return; }
    if (up === 'PENDENTES' && de === TACILLA_NUMERO) {
      const l = listarPendentes();
      await enviarWhatsApp(de, l.length === 0 ? 'Nenhuma pendente.' : l.map(p => p.id + ': ' + p.descricao).join('\n'));
      return;
    }
    const i = await interpretarPedido(texto);
    if (i.e_tarefa && i.tipo !== 'outro') {
      if (i.dados_faltando?.length > 0) { await enviarWhatsApp(de, 'Preciso de: ' + i.dados_faltando.join(', ')); return; }
      const p = solicitarAprovacao(i.tipo, i.dados, i.resumo);
      const pend = listarPendentes();
      const id = pend.length > 0 ? pend[pend.length - 1].id : '??????';
      await enviarWhatsApp(TACILLA_NUMERO, '🔔 *Nova tarefa:* ' + i.resumo + '\n\n' + JSON.stringify(i.dados, null, 1) + '\n\n✅ SIM ' + id + '  ❌ NAO ' + id);
      if (de !== TACILLA_NUMERO) await enviarWhatsApp(de, '📨 Aguardando aprovacao!');
      p.then(() => executarTarefa(i.tipo, i.dados, de)).catch(() => { if (de !== TACILLA_NUMERO) enviarWhatsApp(de, 'Nao aprovado.'); });
    } else {
      const r = await fetch(SUPABASE_URL + '/functions/v1/helena-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }, body: JSON.stringify({ message: texto, from: de }) });
      const d = await r.json().catch(() => ({}));
      if (d.reply) await enviarWhatsApp(de, d.reply);
    }
  } catch (e) { console.error('[WA]', e.message); }
});

app.get('/', (req, res) => res.json({ status: 'TC Agent rodando 24h', version: '3.0.0', makrosystem: 'ATIVO', timestamp: new Date().toISOString() }));
app.get('/pendentes', (req, res) => res.json(listarPendentes()));
app.post('/aprovar/:id', (req, res) => res.json(aprovar(req.params.id)));
app.post('/rejeitar/:id', (req, res) => res.json(rejeitar(req.params.id)));

cron.schedule('0 8 * * *', () => fetch(SUPABASE_URL + '/functions/v1/pending-reminders', { method: 'POST', headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }).catch(console.error));
cron.schedule('0 9 * * 1', () => fetch(SUPABASE_URL + '/functions/v1/send-reports', { method: 'POST', headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }).catch(console.error));
cron.schedule('0 7 1 * *', () => fetch(SUPABASE_URL + '/functions/v1/daily-summary', { method: 'POST', headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }).catch(console.error));

app.listen(process.env.PORT || 3000, () => console.log('🚀 TC Agent v3.0 | Makrosystem ATIVO'));
