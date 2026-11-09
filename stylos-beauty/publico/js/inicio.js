/** inicio.js — tela inicial (/): mostra a marca e uma "janela" animada com blocos. */
(function () {
  'use strict';
  const { el, icone, marca, api } = window.StylOS;
  document.getElementById('espaco-marca').replaceWith(marca());

  const blocos = [['cabecalho', 'Cabeçalho', 'fixo'], ['servicos', 'Serviços', ''], ['galeria', 'Galeria', ''], ['agendamento', 'Agendamento', 'WhatsApp'], ['rodape', 'Rodapé', 'fixo']];
  const area = document.getElementById('demonstracao-blocos');
  blocos.forEach(([nomeIcone, nome, extra]) => area.append(el('div', { classe: 'bloco-secao' }, [icone(nomeIcone, 20), nome, extra ? el('em', { texto: extra }) : null])));

  // Se já estiver logado, o botão do topo leva direto ao lugar certo
  api('/api/sessao', { semRedirecionar: true }).then((dados) => {
    if (dados.configuracaoInicialPendente) {
      const botao = document.getElementById('botao-topo');
      botao.textContent = 'Configuração inicial';
      botao.href = '/configuracao-inicial';
    } else if (dados.usuario) {
      const botao = document.getElementById('botao-topo');
      botao.textContent = dados.usuario.papel === 'usuario' ? 'Minha conta' : 'Abrir painel';
      botao.href = dados.usuario.papel === 'usuario' ? '/minha-conta' : '/painel';
    }
  }).catch(() => {});
})();
