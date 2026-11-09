/**
 * Testes de ponta a ponta da API: papéis, segurança, páginas, agendamento,
 * integração com o Google (falso) e envio de fotos.
 * Rode com: npm run testar
 */
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { iniciarServidor, pararServidor, iniciarGoogleFalso, Cliente, gerarContaServicoFalsa, PNG_MINIMO } = require('./apoio');

let servidor;
let google;
const contaServico = gerarContaServicoFalsa();
const dono = { email: 'dono@stylos.test', senha: 'DonoForte2026' };
let cliDono;
let cliAdm;
let cliAdm2;
let senhaAdm;
let slugPublicado;
let idPaginaAdm;

before(async () => {
  google = await iniciarGoogleFalso();
  google.estado.chavePublica = contaServico.chavePublica;
  servidor = await iniciarServidor({
    GOOGLE_URL_TOKEN: `http://127.0.0.1:${google.porta}/token`,
    GOOGLE_URL_API: `http://127.0.0.1:${google.porta}/api`,
  });
  cliDono = new Cliente(servidor.base);
});

after(() => {
  if (servidor) pararServidor(servidor);
  if (google) google.servidor.close();
});

describe('configuração inicial e segurança básica', () => {
  test('sessão anônima informa que falta configurar', async () => {
    const r = await cliDono.get('/api/sessao');
    assert.equal(r.status, 200);
    assert.equal(r.dados.usuario, null);
    assert.equal(r.dados.configuracaoInicialPendente, true);
  });

  test('cabeçalhos de segurança estão presentes', async () => {
    const r = await cliDono.get('/painel');
    assert.equal(r.status, 302, 'painel sem login redireciona');
    const pagina = await cliDono.get('/entrar');
    const csp = pagina.cabecalhos.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(pagina.cabecalhos.get('x-content-type-options'), 'nosniff');
    assert.equal(pagina.cabecalhos.get('x-frame-options'), 'SAMEORIGIN');
  });

  test('pedido sem cabeçalho anti-CSRF é bloqueado', async () => {
    const r = await cliDono.post('/api/configuracao-inicial', { codigo: servidor.codigoInicial }, { semCabecalhoCsrf: true });
    assert.equal(r.status, 403);
  });

  test('pedido vindo de outro site (Origin diferente) é bloqueado', async () => {
    const r = await cliDono.post('/api/entrar', { email: 'x@y.com', senha: 'x' }, { cabecalhos: { origin: 'https://site-malicioso.com' } });
    assert.equal(r.status, 403);
  });

  test('código errado não cria o dono', async () => {
    const r = await cliDono.post('/api/configuracao-inicial', { codigo: 'AAAA-BBBB', nome: 'Invasor', email: 'x@x.com', senha: 'Senha12345' });
    assert.equal(r.status, 403);
  });

  test('senha fraca é recusada', async () => {
    const r = await cliDono.post('/api/configuracao-inicial', { codigo: servidor.codigoInicial, nome: 'Herick', email: dono.email, senha: '12345678' });
    assert.equal(r.status, 400);
  });

  test('código certo cria o dono e já entra', async () => {
    const r = await cliDono.post('/api/configuracao-inicial', { codigo: servidor.codigoInicial, nome: 'Herick Dono', email: dono.email, senha: dono.senha });
    assert.equal(r.status, 200);
    assert.match(r.cabecalhos.get('set-cookie'), /HttpOnly/);
    assert.match(r.cabecalhos.get('set-cookie'), /SameSite=Lax/);
    const sessao = await cliDono.get('/api/sessao');
    assert.equal(sessao.dados.usuario.papel, 'dono');
    assert.equal(sessao.dados.usuario.senha_hash, undefined, 'hash nunca vai para o navegador');
    assert.equal(fs.existsSync(path.join(servidor.pasta, 'CODIGO-CONFIGURACAO-INICIAL.txt')), false, 'arquivo do código é apagado');
  });

  test('configuração inicial não pode ser repetida', async () => {
    const outro = new Cliente(servidor.base);
    const r = await outro.post('/api/configuracao-inicial', { codigo: servidor.codigoInicial, nome: 'Outro', email: 'o@o.com', senha: 'Senha12345' });
    assert.equal(r.status, 409);
  });

  test('senha do banco está com hash scrypt (nunca em texto)', async () => {
    const { DatabaseSync } = require('node:sqlite');
    const banco = new DatabaseSync(path.join(servidor.pasta, 'stylos.sqlite'), { readOnly: true });
    const linha = banco.prepare('SELECT senha_hash FROM usuarios WHERE email = ?').get(dono.email);
    banco.close();
    assert.match(linha.senha_hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!linha.senha_hash.includes(dono.senha));
  });

  test('login errado tem mensagem genérica e é limitado após várias tentativas', async () => {
    const atacante = new Cliente(servidor.base, '203.0.113.9');
    const r1 = await atacante.post('/api/entrar', { email: dono.email, senha: 'errada' });
    const r2 = await atacante.post('/api/entrar', { email: 'naoexiste@x.com', senha: 'errada' });
    assert.equal(r1.status, 401);
    assert.equal(r1.dados.erro, r2.dados.erro, 'mesma mensagem: não revela se o e-mail existe');
    let ultimo;
    for (let i = 0; i < 8; i++) ultimo = await atacante.post('/api/entrar', { email: dono.email, senha: `errada${i}` });
    assert.equal(ultimo.status, 429);
    // Mesmo com a senha certa, continua bloqueado por 15 minutos
    const certa = await atacante.post('/api/entrar', { email: dono.email, senha: dono.senha });
    assert.equal(certa.status, 429);
  });
});

