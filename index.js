require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
const express = require('express');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
app.use(express.json());

console.log('TC Agent iniciando...');

app.get('/', (req, res) => res.json({ status: 'TC Agent rodando 24h', version: '1.0.0' }));

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

async function processarComando(mensagem, cliente_id) {
  let contextoCliente = '';
  if (cliente_id) {
    const { data } = await supabase.from('clientes').select('*').eq('id', cliente_id).single();
    if (data) contextoCliente = 'Cliente: ' + data.nome + ', CNPJ: ' + data.cnpj;
  }
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: 'Voce e o agente autonomo da TC Advisory. ' + contextoCliente,
    messages: [{ role: 'user', content: mensagem }]
  });
  return response.content[0].text;
}

async function enviarWhatsApp(numero, mensagem) {
  await axios.post('https://graph.facebook.com/v18.0/' + process.env.WHATSAPP_PHONE_ID + '/messages', {
    messaging_product: 'whatsapp', to: numero, type: 'text', text: { body: mensagem }
  }, { headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN } });
}

async function registrarEvento(tipo, descricao) {
  await supabase.from('system_events').insert({ tipo, descricao, status: 'CONCLUIDO', criado_em: new Date().toISOString() });
}

cron.schedule('0 8 * * *', async () => {
  const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const { data: contas } = await supabase.from('contas_pagar').select('*').lte('data_vencimento', amanha).eq('status', 'pendente');
  if (contas) for (const c of contas) await registrarEvento('ALERTA_VENCIMENTO', 'Vencendo: ' + c.descricao + ' R$ ' + c.valor);
}, { timezone: 'America/Fortaleza' });

cron.schedule('0 9 * * 1', async () => {
  await registrarEvento('RELATORIO_SEMANAL', 'Relatorio semanal gerado automaticamente');
}, { timezone: 'America/Fortaleza' });

cron.schedule('0 7 1 * *', async () => {
  await registrarEvento('RELATORIO_MENSAL', 'Relatorio mensal gerado automaticamente');
}, { timezone: 'America/Fortaleza' });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('TC Agent rodando na porta ' + PORT);
  registrarEvento('SISTEMA', 'TC Agent iniciado com sucesso');
});
