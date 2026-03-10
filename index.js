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
const TACILLA_NUMERO = process.env.TACILLA_NUMERO || '5585986128928';
const ADMIN_TOKEN = 'tcadvisory2026-claude-admin';

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

function isCEO(numero) {
  return numero === TACILLA_NUMERO || numero === '5585986128928';
}

function isAdminToken(token) {
  return token === ADMIN_TOKEN;
}

async function buscarClientes() {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/clientes?select=nome,telefone,plano,ativo&order=nome', {
      headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'apikey': SUPABASE_ANON_KEY }
    });
    return await res.json();
  } catch (e) { return []; }
}

async function processarComandoCEO(texto, de) {
  const up = texto.toUpperCase().trim();

  if (up === 'PENDENTES' || up === '/PENDENTES') {
    const l = listarPendentes();
    if (l.length === 0) return await enviarWhatsApp(de, '✅ Nenhuma pendência no momento.');
    const msg = '📋 *Pendências:*\n\n' + l.map((p, i) => `${i+1}. ${p.descricao}\nID: ${p.id}\n✅ SIM ${p.id}  ❌ NAO ${p.id}`).join('\n\n');
    return await enviarWhatsApp(de, msg);
  }

  if (up === 'STATUS' || up === '/STATUS') {
    const clientes = await buscarClientes();
    const ativos = clientes.filter(c => c.ativo).length;
    const pendentes = listarPendentes().length;
    const msg = `📊 *Status TC Advisory*\n\n👥 Clientes ativos: ${ativos}\n⏳ Pendências: ${pendentes}\n🤖 Agente: Online ✅\n🕐 ${new Date().toLocaleString('pt-BR', {timeZone:'America/Fortaleza'})}`;
    return await enviarWhatsApp(de, msg);
  }

  if (up === 'CLIENTES' || up === '/CLIENTES') {
    const clientes = await buscarClientes();
    if (clientes.length === 0) return await enviarWhatsApp(de, 'Nenhum cliente encontrado.');
    const msg = '👥 *Clientes cadastrados:*\n\n' + clientes.map((c, i) => `${i+1}. ${c.nome} — ${c.plano || 'sem plano'}`).join('\n');
    return await enviarWhatsApp(de, msg);
  }

  if (up === 'AJUDA' || up === '/AJUDA' || up === 'MENU' || up === '/MENU') {
    const msg = `🤖 *Comandos CEO:*\n\n📋 *pendentes* — aprovações pendentes\n📊 *status* — resumo do escritório\n👥 *clientes* — listar clientes\n✅ *SIM [ID]* — aprovar\n❌ *NAO [ID]* — rejeitar\n\n💬 Ou me diga o que quer fazer!`;
    return await enviarWhatsApp(de, msg);
  }

  const mSim = up.match(/^(SIM|OK)\s+([A-Z0-9]{6})$/);
  if (mSim) return await enviarWhatsApp(de, aprovar(mSim[2]).msg);

  const mNao = up.match(/^(NAO|NÃO)\s+([A-Z0-9]{6})$/);
  if (mNao) return await enviarWhatsApp(de, rejeitar(mNao[2]).msg);

  return null;
}

async function interpretarPedido(mensagem) {
  const prompt = 'Analise: "' + mensagem + '". Responda APENAS JSON: {"e_tarefa":bool,"tipo":"cadastrar_empresa|admitir_funcionario|demitir_funcionario|lancar_ferias|fechar_folha|outro","dados":{},"resumo":"","dados_faltando":[]}';
  const r = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
  try { return JSON.parse(r.content[0].text.replace(/```json|```/g, '').trim()); } catch { return { e_tarefa: false }; }
}