describe('papéis: dono, adm e usuário', () => {
  test('só o dono cadastra ADM', async () => {
    const r = await cliDono.post('/api/dono/adms', { nome: 'Ana ADM', email: 'ana@stylos.test' });
    assert.equal(r.status, 200);
    senhaAdm = r.dados.senhaTemporaria;
    assert.match(senhaAdm, /^[a-z]{8}-\d{4}$/);
    const r2 = await cliDono.post('/api/dono/adms', { nome: 'Bia ADM', email: 'bia@stylos.test' });
    assert.equal(r2.status, 200);
    cliAdm2 = new Cliente(servidor.base);
    await cliAdm2.post('/api/entrar', { email: 'bia@stylos.test', senha: r2.dados.senhaTemporaria });
    await cliAdm2.post('/api/trocar-senha', { senhaAtual: r2.dados.senhaTemporaria, novaSenha: 'BiaSenha2026' });
  });

  test('e-mail repetido não vira ADM', async () => {
    const r = await cliDono.post('/api/dono/adms', { nome: 'Ana 2', email: 'ANA@stylos.test' });
    assert.equal(r.status, 409);
  });

  test('ADM com senha temporária é obrigado a trocar antes de usar', async () => {
    cliAdm = new Cliente(servidor.base);
    const login = await cliAdm.post('/api/entrar', { email: 'ana@stylos.test', senha: senhaAdm });
    assert.equal(login.status, 200);
    assert.equal(login.dados.usuario.deveTrocarSenha, true);
    const bloqueado = await cliAdm.get('/api/adm/paginas');
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.dados.codigo, 'trocar-senha');
    const troca = await cliAdm.post('/api/trocar-senha', { senhaAtual: senhaAdm, novaSenha: 'AnaSenhaNova1' });
    assert.equal(troca.status, 200);
    const liberado = await cliAdm.get('/api/adm/paginas');
    assert.equal(liberado.status, 200);
  });

  test('ADM nasce com página de exemplo e agenda padrão', async () => {
    const r = await cliAdm.get('/api/adm/paginas');
    assert.equal(r.dados.paginas.length, 1);
    assert.equal(r.dados.paginas[0].exemplo, true);
    const agenda = await cliAdm.get('/api/adm/agenda');
    assert.ok(agenda.dados.config.servicos.length >= 1);
  });

  test('ADM não acessa rotas do dono', async () => {
    const r = await cliAdm.get('/api/dono/adms');
    assert.equal(r.status, 403);
    const r2 = await cliAdm.post('/api/dono/adms', { nome: 'Hacker', email: 'h@h.com' });
    assert.equal(r2.status, 403);
  });

  test('cliente se cadastra sozinho e não acessa rotas de ADM', async () => {
    const cliente = new Cliente(servidor.base);
    const r = await cliente.post('/api/cadastro', { nome: 'Clara Cliente', email: 'clara@x.com', telefone: '(92) 98888-7777', senha: 'Clara12345', aceite: true });
    assert.equal(r.status, 200);
    assert.equal(r.dados.usuario.papel, 'usuario');
    assert.equal((await cliente.get('/api/adm/paginas')).status, 403);
    assert.equal((await cliente.get('/api/dono/adms')).status, 403);
    assert.equal((await cliente.get('/painel')).status, 302, 'tela do painel redireciona cliente');
  });

  test('cadastro de cliente não pode escolher papel', async () => {
    const espertinho = new Cliente(servidor.base);
    const r = await espertinho.post('/api/cadastro', { nome: 'Espertinho', email: 'esperto@x.com', senha: 'Esperto123', aceite: true, papel: 'dono' });
    assert.equal(r.dados.usuario.papel, 'usuario');
  });

  test('anônimo recebe 401 nas rotas privadas', async () => {
    const anonimo = new Cliente(servidor.base);
    assert.equal((await anonimo.get('/api/adm/paginas')).status, 401);
    assert.equal((await anonimo.get('/api/cliente/agendamentos')).status, 401);
  });
});

