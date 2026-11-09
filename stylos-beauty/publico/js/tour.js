/**
 * tour.js — tutorial guiado ("tour") para o primeiro uso.
 *
 * Uso:
 *   TourStylOS.iniciar([
 *     { alvo: '#botao-x', titulo: 'Título', texto: 'Explicação', antes: () => {...} },
 *     { alvo: null, titulo: 'Sem alvo: balão no centro' },
 *   ], { aoTerminar: (concluiu) => {...} });
 *
 * Escurece a tela, "recorta" o elemento destacado e mostra um balão com
 * Voltar / Próximo / Pular. Funciona com teclado (setas e Esc).
 */
(function (raiz) {
  'use strict';
  const { el, icone } = raiz.StylOS;

  function iniciar(passos, opcoes = {}) {
    let indice = 0;
    const fundo = el('div', { classe: 'tour-fundo', 'aria-hidden': 'true' });
    const recorte = el('div', { classe: 'tour-recorte' });
    const balao = el('div', { classe: 'tour-balao', role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite' });
    document.body.append(fundo, recorte, balao);

    function terminar(concluiu) {
      fundo.remove();
      recorte.remove();
      balao.remove();
      document.removeEventListener('keydown', teclas);
      window.removeEventListener('resize', posicionar);
      if (opcoes.aoTerminar) opcoes.aoTerminar(concluiu);
    }

    function teclas(evento) {
      if (evento.key === 'Escape') terminar(false);
      if (evento.key === 'ArrowRight') ir(indice + 1);
      if (evento.key === 'ArrowLeft' && indice > 0) ir(indice - 1);
    }

    /** Posiciona o recorte em volta do alvo e o balão perto dele. */
    function posicionar() {
      const passo = passos[indice];
      const alvo = passo.alvo ? document.querySelector(passo.alvo) : null;
      const visivel = alvo && alvo.getClientRects().length > 0;
      const larguraTela = window.innerWidth;
      const alturaTela = window.innerHeight;
      if (!visivel) {
        recorte.style.top = `${alturaTela / 2}px`;
        recorte.style.left = `${larguraTela / 2}px`;
        recorte.style.width = '0px';
        recorte.style.height = '0px';
        balao.style.top = `${Math.max(16, alturaTela / 2 - balao.offsetHeight / 2)}px`;
        balao.style.left = `${Math.max(12, larguraTela / 2 - balao.offsetWidth / 2)}px`;
        return;
      }
      const caixa = alvo.getBoundingClientRect();
      const folga = 6;
      recorte.style.top = `${caixa.top - folga}px`;
      recorte.style.left = `${caixa.left - folga}px`;
      recorte.style.width = `${caixa.width + folga * 2}px`;
      recorte.style.height = `${caixa.height + folga * 2}px`;

      const larguraBalao = balao.offsetWidth;
      const alturaBalao = balao.offsetHeight;
      let topo;
      let esquerda;
      if (caixa.right + 16 + larguraBalao < larguraTela && caixa.height > alturaBalao * 0.4 && larguraTela > 700) {
        // à direita do alvo
        esquerda = caixa.right + 16;
        topo = Math.min(Math.max(12, caixa.top), alturaTela - alturaBalao - 12);
      } else if (caixa.bottom + 16 + alturaBalao < alturaTela) {
        topo = caixa.bottom + 16; // abaixo
        esquerda = Math.min(Math.max(12, caixa.left), larguraTela - larguraBalao - 12);
      } else {
        topo = Math.max(12, caixa.top - alturaBalao - 16); // acima
        esquerda = Math.min(Math.max(12, caixa.left), larguraTela - larguraBalao - 12);
      }
      balao.style.top = `${topo}px`;
      balao.style.left = `${esquerda}px`;
    }

    async function ir(novoIndice) {
      if (novoIndice >= passos.length) {
        terminar(true);
        return;
      }
      indice = novoIndice;
      const passo = passos[indice];
      if (passo.antes) await passo.antes();
      const ultimo = indice === passos.length - 1;
      balao.replaceChildren(
        el('div', { classe: 'tour-balao__passo', texto: `Passo ${indice + 1} de ${passos.length}` }),
        el('h3', { texto: passo.titulo }),
        el('p', { texto: passo.texto }),
        el('div', { classe: 'tour-pontos', 'aria-hidden': 'true' }, passos.map((_, i) => el('span', { classe: i === indice ? 'ativo' : '' }))),
        el('div', { classe: 'tour-balao__acoes' }, [
          el('button', { classe: 'botao botao--fantasma botao--pequeno', type: 'button', texto: 'Pular tutorial', aoClick: () => terminar(false) }),
          indice > 0 ? el('button', { classe: 'botao botao--secundario botao--pequeno', type: 'button', texto: 'Voltar', aoClick: () => ir(indice - 1) }) : null,
          el('button', { classe: 'botao botao--primario botao--pequeno', type: 'button', aoClick: () => ir(indice + 1) }, [ultimo ? 'Concluir' : 'Próximo', ultimo ? icone('check', 16) : icone('seta', 16)]),
        ]),
      );
      const alvo = passo.alvo ? document.querySelector(passo.alvo) : null;
      if (alvo) alvo.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      requestAnimationFrame(posicionar);
      const botaoPrincipal = balao.querySelector('.botao--primario');
      if (botaoPrincipal) botaoPrincipal.focus();
    }

    fundo.addEventListener('click', () => {});
    document.addEventListener('keydown', teclas);
    window.addEventListener('resize', posicionar);
    ir(0);
  }

  raiz.TourStylOS = { iniciar };
})(window);
