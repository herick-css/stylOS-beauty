/**
 * redefinir-senha.js — tela aberta pelo link do e-mail "Esqueci minha senha".
 * O código vem depois do "#" (o navegador não envia essa parte a nenhum
 * servidor nem a outros sites). Logo que lemos, tiramos da barra de endereço.
 */
(function () {
  'use strict';
  const { el, trocar, marca, api, campo, alerta, medidorSenha } = window.StylOS;
  document.getElementById('espaco-marca').replaceWith(marca());
  const caixa = document.getElementById('caixa-entrada');

  const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  history.replaceState(null, '', location.pathname); // some da barra e do histórico

  function telaLinkInvalido(mensagem) {
    trocar(caixa,
      el('h1', { texto: 'Link inválido' }),
      alerta(mensagem || 'Este link está incompleto, já foi usado ou venceu. Peça um novo em "Esqueci minha senha".'),
      el('p'),
      el('a', { classe: 'botao botao--primario', href: '/entrar', texto: 'Ir para o login' }),
    );
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    telaLinkInvalido();
    return;
  }

  const nova = campo({ id: 'senha-nova', rotulo: 'Nova senha', tipo: 'password', dica: 'Pelo menos 8 caracteres, com letras e números.', atributos: { autocomplete: 'new-password' } });
  nova.elemento.insertBefore(medidorSenha(nova.entrada), nova.elemento.lastChild);
  const repetir = campo({ id: 'senha-repetir', rotulo: 'Repita a nova senha', tipo: 'password', atributos: { autocomplete: 'new-password' } });
  const areaMensagem = el('div');
  const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Salvar nova senha' });
  trocar(caixa,
    el('h1', { texto: 'Crie uma nova senha' }),
    el('p', { classe: 'texto-suave', texto: 'Depois disso, entre normalmente com a nova senha.' }),
    el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        trocar(areaMensagem);
        if (nova.entrada.value !== repetir.entrada.value) {
          areaMensagem.append(alerta('As duas senhas não são iguais.'));
          return;
        }
        botao.classList.add('carregando');
        try {
          await api('/api/redefinir-senha', { corpo: { token, novaSenha: nova.entrada.value }, semRedirecionar: true });
          trocar(caixa,
            el('h1', { texto: 'Senha alterada!' }),
            alerta('Sua nova senha já vale. Por segurança, saímos da sua conta em todos os aparelhos.', 'sucesso'),
            el('p'),
            el('a', { classe: 'botao botao--primario', href: '/entrar', texto: 'Entrar agora' }),
          );
        } catch (erro) {
          botao.classList.remove('carregando');
          if (/Link inválido/.test(erro.message)) telaLinkInvalido(erro.message);
          else areaMensagem.append(alerta(erro.message));
        }
      },
    }, [nova.elemento, repetir.elemento, areaMensagem, el('div', { classe: 'campo' }, [botao])]),
  );
})();