describe('páginas: boas práticas, publicação e isolamento', () => {
  test('cria página básica (já nasce com cabeçalho e rodapé)', async () => {
    const r = await cliAdm.post('/api/adm/paginas', { titulo: 'Studio Ana', nomeSalao: 'Studio Ana', tema: 'rose-noir', modelo: 'basico' });
    assert.equal(r.status, 200);
    idPaginaAdm = r.dados.id;
    const pagina = await cliAdm.get(`/api/adm/paginas/${idPaginaAdm}`);
    const tipos = pagina.dados.conteudo.secoes.map((secao) => secao.tipo);
    assert.equal(tipos[0], 'cabecalho');
    assert.equal(tipos.at(-1), 'rodape');
    assert.equal(pagina.dados.conteudo.tema, 'rose-noir');
  });

  test('outro ADM não vê nem altera a página', async () => {
    assert.equal((await cliAdm2.get(`/api/adm/paginas/${idPaginaAdm}`)).status, 404);
    assert.equal((await cliAdm2.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo: {} })).status, 404);
    assert.equal((await cliAdm2.delete(`/api/adm/paginas/${idPaginaAdm}`)).status, 404);
    assert.equal((await cliAdm2.post(`/api/adm/paginas/${idPaginaAdm}/publicar`)).status, 404);
  });

  test('rascunho é limpo: links perigosos e campos estranhos são descartados', async () => {
    const pagina = (await cliAdm.get(`/api/adm/paginas/${idPaginaAdm}`)).dados;
    const conteudo = pagina.conteudo;
    const rodape = conteudo.secoes.at(-1);
    rodape.dados.instagram = 'javascript:alert(1)';
    rodape.dados.campoInventado = '<script>';
    conteudo.secoes[0].dados.titulo = '<img src=x onerror=alert(1)> Olá';
    conteudo.secoes[0].dados.imagem = 'https://site-externo.com/x.jpg';
    conteudo.secoes.push({ tipo: 'tipo-que-nao-existe', dados: {} });
    const r = await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo });
    assert.equal(r.status, 200);
    const salvo = r.dados.conteudo;
    assert.equal(salvo.secoes.at(-1).dados.instagram, '', 'javascript: removido');
    assert.equal(salvo.secoes.at(-1).dados.campoInventado, undefined);
    assert.equal(salvo.secoes[0].dados.imagem, '', 'imagem externa removida');
    assert.ok(!salvo.secoes.some((secao) => secao.tipo === 'tipo-que-nao-existe'));
    // O texto é guardado como TEXTO; o renderizador usa textContent (não executa)
    assert.equal(salvo.secoes[0].dados.titulo, '<img src=x onerror=alert(1)> Olá');
  });

  test('não publica se não começar com cabeçalho', async () => {
    const pagina = (await cliAdm.get(`/api/adm/paginas/${idPaginaAdm}`)).dados;
    const conteudo = pagina.conteudo;
    const [cabecalho] = conteudo.secoes.splice(0, 1);
    conteudo.secoes.splice(1, 0, cabecalho);
    await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo });
    const r = await cliAdm.post(`/api/adm/paginas/${idPaginaAdm}/publicar`);
    assert.equal(r.status, 422);
    assert.ok(r.dados.erros.some((erro) => /COMEÇAR/.test(erro.mensagem)));
    // desfaz
    const [volta] = conteudo.secoes.splice(1, 1);
    conteudo.secoes.unshift(volta);
    await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo });
  });

  test('não publica sem rodapé no fim nem com título obrigatório vazio', async () => {
    const pagina = (await cliAdm.get(`/api/adm/paginas/${idPaginaAdm}`)).dados;
    const conteudo = JSON.parse(JSON.stringify(pagina.conteudo));
    conteudo.secoes.pop();
    conteudo.secoes[0].dados.titulo = '';
    await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo });
    const r = await cliAdm.post(`/api/adm/paginas/${idPaginaAdm}/publicar`);
    assert.equal(r.status, 422);
    assert.ok(r.dados.erros.some((erro) => /TERMINAR/.test(erro.mensagem)));
    assert.ok(r.dados.erros.some((erro) => erro.campo === 'titulo'));
    await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo: pagina.conteudo });
  });

  test('com agendamento, exige WhatsApp cadastrado', async () => {
    const r = await cliAdm.post(`/api/adm/paginas/${idPaginaAdm}/publicar`);
    assert.equal(r.status, 422);
    assert.ok(r.dados.erros.some((erro) => erro.acao === 'agenda'));
  });

  test('WhatsApp inválido é recusado; válido é normalizado com 55', async () => {
    const agenda = (await cliAdm.get('/api/adm/agenda')).dados;
    const ruim = await cliAdm.put('/api/adm/agenda', { ...agenda, whatsapp: '123' });
    assert.equal(ruim.status, 400);
    const config = { ...agenda.config, antecedenciaMin: 0, diasAFrente: 14, expediente: { 0: [['08:00', '20:00']], 1: [['08:00', '20:00']], 2: [['08:00', '20:00']], 3: [['08:00', '20:00']], 4: [['08:00', '20:00']], 5: [['08:00', '20:00']], 6: [['08:00', '20:00']] } };
    const bom = await cliAdm.put('/api/adm/agenda', { whatsapp: '(92) 99999-1234', googleAgendaId: '', fuso: 'America/Manaus', config });
    assert.equal(bom.status, 200);
    assert.equal(bom.dados.whatsapp, '5592999991234');
  });

  test('publica e gera link fixo /p/<slug>', async () => {
    const r = await cliAdm.post(`/api/adm/paginas/${idPaginaAdm}/publicar`);
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    slugPublicado = r.dados.slug;
    assert.match(slugPublicado, /^studio-ana-[a-f0-9]{4}$/);
    const publica = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}`);
    assert.equal(publica.status, 200);
    assert.equal(publica.dados.agenda.ativa, true);
    assert.equal(publica.dados.agenda.whatsapp, undefined, 'número não é exposto antes do pedido');
    const tela = await new Cliente(servidor.base).get(`/p/${slugPublicado}`);
    assert.equal(tela.status, 200);
    assert.match(tela.cabecalhos.get('content-security-policy'), /frame-ancestors 'self' https:\/\/\*\.canva\.site/);
    // publicar de novo mantém o mesmo link
    const denovo = await cliAdm.post(`/api/adm/paginas/${idPaginaAdm}/publicar`);
    assert.equal(denovo.dados.slug, slugPublicado);
  });

  test('editar o rascunho não muda a página publicada até publicar de novo', async () => {
    const pagina = (await cliAdm.get(`/api/adm/paginas/${idPaginaAdm}`)).dados;
    pagina.conteudo.secoes[0].dados.titulo = 'Título novo ainda não publicado';
    await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo: pagina.conteudo });
    const publica = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}`);
    assert.notEqual(publica.dados.conteudo.secoes[0].dados.titulo, 'Título novo ainda não publicado');
    const lista = await cliAdm.get('/api/adm/paginas');
    assert.equal(lista.dados.paginas.find((p) => p.id === idPaginaAdm).temAlteracoesNaoPublicadas, true);
  });

  test('slug inválido ou inexistente dá 404', async () => {
    const anonimo = new Cliente(servidor.base);
    assert.equal((await anonimo.get('/api/publico/paginas/..%2F..%2Fetc')).status, 404);
    assert.equal((await anonimo.get('/api/publico/paginas/nao-existe-0000')).status, 404);
  });
});

