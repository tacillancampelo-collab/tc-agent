require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
const express = require('express');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EDGE_BASE = SUPABASE_URL + '/functions/v1';

console.log('TC Agent v2.0 iniciando...');

app.get('/', (req, res) => {
  res.json({ status: 'TC Agent rodando 24h', version: '2.0.0', timestamp: new Date().toISOString() });
});

app.post('/comando', async (req, res) => {
  const { mensagem, cliente_id, whatsapp } = req.body;
  try {
    const resposta = await processarComando(mensagem, cliente_id);
    if (whatsapp) await enviarWhatsApp(whatsapp, resposta);
    res.json({ sucesso: true, resposta });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/whatsapp', async (req, res) => {
  try {
    const response = await chamarEdgeFunction('whatsapp-webhook', req.body);
    res.json(response);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

async function processarComando(mensagem, cliente_id) {
  let contextoCliente = '';
  if (cliente_id) {
    try {
      const { data } = await supabaseQuery('clientes', 'id=eq.' + cliente_id + '&select=nome,cnpj');
      if (data && data[0]) contextoCliente = 'Cliente: ' + data[0].nome + ', CNPJ: ' + data[0].cnpj;
    } catch (e) {}
  }
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: 'Voce e o agente autonomo da TC Advisory, escritorio de contabilidade e BPO financeiro premium. Responda em portugues. ' + contextoCliente,
    messages: [{ role: 'user', content: mensagem }]
  });
  return response.content[0].text;
}

async function chamarEdgeFunction(nome, payload) {
  const response = await axios.post(EDGE_BASE + '/' + nome, payload, {
    headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }
  });
  return response.data;
}

async function supabaseQuery(tabela, query) {
  const response = await axios.get(SUPABASE_URL + '/rest/v1/' + tabela + '?' + query, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
  });
  return { data: response.data };
}

async function registrarEvento(tipo, descricao) {
  try {
    await chamarEdgeFunction('lena-run', { tipo_evento: tipo, descricao, origem: 'tc-agent-railway' });
  } catch (e) {
    console.log('[EVENTO] ' + tipo + ': ' + descricao);
  }
}

async function enviarWhatsApp(numero, mensagem) {
  try {
    await chamarEdgeFunction('whatsapp-send', { to: numero, message: mensagem });
  } catch (e) {
    if (process.env.WHATSAPP_TOKEN) {
      await axios.post('https://graph.facebook.com/v18.0/' + process.env.WHATSAPP_PHONE_ID + '/messages',
        { messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: mensagem } },
        { headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN } });
    }
  }
}

cron.schedule('0 8 * * *', async () => {
  try {
    const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const { data } = await supabaseQuery('contas_pagar', 'data_vencimento=lte.' + amanha + '&status=eq.pendente');
    if (data && data.length > 0) {
      for (const c of data) await registrarEvento('ALERTA_VENCIMENTO', 'Vencendo: ' + c.descricao + ' R$ ' + c.valor);
    }
  } catch (e) { console.error('[CRON] Erro:', e.message); }
}, { timezone: 'America/Fortaleza' });

cron.schedule('0 9 * * 1', async () => {
  try { await chamarEdgeFunction('send-reports', { tipo: 'semanal' }); } catch (e) {}
}, { timezone: 'America/Fortaleza' });

cron.schedule('0 7 1 * *', async () => {
  try { await chamarEdgeFunction('send-reports', { tipo: 'mensal' }); } catch (e) {}
}, { timezone: 'America/Fortaleza' });

cron.schedule('0 9 * * *', async () => {
  try { await chamarEdgeFunction('pending-reminders', {}); } catch (e) {}
}, { timezone: 'America/Fortaleza' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('TC Agent rodando na porta ' + PORT);
  await registrarEvento('SISTEMA', 'TC Agent v2.0 iniciado no Railway');
});
