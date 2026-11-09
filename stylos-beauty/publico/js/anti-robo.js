/**
 * anti-robo.js — caixa "Não sou um robô" (prova de trabalho, sem rastreamento).
 *
 * Uso:
 *   const verificador = AntiRoboStylOS.criar();
 *   formulario.append(verificador.elemento);
 *   verificador.observar(formulario);          // começa sozinho ao tocar no formulário
 *   ...no envio:
 *   const antiRobo = await verificador.obterSolucao();   // manda junto no corpo
 *   ...se o servidor recusar ou depois de usar:
 *   verificador.reiniciar();                   // cada verificação vale UMA vez
 */
(function (raiz) {
  'use strict';

  function el(tag, classe, texto) {
    const elemento = document.createElement(tag);
    if (classe) elemento.className = classe;
    if (texto) elemento.textContent = texto;
    return elemento;
  }

  /** Resolve o desafio num Web Worker (a tela continua respondendo). */
  function resolverNoWorker(desafio) {
    return new Promise((resolver, rejeitar) => {
      if (typeof Worker === 'undefined') {
        rejeitar(new Error('Seu navegador é muito antigo para a verificação. Atualize-o.'));
        return;
      }
      const trabalhador = new Worker('/js/anti-robo-worker.js');
      const limite = setTimeout(() => {
        trabalhador.terminate();
        rejeitar(new Error('A verificação demorou demais. Tente de novo.'));
      }, 90000);
      trabalhador.onmessage = (evento) => {
        clearTimeout(limite);
        trabalhador.terminate();
        if (evento.data.numero < 0) rejeitar(new Error('Falha na verificação.'));
        else resolver(evento.data.numero);
      };
      trabalhador.onerror = () => {
        clearTimeout(limite);
        trabalhador.terminate();
        rejeitar(new Error('Falha na verificação.'));
      };
      trabalhador.postMessage({ salt: desafio.salt, dificuldade: desafio.dificuldade });
    });
  }

  function criar() {
    let estado = 'inicial';
    let solucao = null;
    let promessa = null;

    const marca = el('span', 'anti-robo__marca');
    const texto = el('span', 'anti-robo__texto', 'Não sou um robô');
    const caixa = el('button', 'anti-robo__caixa');
    caixa.type = 'button';
    caixa.setAttribute('role', 'checkbox');
    caixa.setAttribute('aria-checked', 'false');
    caixa.append(marca, texto);
    const selo = el('span', 'anti-robo__selo', 'Proteção StylOS · sem rastreamento');
    const elemento = el('div', 'anti-robo');
    elemento.setAttribute('aria-live', 'polite');
    elemento.append(caixa, selo);

    function mostrar(novoEstado, mensagem) {
      estado = novoEstado;
      elemento.dataset.estado = novoEstado;
      caixa.setAttribute('aria-checked', novoEstado === 'ok' ? 'true' : novoEstado === 'verificando' ? 'mixed' : 'false');
      caixa.disabled = novoEstado === 'verificando' || novoEstado === 'ok';
      texto.textContent = mensagem;
    }

    function iniciar() {
      if (promessa) return promessa;
      mostrar('verificando', 'Verificando…');
      promessa = (async () => {
        const resposta = await fetch('/api/anti-robo/desafio', { credentials: 'same-origin' });
        if (!resposta.ok) throw new Error(resposta.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : 'Não foi possível verificar agora.');
        const desafio = await resposta.json();
        const numero = await resolverNoWorker(desafio);
        solucao = { ...desafio, numero };
        mostrar('ok', 'Verificado: você não é um robô');
        return solucao;
      })().catch((erro) => {
        promessa = null;
        mostrar('erro', `${erro.message} Toque para tentar de novo.`);
        throw erro;
      });
      return promessa;
    }

    caixa.addEventListener('click', () => { iniciar().catch(() => {}); });
    mostrar('inicial', 'Não sou um robô');

    return {
      elemento,
      /** Começa a verificar quando a pessoa interage com o formulário. */
      observar(formulario) {
        formulario.addEventListener('focusin', () => { if (estado === 'inicial') iniciar().catch(() => {}); });
      },
      /** Espera a verificação (inicia se ainda não começou). */
      obterSolucao() {
        return solucao ? Promise.resolve(solucao) : iniciar();
      },
      /** Depois de enviar (deu certo ou não), a verificação não vale mais. */
      reiniciar() {
        solucao = null;
        promessa = null;
        mostrar('inicial', 'Não sou um robô');
      },
      /** Gasta a verificação atual e já começa outra (para tentar de novo rápido). */
      renovar() {
        solucao = null;
        promessa = null;
        return iniciar().catch(() => {});
      },
    };
  }

  raiz.AntiRoboStylOS = { criar };
})(typeof self !== 'undefined' ? self : this);