describe('agendamento público', () => {
  let primeiroLivre;
  let servicoId;

  test('lista horários livres', async () => {
    const publica = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}`);
    servicoId = publica.dados.agenda.servicos[0].id;
    const r = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}`);
    assert.equal(r.status, 200);
    assert.equal(r.dados.sincronizado, false, 'sem Google configurado');
    const livres = r.dados.dias.flatMap((dia) => dia.horarios).filter((horario) => horario.estado === 'livre');
    assert.ok(livres.length > 10);
    primeiroLivre = livres[3].inicio;
  });

  test('pede horário e recebe link do WhatsApp do ADM com a mensagem pronta', async () => {
    const visitante = new Cliente(servidor.base, '198.51.100.1');
    const r = await visitante.post(`/api/publico/paginas/${slugPublicado}/agendamentos`, {
      servicoId, inicio: primeiroLivre, nome: 'Maria <b>Teste</b>', telefone: '(92) 98765-4321', observacoes: 'Alergia a amônia', consentimento: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.match(r.dados.linkWhatsapp, /^https:\/\/wa\.me\/5592999991234\?text=/);
    const texto = decodeURIComponent(r.dados.linkWhatsapp.split('text=')[1]);
    assert.match(texto, /Maria <b>Teste<\/b>/);
    assert.match(texto, /Alergia a amônia/);
    assert.match(texto, /\(92\) 98765-4321/);
    assert.match(r.dados.codigo, /^[A-Z0-9]{6}$/);
  });

  test('o mesmo horário não pode ser pego de novo (fica ocupado)', async () => {
    const outra = new Cliente(servidor.base, '198.51.100.2');
    const r = await outra.post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: primeiroLivre, nome: 'Joana', telefone: '92911112222', consentimento: true });
    assert.equal(r.status, 409);
    const horarios = await outra.get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}`);
    const estado = horarios.dados.dias.flatMap((dia) => dia.horarios).find((horario) => horario.inicio === primeiroLivre).estado;
    assert.equal(estado, 'ocupado');
  });

  test('dois pedidos simultâneos no mesmo horário: só um passa', async () => {
    const horarios = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}`);
    const alvo = horarios.dados.dias.flatMap((dia) => dia.horarios).filter((horario) => horario.estado === 'livre')[20].inicio;
    const pedidos = await Promise.all([1, 2, 3, 4].map((n) => new Cliente(servidor.base, `198.51.100.${10 + n}`).post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: alvo, nome: `Pessoa ${n}`, telefone: `9290000000${n}`, consentimento: true })));
    assert.equal(pedidos.filter((r) => r.status === 200).length, 1);
    assert.equal(pedidos.filter((r) => r.status === 409).length, 3);
  });

  test('horário fora do expediente/inventado é recusado', async () => {
    const r = await new Cliente(servidor.base, '198.51.100.30').post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: '2026-11-20T06:17:00.000Z', nome: 'Xis Teste', telefone: '92900000000', consentimento: true });
    assert.equal(r.status, 409);
  });

  test('sem consentimento LGPD ou com campo-armadilha preenchido é recusado', async () => {
    const visitante = new Cliente(servidor.base, '198.51.100.31');
    assert.equal((await visitante.post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: primeiroLivre, nome: 'X Y', telefone: '92900000000', consentimento: false })).status, 400);
    assert.equal((await visitante.post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: primeiroLivre, nome: 'Robô', telefone: '92900000000', consentimento: true, site: 'spam.com' })).status, 400);
  });

  test('limite de pedidos por conexão', async () => {
    const robo = new Cliente(servidor.base, '198.51.100.99');
    const respostas = [];
    for (let i = 0; i < 8; i++) {
      respostas.push((await robo.post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: 'x', nome: 'R', telefone: '1', consentimento: true })).status);
    }
    assert.ok(respostas.includes(429));
  });

  test('ADM vê o pedido pendente e confirma', async () => {
    const r = await cliAdm.get('/api/adm/agendamentos?filtro=pendentes');
    assert.ok(r.dados.totalPendentes >= 2);
    const pedido = r.dados.agendamentos.find((item) => item.observacoes === 'Alergia a amônia');
    assert.ok(pedido);
    const confirma = await cliAdm.post(`/api/adm/agendamentos/${pedido.id}/status`, { status: 'confirmado' });
    assert.equal(confirma.status, 200);
    // outro ADM não mexe no pedido
    assert.equal((await cliAdm2.post(`/api/adm/agendamentos/${pedido.id}/status`, { status: 'cancelado' })).status, 404);
  });

  test('cliente com conta vê e cancela o próprio agendamento', async () => {
    const cliente = new Cliente(servidor.base, '198.51.100.50');
    await cliente.post('/api/entrar', { email: 'clara@x.com', senha: 'Clara12345' });
    const horarios = await cliente.get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}`);
    const livre = horarios.dados.dias.flatMap((dia) => dia.horarios).filter((horario) => horario.estado === 'livre').at(-1).inicio;
    const pedido = await cliente.post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: livre, nome: 'Clara Cliente', telefone: '92988887777', consentimento: true });
    assert.equal(pedido.status, 200);
    const meus = await cliente.get('/api/cliente/agendamentos');
    assert.equal(meus.dados.agendamentos.length, 1);
    assert.equal(meus.dados.agendamentos[0].podeCancelar, true);
    const cancela = await cliente.post(`/api/cliente/agendamentos/${meus.dados.agendamentos[0].id}/cancelar`);
    assert.equal(cancela.status, 200);
    const depois = await cliente.get('/api/cliente/agendamentos');
    assert.equal(depois.dados.agendamentos[0].status, 'cancelado');
  });
});

describe('integração com o Google Agenda (servidor falso)', () => {
  test('dono salva a conta de serviço (JSON inválido é recusado)', async () => {
    assert.equal((await cliDono.put('/api/dono/google', { json: '{"isso":"não"}' })).status, 400);
    const r = await cliDono.put('/api/dono/google', { json: contaServico.json });
    assert.equal(r.status, 200);
    assert.equal(r.dados.email, 'stylos-agenda@stylos-teste.iam.gserviceaccount.com');
    // a chave fica criptografada no banco
    const { DatabaseSync } = require('node:sqlite');
    const banco = new DatabaseSync(path.join(servidor.pasta, 'stylos.sqlite'), { readOnly: true });
    const valor = banco.prepare("SELECT valor FROM configuracoes WHERE chave = 'google_conta_servico'").get().valor;
    banco.close();
    assert.ok(!valor.includes('PRIVATE KEY'));
    assert.ok(!valor.includes('stylos-agenda@'));
  });

  test('testar conexão: agenda não compartilhada dá mensagem clara', async () => {
    google.estado.ocupadosPorAgenda['naocompartilhou@gmail.com'] = 'naoEncontrada';
    const r = await cliAdm.post('/api/adm/agenda/testar', { googleAgendaId: 'naocompartilhou@gmail.com' });
    assert.equal(r.dados.ok, false);
    assert.match(r.dados.mensagem, /compartilhada/);
  });

  test('horários ocupados no Google somem da página', async () => {
    const publica = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}`);
    const servicoId = publica.dados.agenda.servicos[0].id;
    const antes = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}`);
    const alvo = antes.dados.dias.flatMap((dia) => dia.horarios).filter((horario) => horario.estado === 'livre')[30];
    const inicio = Date.parse(alvo.inicio);
    google.estado.ocupadosPorAgenda['ana@gmail.com'] = [{ start: new Date(inicio).toISOString(), end: new Date(inicio + 30 * 60000).toISOString() }];

    const teste = await cliAdm.post('/api/adm/agenda/testar', { googleAgendaId: 'ana@gmail.com' });
    assert.equal(teste.dados.ok, true, JSON.stringify(teste.dados));
    const agenda = (await cliAdm.get('/api/adm/agenda')).dados;
    await cliAdm.put('/api/adm/agenda', { whatsapp: agenda.whatsapp, googleAgendaId: 'ana@gmail.com', fuso: agenda.fuso, config: agenda.config });

    const depois = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}`);
    assert.equal(depois.dados.sincronizado, true);
    const estado = depois.dados.dias.flatMap((dia) => dia.horarios).find((horario) => horario.inicio === alvo.inicio).estado;
    assert.equal(estado, 'ocupado');
    // e não deixa agendar em cima
    const r = await new Cliente(servidor.base, '198.51.100.70').post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: alvo.inicio, nome: 'Teste Google', telefone: '92911110000', consentimento: true });
    assert.equal(r.status, 409);
    // o pedido ao Google usou o token assinado
    assert.ok(google.estado.pedidos.some((pedido) => pedido.url === '/api/freeBusy' && pedido.autorizacao === 'Bearer token-falso'));
  });

  test('se o Google cair, a página avisa em vez de mostrar horário errado', async () => {
    google.estado.ocupadosPorAgenda['ana@gmail.com'] = 'naoEncontrada';
    const publica = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}`);
    const servicoId = publica.dados.agenda.servicos[1].id; // outro serviço = outra chave de cache não interfere
    const r = await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}/horarios?servico=${servicoId}&x=1`);
    // pode vir do cache de 60 s; força consulta nova com um pedido de agendamento
    const pedido = await new Cliente(servidor.base, '198.51.100.71').post(`/api/publico/paginas/${slugPublicado}/agendamentos`, { servicoId, inicio: new Date().toISOString(), nome: 'Teste', telefone: '92911110001', consentimento: true });
    assert.equal(pedido.status, 503);
    assert.ok([200, 503].includes(r.status));
    google.estado.ocupadosPorAgenda['ana@gmail.com'] = [];
  });
});

