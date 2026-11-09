/**
 * pagina.js — inicia a página de um salão.
 *
 *  /p/<slug>           → busca o conteúdo PUBLICADO na API e desenha.
 *  /pre-visualizacao   → é a prévia dentro do editor: recebe o conteúdo
 *                        por mensagem (postMessage) a cada alteração.
 */
(function () {
  'use strict';

  const raiz = document.getElementById('raiz-pagina');
  const Renderizador = window.RenderizadorStylOS;

  function mostrarEstado(titulo, texto) {
    const caixa = Renderizador.el('div', { classe: 'estado-pagina' }, [
      Renderizador.el('h1', { texto: titulo }),
      Renderizador.el('p', { texto: texto }),
      Renderizador.el('a', { href: '/', texto: 'Ir para o início' }),
    ]);
    raiz.replaceChildren(caixa);
  }

  // ----------------------------------------------------------------
  // PÁGINA PÚBLICA
  // ----------------------------------------------------------------
  async function iniciarPaginaPublica() {
    const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
    try {
      const [respostaPagina, respostaSessao] = await Promise.all([
        fetch(`/api/publico/paginas/${encodeURIComponent(slug)}`, { credentials: 'same-origin' }),
        fetch('/api/sessao', { credentials: 'same-origin' }).catch(() => null),
      ]);
      if (!respostaPagina.ok) {
        document.title = 'Página não encontrada';
        mostrarEstado('Página não encontrada', 'O link pode estar errado ou a página foi tirada do ar.');
        return;
      }
      const dados = await respostaPagina.json();
      const sessao = respostaSessao && respostaSessao.ok ? await respostaSessao.json() : {};
      document.title = dados.titulo;
      const cabecalho = (dados.conteudo.secoes || []).find((secao) => secao.tipo === 'cabecalho');
      if (cabecalho && cabecalho.dados.subtitulo) {
        document.querySelector('meta[name="description"]').setAttribute('content', cabecalho.dados.subtitulo);
      }
      Renderizador.renderizarPagina(raiz, dados.conteudo, {
        modo: 'publico',
        slug,
        agenda: dados.agenda,
        usuario: sessao.usuario || null,
      });
      // Veio de um link com #secao-xxx (ex.: voltou do login)? Rola até lá.
      if (location.hash.startsWith('#secao-')) {
        setTimeout(() => Renderizador.rolarAte(location.hash.replace('#secao-', '')), 150);
      }
    } catch (erro) {
      console.error(erro);
      mostrarEstado('Sem conexão', 'Não foi possível carregar a página. Verifique a internet e tente de novo.');
    }
  }

  // ----------------------------------------------------------------
  // PRÉVIA DO EDITOR
  // ----------------------------------------------------------------
  function iniciarPrevia() {
    let ultimoConteudo = null;
    let ultimasOpcoes = {};

    function avisarEditor(mensagem) {
      window.parent.postMessage(mensagem, location.origin);
    }

    function desenhar(manterRolagem) {
      const rolagem = window.scrollY;
      Renderizador.renderizarPagina(raiz, ultimoConteudo, {
        modo: 'previa',
        agenda: ultimasOpcoes.agenda,
        secaoSelecionada: ultimasOpcoes.secaoSelecionada,
        aoSelecionarSecao: (secaoId) => avisarEditor({ tipo: 'selecionar', secaoId }),
      });
      if (manterRolagem) window.scrollTo(0, rolagem);
    }

    window.addEventListener('message', (evento) => {
      // Só aceita mensagens do próprio editor (mesma origem)
      if (evento.origin !== location.origin || evento.source !== window.parent) return;
      const mensagem = evento.data || {};
      if (mensagem.tipo === 'ola') {
        // o editor terminou de carregar e quer saber se a prévia está pronta
        avisarEditor({ tipo: 'pronto' });
      } else if (mensagem.tipo === 'renderizar') {
        ultimoConteudo = mensagem.conteudo;
        ultimasOpcoes = { agenda: mensagem.agenda, secaoSelecionada: mensagem.secaoSelecionada };
        desenhar(true);
      } else if (mensagem.tipo === 'selecionar' && ultimoConteudo) {
        ultimasOpcoes.secaoSelecionada = mensagem.secaoId;
        document.querySelectorAll('.secao--selecionada').forEach((secao) => secao.classList.remove('secao--selecionada'));
        const alvo = document.getElementById(`secao-${mensagem.secaoId}`);
        if (alvo) {
          alvo.classList.add('secao--selecionada');
          if (mensagem.rolar) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
    document.title = 'Prévia';
    avisarEditor({ tipo: 'pronto' });
  }

  if (location.pathname === '/pre-visualizacao') iniciarPrevia();
  else iniciarPaginaPublica();
})();
