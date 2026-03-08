const pendentes = new Map();
function gerarId() { return Math.random().toString(36).substring(2,8).toUpperCase(); }

function solicitarAprovacao(tarefa, dados, descricao) {
  return new Promise((resolve, reject) => {
    const id = gerarId();
    pendentes.set(id, { tarefa, dados, descricao, resolve, reject, timestamp: Date.now() });
    setTimeout(() => { if (pendentes.has(id)) { pendentes.delete(id); reject(new Error('Expirado')); } }, 30*60*1000);
    console.log('[Aprovacao] Criada:', id, descricao);
  });
}

function aprovar(id) {
  const item = pendentes.get(id);
  if (!item) return { ok: false, msg: 'Nao encontrada ou expirada' };
  pendentes.delete(id);
  item.resolve({ aprovado: true, id });
  return { ok: true, msg: '✅ Aprovado! Executando: ' + item.descricao };
}

function rejeitar(id) {
  const item = pendentes.get(id);
  if (!item) return { ok: false, msg: 'Nao encontrada ou expirada' };
  pendentes.delete(id);
  item.reject(new Error('Rejeitado'));
  return { ok: true, msg: '❌ Rejeitado: ' + item.descricao };
}

function listarPendentes() {
  const lista = [];
  for (const [id, item] of pendentes) {
    lista.push({ id, descricao: item.descricao, tarefa: item.tarefa, aguardandoHa: Math.round((Date.now()-item.timestamp)/60000) + ' min' });
  }
  return lista;
}

module.exports = { solicitarAprovacao, aprovar, rejeitar, listarPendentes };