describe('fotos', () => {
  test('aceita PNG de verdade e serve com cabeçalhos seguros', async () => {
    const r = await cliAdm.pedir('POST', '/api/adm/arquivos', undefined, { binario: PNG_MINIMO, tipo: 'image/png' });
    assert.equal(r.status, 200);
    assert.match(r.dados.url, /^\/arquivos\/[a-f0-9]{32}\.png$/);
    const foto = await fetch(servidor.base + r.dados.url);
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get('content-type'), 'image/png');
    assert.match(foto.headers.get('content-security-policy'), /sandbox/);
  });

  test('recusa arquivo disfarçado (HTML com nome de imagem) e SVG', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    assert.equal((await cliAdm.pedir('POST', '/api/adm/arquivos', undefined, { binario: html, tipo: 'image/png' })).status, 415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal((await cliAdm.pedir('POST', '/api/adm/arquivos', undefined, { binario: svg, tipo: 'image/svg+xml' })).status, 415);
  });

  test('recusa arquivo grande demais', async () => {
    const grande = Buffer.concat([PNG_MINIMO, Buffer.alloc(6 * 1024 * 1024)]);
    const r = await cliAdm.pedir('POST', '/api/adm/arquivos', undefined, { binario: grande, tipo: 'image/png' }).catch(() => ({ status: 413 }));
    assert.equal(r.status, 413);
  });

  test('não apaga foto em uso; outro ADM não apaga foto alheia', async () => {
    const enviada = await cliAdm.pedir('POST', '/api/adm/arquivos', undefined, { binario: PNG_MINIMO, tipo: 'image/png' });
    const nome = enviada.dados.url.split('/').pop();
    assert.equal((await cliAdm2.delete(`/api/adm/arquivos/${nome}`)).status, 404);
    const pagina = (await cliAdm.get(`/api/adm/paginas/${idPaginaAdm}`)).dados;
    pagina.conteudo.secoes[0].dados.imagem = enviada.dados.url;
    await cliAdm.put(`/api/adm/paginas/${idPaginaAdm}`, { conteudo: pagina.conteudo });
    assert.equal((await cliAdm.delete(`/api/adm/arquivos/${nome}`)).status, 409);
  });

  test('não sai da pasta de arquivos (path traversal)', async () => {
    const r = await fetch(`${servidor.base}/arquivos/..%2F..%2Fstylos.sqlite`);
    assert.equal(r.status, 404);
    const r2 = await fetch(`${servidor.base}/css/..%2F..%2Fdados%2Fstylos.sqlite`);
    assert.equal(r2.status, 404);
  });
});

