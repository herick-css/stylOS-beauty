/**
 * rotas/agenda.js
 * ------------------------------------------------------------------
 * Tudo sobre horários e agendamentos:
 *   ADM:     configurar WhatsApp, Google Agenda, expediente e serviços;
 *            ver/confirmar/cancelar pedidos.
 *   PÚBLICO: ver horários livres de uma página e pedir um horário.
 *   CLIENTE: ver e cancelar os próprios pedidos.
 *
 * Nenhum pagamento acontece aqui. O pedido é salvo como "pendente"
 * (bloqueando o horário para outra pessoa) e a cliente recebe um botão
 * que abre o WhatsApp do ADM com todas as informações já escritas.
 */
'use strict';

const { abrirBanco, registrarAuditoria, emTransacao } = require('../banco');
const { configuracao } = require('../configuracao');
const seguranca = require('../seguranca');
const google = require('../servicos/google-agenda');
const horarios = require('../servicos/horarios');
const { ErroHttp, lerCorpoJson, textoLimpo, soDigitos, idValido } = require('../utilitarios');

const ADM_OU_DONO = { papeis: ['adm', 'dono'] };
const STATUS_ATIVOS = ['pendente', 'confirmado'];

// ------------------------------------------------------------------
// Funções auxiliares
// ------------------------------------------------------------------

function lerAgendaDoAdm(admId) {
  const banco = abrirBanco();
  let agenda = banco.prepare('SELECT * FROM agendas WHERE usuario_id = ?').get(admId);
  if (!agenda) {
    banco
      .prepare('INSERT INTO agendas (usuario_id, fuso, config) VALUES (?, ?, ?)')
      .run(admId, configuracao.fusoPadrao, JSON.stringify(horarios.configuracaoPadraoAgenda()));
    agenda = banco.prepare('SELECT * FROM agendas WHERE usuario_id = ?').get(admId);
  }
  return { ...agenda, config: JSON.parse(agenda.config) };
}

