/**
 * configuracao-inicial.js — cria a conta do DONO (só funciona uma vez).
 * Pede o código que aparece na janela do servidor: assim ninguém de fora
 * consegue tomar o sistema antes de você.
 */
(function () {
  'use strict';
  const { el, trocar, marca, api, campo, alerta, medidorSenha } = window.StylOS;
  document.getElementById('espaco-marca').replaceWith(marca());
  const caixa = document.getElementById('caixa-entrada');

  function desenhar() {
    const codigo = campo({ id: 'codigo', rotulo: 'Código de configuração', dica: 'Aparece na janela preta do servidor e no arquivo dados/CODIGO-CONFIGURACAO-INICIAL.txt', atributos: { autocomplete: 'off', placeholder: 'ABCD-1234', required: true } });
    const nome = campo({ id: 'nome', rotulo: 'Seu nome', maximo: 80, atributos: { autocomplete: 'name' } });
    const email = campo({ id: 'email', rotulo: 'Seu e-mail', tipo: 'email', atributos: { autocomplete: 'username' } });
    const senha = campo({ id: 'senha', rotulo: 'Crie uma senha forte', tipo: 'password', dica: 'Mínimo 8 caracteres com letras e números. Você é o dono: capriche!', atributos: { autocomplete: 'new-password' } });
    senha.elemento.insertBefore(medidorSenha(senha.entrada), senha.elemento.lastChild);
    const areaMensagem = el('div');
    const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Criar conta do dono' });
    trocar(caixa, 
      el('h1', { texto: 'Configuração inicial' }),
      el('p', { classe: 'texto-suave', texto: 'Crie a conta do DONO do sistema. Depois, no painel, você cadastra os ADMs.' }),
      el('form', {
        novalidate: true,
        aoSubmit: async (evento) => {
          evento.preventDefault();
          areaMensagem.replaceChildren();
          botao.classList.add('carregando');
          try {
            await api('/api/configuracao-inicial', { corpo: { codigo: codigo.entrada.value, nome: nome.entrada.value, email: email.entrada.value, senha: senha.entrada.value }, semRedirecionar: true });
            location.href = '/painel';
          } catch (erro) {
            botao.classList.remove('carregando');
            areaMensagem.append(alerta(erro.message));
          }
        },
      }, [codigo.elemento, nome.elemento, email.elemento, senha.elemento, areaMensagem, el('div', { classe: 'campo' }, [botao])]),
    );
  }

  api('/api/sessao', { semRedirecionar: true }).then((dados) => {
    if (!dados.configuracaoInicialPendente) {
      trocar(caixa, el('h1', { texto: 'Tudo pronto' }), alerta('O sistema já foi configurado.', 'info'), el('p'), el('a', { classe: 'botao botao--primario', href: '/entrar', texto: 'Ir para o login' }));
    } else desenhar();
  }).catch(() => desenhar());
})();