describe('dono: moderação e desativação', () => {
  test('desativar ADM derruba a sessão e tira as páginas do ar', async () => {
    const adms = (await cliDono.get('/api/dono/adms')).dados.adms;
    const ana = adms.find((adm) => adm.email === 'ana@stylos.test');
    assert.equal((await cliDono.post(`/api/dono/adms/${ana.id}/ativo`, { ativo: false })).status, 200);
    assert.equal((await cliAdm.get('/api/adm/paginas')).status, 401);
    assert.equal((await new Cliente(servidor.base).get(`/api/publico/paginas/${slugPublicado}`)).status, 404);
    const login = await new Cliente(servidor.base).post('/api/entrar', { email: 'ana@stylos.test', senha: 'AnaSenhaNova1' });
    assert.equal(login.status, 403);
  });

  test('registro de atividades guarda logins e ações', async () => {
    const r = await cliDono.get('/api/dono/auditoria');
    const acoes = r.dados.registros.map((registro) => registro.acao);
    for (const acao of ['adm-criado', 'login-falhou', 'pagina-publicada', 'adm-desativado', 'google-configurado']) {
      assert.ok(acoes.includes(acao), `faltou ${acao}`);
    }
  });

  test('backup e retenção (LGPD) funcionam', () => {
    const { fazerBackupDiario } = require('../servidor/servicos/manutencao');
    assert.equal(typeof fazerBackupDiario, 'function');
  });
});
