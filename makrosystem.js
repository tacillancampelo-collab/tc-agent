const { chromium } = require('playwright');
const MAKRO_URL = 'https://app.makrosystem.com.br';
const MAKRO_USER = process.env.MAKROSYSTEM_USER || 'TACILLA';
const MAKRO_PASS = process.env.MAKROSYSTEM_PASS;

let browser = null;
let page = null;

async function conectar() {
  if (page) return page;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();
  await page.goto(MAKRO_URL, { waitUntil: 'networkidle', timeout: 30000 });
  const needsLogin = await page.isVisible('input[type="password"]').catch(() => false);
  if (needsLogin) {
    await page.fill('input[name="usuario"], input[placeholder*="usu"]', MAKRO_USER);
    await page.fill('input[type="password"]', MAKRO_PASS);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  }
  console.log('[Makro] Conectado');
  return page;
}

async function desconectar() {
  if (browser) { await browser.close().catch(() => {}); browser = null; page = null; }
}

async function cadastrarEmpresa(dados) {
  try {
    const pg = await conectar();
    await pg.goto(MAKRO_URL + '/empresas/novo', { waitUntil: 'networkidle' });
    await pg.fill('[name="razao_social"], [placeholder*="Raz"]', dados.razaoSocial || '');
    await pg.fill('[name="cnpj"], [placeholder*="CNPJ"]', dados.cnpj || '');
    if (dados.email) await pg.fill('[name="email"]', dados.email);
    if (dados.telefone) await pg.fill('[name="telefone"]', dados.telefone);
    if (dados.cep) { await pg.fill('[name="cep"]', dados.cep); await pg.waitForTimeout(1500); }
    await pg.click('button[type="submit"], button:has-text("Salvar")');
    await pg.waitForTimeout(2000);
    return { sucesso: true, mensagem: '✅ Empresa ' + dados.razaoSocial + ' cadastrada no Makrosystem!' };
  } catch (e) { return { sucesso: false, mensagem: '❌ Erro ao cadastrar empresa: ' + e.message }; }
}

async function admitirFuncionario(dados) {
  try {
    const pg = await conectar();
    await pg.click('text=Pessoal').catch(() => pg.goto(MAKRO_URL + '/pessoal'));
    await pg.waitForTimeout(1000);
    await pg.click('text=Admiss').catch(() => {});
    await pg.waitForTimeout(1000);
    await pg.click('button:has-text("Novo"), button:has-text("Nova")').catch(() => {});
    await pg.waitForTimeout(800);
    await pg.fill('[name="nome"], [placeholder*="Nome"]', dados.nome || '');
    await pg.fill('[name="cpf"], [placeholder*="CPF"]', dados.cpf || '');
    await pg.fill('[name="data_admissao"]', dados.dataAdmissao || '');
    if (dados.salario) await pg.fill('[name="salario"]', String(dados.salario));
    if (dados.cargo) await pg.fill('[name="cargo"]', dados.cargo);
    await pg.click('button[type="submit"], button:has-text("Salvar")');
    await pg.waitForTimeout(2000);
    return { sucesso: true, mensagem: '✅ Funcionario ' + dados.nome + ' admitido em ' + (dados.empresa || 'empresa') + '!' };
  } catch (e) { return { sucesso: false, mensagem: '❌ Erro na admissao: ' + e.message }; }
}

async function demitirFuncionario(dados) {
  try {
    const pg = await conectar();
    await pg.click('text=Pessoal').catch(() => pg.goto(MAKRO_URL + '/pessoal'));
    await pg.waitForTimeout(1000);
    await pg.click('text=Rescis, text=Demiss').catch(() => {});
    await pg.waitForTimeout(1000);
    await pg.fill('[placeholder*="Funcion"]', dados.nome || dados.cpf || '');
    await pg.waitForTimeout(1000);
    await pg.click('text=' + dados.nome).catch(() => {});
    await pg.fill('[name="data_demissao"]', dados.dataDemissao || '');
    await pg.click('button[type="submit"], button:has-text("Salvar")');
    await pg.waitForTimeout(2000);
    return { sucesso: true, mensagem: '✅ Rescisao de ' + dados.nome + ' registrada!' };
  } catch (e) { return { sucesso: false, mensagem: '❌ Erro na demissao: ' + e.message }; }
}

async function lancarFerias(dados) {
  try {
    const pg = await conectar();
    await pg.click('text=Pessoal').catch(() => pg.goto(MAKRO_URL + '/pessoal'));
    await pg.waitForTimeout(1000);
    await pg.click('text=Ferias, text=Férias').catch(() => {});
    await pg.waitForTimeout(1000);
    await pg.click('button:has-text("Nova"), button:has-text("Novo")').catch(() => {});
    await pg.fill('[placeholder*="Funcion"]', dados.nome || '');
    await pg.waitForTimeout(1000);
    await pg.click('text=' + dados.nome).catch(() => {});
    await pg.fill('[name="data_inicio"]', dados.dataInicio || '');
    await pg.fill('[name="data_fim"]', dados.dataFim || '');
    if (dados.diasAbono) await pg.fill('[name="dias_abono"]', String(dados.diasAbono));
    await pg.click('button[type="submit"], button:has-text("Salvar")');
    await pg.waitForTimeout(2000);
    return { sucesso: true, mensagem: '✅ Ferias de ' + dados.nome + ' lancadas: ' + dados.dataInicio + ' ate ' + dados.dataFim };
  } catch (e) { return { sucesso: false, mensagem: '❌ Erro ao lancar ferias: ' + e.message }; }
}

module.exports = { cadastrarEmpresa, admitirFuncionario, demitirFuncionario, lancarFerias, desconectar };
