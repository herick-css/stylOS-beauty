/**
 * entrar.js — tela de LOGIN e CADASTRO DE CLIENTE.
 * ADMs não se cadastram aqui: quem cria ADM é o dono, no painel.
 */
(function () {
  'use strict';
  const { el, trocar, icone, marca, api, campo, alerta, medidorSenha, destinoSeguro } = window.StylOS;

  document.getElementById('espaco-marca').replaceWith(marca());
  const vantagens = ['Páginas prontas por blocos', 'Horários sincronizados com a Google Agenda', 'Pedidos direto no WhatsApp'];
  document.getElementById('lista-vantagens').append(...vantagens.map((texto) => el('li', {}, [icone('check', 18), texto])));

  const caixa = document.getElementById('caixa-entrada');
  let abaAtual = location.pathname === '/cadastro' ? 'cadastro' : 'entrar';

  /** Para onde ir depois de entrar, conforme o papel. */
  function destinoPorPapel(papel) {
    const padrao = papel === 'usuario' ? '/minha-conta' : '/painel';
    const pedido = destinoSeguro(padrao);
    // Cliente não pode ir para o painel; ADM pode voltar para qualquer tela
    if (papel === 'usuario' && (pedido.startsWith('/painel') || pedido.startsWith('/editor'))) return padrao;
    return pedido;
  }

  function desenhar() {
    const abas = el('div', { classe: 'abas', role: 'tablist' }, [
      el('button', { classe: 'aba', role: 'tab', type: 'button', 'aria-selected': String(abaAtual === 'entrar'), aoClick: () => trocarAba('entrar'), texto: 'Entrar' }),
      el('button', { classe: 'aba', role: 'tab', type: 'button', 'aria-selected': String(abaAtual === 'cadastro'), aoClick: () => trocarAba('cadastro'), texto: 'Criar conta de cliente' }),
    ]);
    trocar(caixa, 
      el('h1', { texto: abaAtual === 'entrar' ? 'Bem-vinda(o) de volta' : 'Crie sua conta' }),
      el('p', { classe: 'texto-suave', texto: abaAtual === 'entrar' ? 'Entre com seu e-mail e senha.' : 'Para clientes acompanharem seus agendamentos.' }),
      abas,
      abaAtual === 'entrar' ? formularioEntrar() : formularioCadastro(),
    );
  }

  function trocarAba(aba) {
    abaAtual = aba;
    history.replaceState(null, '', (aba === 'entrar' ? '/entrar' : '/cadastro') + location.search);
    desenhar();
  }

  function formularioEntrar() {
    const email = campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', atributos: { autocomplete: 'username', required: true } });
    const senha = campo({ id: 'senha', rotulo: 'Senha', tipo: 'password', atributos: { autocomplete: 'current-password', required: true } });
    const areaMensagem = el('div');
    const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Entrar' });
    return el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        areaMensagem.replaceChildren();
        if (!email.entrada.value || !senha.entrada.value) {
          areaMensagem.append(alerta('Preencha e-mail e senha.'));
          return;
        }
        botao.classList.add('carregando');
        try {
          const dados = await api('/api/entrar', { corpo: { email: email.entrada.value, senha: senha.entrada.value }, semRedirecionar: true });
          location.href = destinoPorPapel(dados.usuario.papel);
        } catch (erro) {
          botao.classList.remove('carregando');
          areaMensagem.append(alerta(erro.message));
        }
      },
    }, [
      email.elemento, senha.elemento, areaMensagem, el('div', { classe: 'campo' }, [botao]),
      el('p', { classe: 'texto-pequeno texto-suave', texto: 'Esqueceu a senha? Clientes: peça ao salão. ADMs: peça ao dono do sistema para redefinir.' }),
    ]);
  }

  function formularioCadastro() {
    const nome = campo({ id: 'nome', rotulo: 'Nome', maximo: 80, atributos: { autocomplete: 'name', required: true } });
    const email = campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', atributos: { autocomplete: 'email', required: true } });
    const telefone = campo({ id: 'telefone', rotulo: 'WhatsApp (opcional)', tipo: 'tel', dica: 'Preenche sozinho na hora de agendar.', atributos: { autocomplete: 'tel-national', inputmode: 'tel', placeholder: '(92) 99999-9999' } });
    telefone.entrada.addEventListener('input', () => { telefone.entrada.value = window.AgendamentoMascara(telefone.entrada.value); });
    const senha = campo({ id: 'senha', rotulo: 'Senha', tipo: 'password', dica: 'Pelo menos 8 caracteres, com letras e números.', atributos: { autocomplete: 'new-password', required: true } });
    senha.elemento.insertBefore(medidorSenha(senha.entrada), senha.elemento.lastChild);
    const aceite = el('input', { type: 'checkbox', id: 'aceite' });
    const armadilha = el('input', { name: 'site', tabindex: '-1', autocomplete: 'off', classe: 'so-leitor', 'aria-hidden': 'true' });
    const areaMensagem = el('div');
    const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Criar conta' });
    return el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        areaMensagem.replaceChildren();
        botao.classList.add('carregando');
        try {
          await api('/api/cadastro', {
            corpo: {
              nome: nome.entrada.value, email: email.entrada.value, telefone: telefone.entrada.value,
              senha: senha.entrada.value, aceite: aceite.checked, site: armadilha.value,
            },
            semRedirecionar: true,
          });
          location.href = destinoPorPapel('usuario');
        } catch (erro) {
          botao.classList.remove('carregando');
          areaMensagem.append(alerta(erro.message));
        }
      },
    }, [
      nome.elemento, email.elemento, telefone.elemento, senha.elemento, armadilha,
      el('label', { classe: 'caixa-marcar campo', for: 'aceite' }, [aceite, el('span', { texto: 'Concordo que meus dados sejam usados só para agendamentos neste sistema (LGPD). Posso pedir a exclusão a qualquer momento.' })]),
      areaMensagem, el('div', { classe: 'campo' }, [botao]),
    ]);
  }

  // Máscara de telefone simples (mesma lógica do widget de agendamento)
  window.AgendamentoMascara = function (texto) {
    const d = String(texto).replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  // Já está logado? Vai direto.
  api('/api/sessao', { semRedirecionar: true }).then((dados) => {
    if (dados.configuracaoInicialPendente) location.href = '/configuracao-inicial';
    else if (dados.usuario) location.href = destinoPorPapel(dados.usuario.papel);
    else desenhar();
  }).catch(() => desenhar());
})();
