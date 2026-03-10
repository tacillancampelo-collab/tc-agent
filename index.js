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
  const prompt = 'Analise: "' + mensagem + '". Responda APENAS JSON: {"e_tarefa":bool,"tipo":"cadastrar_empresa|admitir_funcionario|demitir_funcionario|lancar_fe​​​​​​​​​​​​​​​​