async function executarTarefa(tipo, dados, numero) {
  let res;
  if (tipo === 'cadastrar_empresa') res = await makro.cadastrarEmpresa(dados);
  else if (tipo === 'admitir_funcionario') res = await makro.admitirFuncionario(dados);
  else if (tipo === 'demitir_funcionario') res = await makro.demitirFuncionario(dados);
  else if (tipo === 'lancar_ferias') res = await makro.lancarFerias(dados);
  else if (tipo === 'fechar_folha') res = await makro.fecharFolha(dados);
  else res = { sucesso: false, mensagem: 'Tarefa não reconhecida' };
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
    if (!texto) return;

    if (isCEO(de)) {
      const executou = await processarComandoCEO(texto, de);
      if (executou !== null) return;
    }

    const i = await interpretarPedido(texto);
    if (i.e_tarefa && i.tipo !== 'outro') {
      if (i.dados_faltando?.length > 0) {
        await enviarWhatsApp(de, '⚠️ Preciso de: ' + i.dados_faltando.join(', '));
        return;
      }
      if (isCEO(de)) {
        await enviarWhatsApp(de, '⚙️ Executando: ' + i.resumo + '...');
        await executarTarefa(i.tipo, i.dados, de);
        return;
      }
      const p = solicitarAprovacao(i.tipo, i.dados, i.resumo);
      const pend = listarPendentes();
      const id = pend.length > 0 ? pend[pend.length - 1].id : '??????';
      await enviarWhatsApp(TACILLA_NUMERO, '🔔 *Solicitação de cliente:*\n' + i.resumo + '\n\n' + JSON.stringify(i.dados, null, 1) + '\n\n✅ SIM ' + id + '  ❌ NAO ' + id);
      await enviarWhatsApp(de, '📨 Aguardando aprovação.');
      p.then(() => executarTarefa(i.tipo, i.dados, de)).catch(() => enviarWhatsApp(de, '❌ Não aprovado.'));
    } else {
      const r = await fetch(SUPABASE_URL + '/functions/v1/helena-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
        body: JSON.stringify({ message: texto, from: de, is_admin: isCEO(de) })
      });
      const d = await r.json().catch(() => ({}));
      if (d.reply) await enviarWhatsApp(de, d.reply);
    }
  } catch (e) { console.error('[WA]', e.message); }
});

// ─── ROTAS ADMIN — ACESSO DIRETO DA IA ────────────────────────────────────────
app.post('/admin/executar', async (req, res) => {
  const { token, acao, dados } = req.body;
  if (!isAdminToken(token)) return res.status(403).json({ erro: 'Token inválido' });
  try {
    if (acao === 'status') {
      const clientes = await buscarClientes();
      return res.json({ clientes_ativos: clientes.filter(c=>c.ativo).length, pendentes: listarPendentes().length, timestamp: new Date().toISOString() });
    }
    if (acao === 'listar_clientes') {
      const clientes = await buscarClientes();
      return res.json({ clientes });
    }
    if (acao === 'listar_pendentes') {
      return res.json({ pendentes: listarPendentes() });
    }
    if (acao === 'aprovar') {
      return res.json(aprovar(dados.id));
    }
    if (acao === 'rejeitar') {
      return res.json(rejeitar(dados.id));
    }
    if (acao === 'executar_tarefa') {
      const result = await executarTarefa(dados.tipo, dados.dados, TACILLA_NUMERO);
      return res.json(result);
    }
    if (acao === 'enviar_whatsapp') {
      await enviarWhatsApp(dados.para || TACILLA_NUMERO, dados.mensagem);
      return res.json({ ok: true });
    }
    return res.status(400).json({ erro: 'Ação não reconhecida' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
});

// ─── ROTAS PADRÃO ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'TC Agent rodando 24h', version: '4.1.0', makrosystem: 'ATIVO', admin_api: 'ATIVA', timestamp: new Date().toISOString() }));
app.get('/pendentes', (req, res) => res.json(listarPendentes()));
app.post('/aprovar/:id', (req, res) => res.json(aprovar(req.params.id)));
app.post('/rejeitar/:id', (req, res) => res.json(rejeitar(req.params.id)));

cron.schedule('0 8 * * *', () => fetch(SUPABASE_URL + '/functions/v1/pending-reminders', { method: 'POST', headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }).catch(console.error));
cron.schedule('0 9 * * 1', () => fetch(SUPABASE_URL + '/functions/v1/send-reports', { method: 'POST', headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }).catch(console.error));
cron.schedule('0 7 1 * *', () => fetch(SUPABASE_URL + '/functions/v1/daily-summary', { method: 'POST', headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }).catch(console.error));

app.listen(process.env.PORT || 3000, () => console.log('🚀 TC Agent v4.1 | CEO Commands + Admin API ATIVA'));