/** Valida número de WhatsApp: só dígitos, com DDI. Para o Brasil: 55 + DDD + número. */
function normalizarWhatsapp(texto) {
  let digitos = soDigitos(texto);
  if (!digitos) return null;
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`; // digitou sem o 55
  if (digitos.length < 12 || digitos.length > 15) throw new ErroHttp(400, 'Número de WhatsApp inválido. Use DDD + número, ex.: (92) 99999-9999.');
  if (digitos.startsWith('55') && !(digitos.length === 12 || digitos.length === 13)) {
    throw new ErroHttp(400, 'Número brasileiro deve ter DDD + 8 ou 9 dígitos.');
  }
  return digitos;
}

/** Junta tudo que está ocupado para um ADM: Google + pedidos feitos pelo site. */
async function coletarOcupados(agenda, inicioMs, fimMs, { ignorarCache = false } = {}) {
  const doSite = abrirBanco()
    .prepare(`SELECT inicio, fim FROM agendamentos
               WHERE adm_id = ? AND status IN ('pendente','confirmado') AND fim > ? AND inicio < ?`)
    .all(agenda.usuario_id, inicioMs, fimMs);
  let doGoogle = [];
  let sincronizado = false;
  if (agenda.google_agenda_id) {
    // Se o ADM configurou o Google e ele falhar, NÃO mostramos horários
    // (é melhor avisar do que oferecer um horário que está ocupado).
    doGoogle = await google.buscarOcupados(agenda.google_agenda_id, inicioMs, fimMs, { ignorarCache });
    sincronizado = true;
  }
  return { ocupados: [...doSite, ...doGoogle], sincronizado };
}

const NOMES_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function formatarDataHora(instanteMs, fuso) {
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).format(instanteMs);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instanteMs);
  const diaSemana = NOMES_DIAS[new Date(horarios.instanteLocal(horarios.dataLocal(instanteMs, fuso), 720, fuso)).getUTCDay()];
  return { data, hora, diaSemana };
}

/** Texto que vai pronto para o WhatsApp do ADM. */
function montarMensagemWhatsapp({ tituloPagina, servico, duracaoMin, inicio, fuso, nome, telefone, observacoes, codigo }) {
  const { data, hora, diaSemana } = formatarDataHora(inicio, fuso);
  const linhas = [
    `Olá! Acabei de pedir um horário pela página "${tituloPagina}".`,
    '',
    `*Serviço:* ${servico} (${duracaoMin} min)`,
    `*Data:* ${diaSemana}, ${data}`,
    `*Horário:* ${hora}`,
    `*Nome:* ${nome}`,
    `*Telefone:* ${telefone}`,
  ];
  if (observacoes) linhas.push(`*Observações:* ${observacoes}`);
  linhas.push('', `Código do pedido: ${codigo}`, 'Aguardo a confirmação, obrigada(o)!');
  return linhas.join('\n');
}

function formatarTelefone(digitos) {
  const local = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digitos;
}

/** Aviso automático OPCIONAL via CallMeBot (serviço gratuito de terceiros). */
async function avisarPorCallMeBot(agenda, mensagem) {
  if (!agenda.callmebot_cripto || !agenda.whatsapp) return;
  try {
    const chave = seguranca.descriptografar(agenda.callmebot_cripto);
    const endereco = new URL(configuracao.callmebotUrl);
    endereco.searchParams.set('phone', `+${agenda.whatsapp}`);
    endereco.searchParams.set('text', mensagem);
    endereco.searchParams.set('apikey', chave);
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 8000);
    await fetch(endereco, { signal: controlador.signal }).finally(() => clearTimeout(temporizador));
  } catch (erro) {
    console.warn('[callmebot] aviso automático falhou:', erro.message);
  }
}

/** Página publicada + agenda do dono dela (para rotas públicas). */
function paginaPublicaComAgenda(slug) {
  if (!/^[a-z0-9-]{3,60}$/.test(String(slug))) throw new ErroHttp(404, 'Página não encontrada.');
  const pagina = abrirBanco().prepare(`
    SELECT p.id, p.titulo, p.dono_id, p.conteudo_publicado
      FROM paginas p JOIN usuarios u ON u.id = p.dono_id
     WHERE p.slug = ? AND p.publicada = 1 AND u.ativo = 1`).get(slug);
  if (!pagina) throw new ErroHttp(404, 'Página não encontrada.');
  if (!JSON.parse(pagina.conteudo_publicado).secoes.some((secao) => secao.tipo === 'agendamento')) {
    throw new ErroHttp(404, 'Esta página não tem agendamento.');
  }
  const agenda = lerAgendaDoAdm(pagina.dono_id);
  if (!agenda.whatsapp) throw new ErroHttp(503, 'O agendamento desta página ainda não está ativo.');
  return { pagina, agenda };
}

function servicoEscolhido(agenda, servicoId) {
  const servico = agenda.config.servicos.find((item) => item.id === servicoId);
  if (!servico) throw new ErroHttp(400, 'Escolha um serviço válido.');
  return servico;
}

function erroGoogleParaHttp(erro) {
  if (erro instanceof google.ErroGoogle) {
    console.warn('[google]', erro.codigo, erro.message);
    return new ErroHttp(503, 'Não foi possível consultar a agenda agora. Tente de novo em alguns minutos ou chame no WhatsApp.');
  }
  return erro;
}

// ------------------------------------------------------------------
// Rotas
// ------------------------------------------------------------------

function registrar(roteador) {
  // ================= ADM: configuração =================
  roteador.get('/api/adm/agenda', async (contexto) => {
    const agenda = lerAgendaDoAdm(contexto.usuario.id);
    return {
      whatsapp: agenda.whatsapp || '',
      googleAgendaId: agenda.google_agenda_id || '',
      fuso: agenda.fuso,
      config: agenda.config,
      emailIntegracao: google.emailDaContaServico(),
      callmebotConfigurado: Boolean(agenda.callmebot_cripto),
    };
  }, ADM_OU_DONO);

  roteador.put('/api/adm/agenda', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const agendaAtual = lerAgendaDoAdm(contexto.usuario.id);
    const whatsapp = normalizarWhatsapp(corpo.whatsapp);

    let googleAgendaId = textoLimpo(corpo.googleAgendaId, 200);
    if (googleAgendaId && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(googleAgendaId)) {
      throw new ErroHttp(400, 'ID da agenda inválido. Normalmente é o seu Gmail (ex.: nome@gmail.com).');
    }
    const fuso = textoLimpo(corpo.fuso || agendaAtual.fuso, 60);
    if (!horarios.fusoValido(fuso)) throw new ErroHttp(400, 'Fuso horário inválido.');

    let config;
    try {
      config = horarios.validarConfiguracaoAgenda(corpo.config);
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }

    // CallMeBot: undefined = não mexer; '' = remover; texto = nova chave
    let callmebotCripto = agendaAtual.callmebot_cripto;
    if (typeof corpo.callmebotChave === 'string') {
      const chave = corpo.callmebotChave.trim();
      if (chave && !/^[A-Za-z0-9]{4,40}$/.test(chave)) throw new ErroHttp(400, 'Chave do CallMeBot inválida.');
      callmebotCripto = chave ? seguranca.criptografar(chave) : null;
    }

    abrirBanco()
      .prepare('UPDATE agendas SET whatsapp = ?, google_agenda_id = ?, fuso = ?, config = ?, callmebot_cripto = ? WHERE usuario_id = ?')
      .run(whatsapp, googleAgendaId || null, fuso, JSON.stringify(config), callmebotCripto, contexto.usuario.id);
    google.esquecerCache();
    return { ok: true, whatsapp: whatsapp || '', config };
  }, ADM_OU_DONO);

  // Testa a conexão com o Google Agenda (botão "Testar conexão")
  roteador.post('/api/adm/agenda/testar', async (contexto) => {
    if (!seguranca.limitador.permitir(`teste-google:${contexto.usuario.id}`, 10, 10 * 60 * 1000)) {
      throw new ErroHttp(429, 'Aguarde alguns minutos antes de testar de novo.');
    }
    const corpo = await lerCorpoJson(contexto.requisicao);
    const agendaId = textoLimpo(corpo.googleAgendaId, 200);
    if (!agendaId) throw new ErroHttp(400, 'Informe o ID da agenda (normalmente seu Gmail).');
    if (!google.emailDaContaServico()) {
      return { ok: false, mensagem: 'O dono do sistema ainda não configurou a integração com o Google. Avise o responsável.' };
    }
    const agora = Date.now();
    try {
      const ocupados = await google.buscarOcupados(agendaId, agora, agora + 7 * horarios.DIA, { ignorarCache: true });
      return { ok: true, mensagem: `Conectado! Encontramos ${ocupados.length} bloco(s) ocupado(s) nos próximos 7 dias.` };
    } catch (erro) {
      if (erro instanceof google.ErroGoogle) return { ok: false, mensagem: erro.message };
      throw erro;
    }
  }, ADM_OU_DONO);

  // ================= ADM: pedidos =================
  roteador.get('/api/adm/agendamentos', async (contexto) => {
    const filtro = contexto.consulta.get('filtro') || 'proximos';
    const agora = Date.now();
    const condicoes = {
      proximos: "AND a.fim > ? AND a.status IN ('pendente','confirmado')",
      pendentes: "AND a.status = 'pendente' AND a.fim > ?",
      passados: "AND a.fim <= ?",
      cancelados: "AND a.status = 'cancelado' AND ? > 0",
    };
    const condicao = condicoes[filtro] || condicoes.proximos;
    const ordem = filtro === 'passados' || filtro === 'cancelados' ? 'DESC' : 'ASC';
    const agenda = lerAgendaDoAdm(contexto.usuario.id);
    const linhas = abrirBanco().prepare(`
      SELECT a.*, p.titulo AS pagina_titulo
        FROM agendamentos a LEFT JOIN paginas p ON p.id = a.pagina_id
       WHERE a.adm_id = ? ${condicao}
       ORDER BY a.inicio ${ordem} LIMIT 300`).all(contexto.usuario.id, agora);
    const pendentes = abrirBanco()
      .prepare("SELECT COUNT(*) AS total FROM agendamentos WHERE adm_id = ? AND status = 'pendente' AND fim > ?")
      .get(contexto.usuario.id, agora).total;
    return {
      fuso: agenda.fuso,
      totalPendentes: pendentes,
      agendamentos: linhas.map((linha) => ({
        id: linha.id,
        codigo: linha.codigo,
        servico: linha.servico,
        duracaoMin: linha.duracao_min,
        inicio: new Date(linha.inicio).toISOString(),
        fim: new Date(linha.fim).toISOString(),
        nome: linha.nome_cliente,
        telefone: linha.telefone_cliente,
        telefoneFormatado: formatarTelefone(linha.telefone_cliente),
        observacoes: linha.observacoes || '',
        status: linha.status,
        pagina: linha.pagina_titulo || '(página excluída)',
        clienteComConta: Boolean(linha.cliente_id),
        criadoEm: linha.criado_em,
      })),
    };
  }, ADM_OU_DONO);

  roteador.post('/api/adm/agendamentos/:id/status', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const corpo = await lerCorpoJson(contexto.requisicao);
    if (!['confirmado', 'cancelado', 'concluido', 'pendente'].includes(corpo.status)) throw new ErroHttp(400, 'Situação inválida.');
    const resultado = abrirBanco()
      .prepare('UPDATE agendamentos SET status = ? WHERE id = ? AND adm_id = ?')
      .run(corpo.status, id, contexto.usuario.id);
    if (!resultado.changes) throw new ErroHttp(404, 'Agendamento não encontrado.');
    google.esquecerCache();
    return { ok: true };
  }, ADM_OU_DONO);

  // ================= PÚBLICO: horários livres =================
  roteador.get('/api/publico/paginas/:slug/horarios', async (contexto) => {
    if (!seguranca.limitador.permitir(`horarios:${contexto.ip}`, 60, 60 * 1000)) {
      throw new ErroHttp(429, 'Muitas consultas seguidas. Aguarde um minuto.');
    }
    const { agenda } = paginaPublicaComAgenda(contexto.parametros.slug);
    const servico = servicoEscolhido(agenda, contexto.consulta.get('servico'));
    const janela = horarios.janelaDeBusca(agenda.config, agenda.fuso);
    try {
      const { ocupados, sincronizado } = await coletarOcupados(agenda, janela.inicio, janela.fim);
      const dias = horarios.gerarDias({ configAgenda: agenda.config, fuso: agenda.fuso, duracaoMin: servico.duracaoMin, ocupados });
      return { fuso: agenda.fuso, sincronizado, servico: { id: servico.id, nome: servico.nome, duracaoMin: servico.duracaoMin }, dias };
    } catch (erro) {
      throw erroGoogleParaHttp(erro);
    }
  }, { publica: true });

  // ================= PÚBLICO: pedir um horário =================
  roteador.post('/api/publico/paginas/:slug/agendamentos', async (contexto) => {
    if (!seguranca.limitador.permitir(`agendar:${contexto.ip}`, 6, 60 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitos pedidos a partir desta conexão. Chame o salão pelo WhatsApp.');
    }
    const corpo = await lerCorpoJson(contexto.requisicao);
    if (corpo.site) throw new ErroHttp(400, 'Não foi possível concluir o pedido.'); // campo-armadilha para robôs

    const { pagina, agenda } = paginaPublicaComAgenda(contexto.parametros.slug);
    if (agenda.config.exigirContaCliente && contexto.usuario?.papel !== 'usuario') {
      throw new ErroHttp(401, 'Para agendar nesta página, entre ou crie sua conta de cliente.');
    }
    const servico = servicoEscolhido(agenda, corpo.servicoId);
    const nome = textoLimpo(corpo.nome, 80);
    const telefone = soDigitos(corpo.telefone);
    const observacoes = textoLimpo(corpo.observacoes, 300);
    if (nome.length < 2) throw new ErroHttp(400, 'Informe seu nome.');
    if (telefone.length < 10 || telefone.length > 13) throw new ErroHttp(400, 'Informe um telefone com DDD.');
    if (!corpo.consentimento) throw new ErroHttp(400, 'É preciso concordar com o uso dos dados para o agendamento.');

    const inicio = Date.parse(corpo.inicio);
    if (!Number.isFinite(inicio)) throw new ErroHttp(400, 'Horário inválido.');
    const inicioIso = new Date(inicio).toISOString();
    const fim = inicio + servico.duracaoMin * horarios.MINUTO;

    // Limite anti-abuso: no máximo 3 pedidos futuros abertos por telefone com o mesmo ADM
    const abertos = abrirBanco()
      .prepare("SELECT COUNT(*) AS total FROM agendamentos WHERE adm_id = ? AND telefone_cliente = ? AND status IN ('pendente','confirmado') AND fim > ?")
      .get(agenda.usuario_id, telefone, Date.now()).total;
    if (abertos >= 3) throw new ErroHttp(400, 'Você já tem 3 horários em aberto com este profissional. Fale pelo WhatsApp para marcar mais.');

    // 1) Consulta o Google AGORA (sem cache) para não marcar em cima de algo novo
    const janela = horarios.janelaDeBusca(agenda.config, agenda.fuso);
    let ocupadosGoogle = [];
    try {
      if (agenda.google_agenda_id) {
        ocupadosGoogle = await google.buscarOcupados(agenda.google_agenda_id, janela.inicio, janela.fim, { ignorarCache: true });
      }
    } catch (erro) {
      throw erroGoogleParaHttp(erro);
    }

    // 2) Confere e grava numa transação: dois pedidos simultâneos nunca pegam o mesmo horário
    const codigo = seguranca.gerarCodigoCurto(6);
    emTransacao((banco) => {
      const doSite = banco
        .prepare("SELECT inicio, fim FROM agendamentos WHERE adm_id = ? AND status IN ('pendente','confirmado') AND fim > ? AND inicio < ?")
        .all(agenda.usuario_id, janela.inicio, janela.fim);
      const livre = horarios.horarioEstaLivre(inicioIso, {
        configAgenda: agenda.config, fuso: agenda.fuso, duracaoMin: servico.duracaoMin, ocupados: [...doSite, ...ocupadosGoogle],
      });
      if (!livre) throw new ErroHttp(409, 'Este horário acabou de ser ocupado. Escolha outro, por favor.');
      banco.prepare(`
        INSERT INTO agendamentos (codigo, pagina_id, adm_id, cliente_id, servico, duracao_min, inicio, fim, nome_cliente, telefone_cliente, observacoes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(codigo, pagina.id, agenda.usuario_id, contexto.usuario?.papel === 'usuario' ? contexto.usuario.id : null,
          servico.nome, servico.duracaoMin, inicio, fim, nome, telefone, observacoes || null);
    });
    google.esquecerCache();

    const mensagem = montarMensagemWhatsapp({
      tituloPagina: pagina.titulo, servico: servico.nome, duracaoMin: servico.duracaoMin, inicio, fuso: agenda.fuso,
      nome, telefone: formatarTelefone(telefone), observacoes, codigo,
    });
    avisarPorCallMeBot(agenda, mensagem); // não esperamos: se falhar, o botão do WhatsApp continua funcionando
    const { data, hora, diaSemana } = formatarDataHora(inicio, agenda.fuso);
    return {
      codigo,
      resumo: { servico: servico.nome, data, hora, diaSemana },
      linkWhatsapp: `https://wa.me/${agenda.whatsapp}?text=${encodeURIComponent(mensagem)}`,
    };
  }, { publica: true });

  // ================= CLIENTE: meus agendamentos =================
  roteador.get('/api/cliente/agendamentos', async (contexto) => {
    const linhas = abrirBanco().prepare(`
      SELECT a.id, a.codigo, a.servico, a.duracao_min, a.inicio, a.status, p.titulo AS pagina, p.slug, g.fuso
        FROM agendamentos a
        LEFT JOIN paginas p ON p.id = a.pagina_id
        LEFT JOIN agendas g ON g.usuario_id = a.adm_id
       WHERE a.cliente_id = ?
       ORDER BY a.inicio DESC LIMIT 100`).all(contexto.usuario.id);
    return {
      agendamentos: linhas.map((linha) => ({
        id: linha.id,
        codigo: linha.codigo,
        servico: linha.servico,
        duracaoMin: linha.duracao_min,
        inicio: new Date(linha.inicio).toISOString(),
        fuso: linha.fuso || configuracao.fusoPadrao,
        status: linha.status,
        pagina: linha.pagina || 'Salão',
        slug: linha.slug,
        podeCancelar: STATUS_ATIVOS.includes(linha.status) && linha.inicio > Date.now() + 2 * 60 * 60 * 1000,
      })),
    };
  }, { papeis: ['usuario'] });

  roteador.post('/api/cliente/agendamentos/:id/cancelar', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const resultado = abrirBanco()
      .prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ? AND cliente_id = ? AND status IN ('pendente','confirmado') AND inicio > ?")
      .run(id, contexto.usuario.id, Date.now() + 2 * 60 * 60 * 1000);
    if (!resultado.changes) throw new ErroHttp(400, 'Não é possível cancelar este agendamento por aqui (faltam menos de 2 h ou ele já foi encerrado). Fale com o salão.');
    registrarAuditoria(contexto.usuario.id, 'cliente-cancelou', String(id), contexto.ip);
    google.esquecerCache();
    return { ok: true };
  }, { papeis: ['usuario'] });
}

module.exports = { registrar, normalizarWhatsapp, montarMensagemWhatsapp };
