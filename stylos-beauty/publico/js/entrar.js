/**
 * entrar.js — tela de LOGIN, CADASTRO DE CLIENTE e ESQUECI MINHA SENHA.
 *  - ADMs não se cadastram aqui: quem cria ADM é o dono, no painel.
 *  - "Entrar com Google" aparece quando o dono configurou.
 *  - "Não sou um robô": sempre no cadastro e na recuperação; no login,
 *    só depois de 2 senhas erradas (ou quando o sistema está sob ataque).
 */
(function () {
  'use strict';
  const { el, trocar, icone, marca, api, campo, alerta, medidorSenha, destinoSeguro } = window.StylOS;

  document.getElementById('espaco-marca').replaceWith(marca());
  const vantagens = ['Páginas prontas por blocos', 'Horários sincronizados com a Google Agenda', 'Pedidos direto no WhatsApp'];
  document.getElementById('lista-vantagens').append(...vantagens.map((texto) => el('li', {}, [icone('check', 18), texto])));

  const caixa = document.getElementById('caixa-entrada');
  let abaAtual = location.pathname === '/cadastro' ? 'cadastro' : 'entrar';
  let sessaoInfo = { loginGoogle: false, recuperacaoPorEmail: false, modoDefesa: false };
  let loginPedeAntiRobo = false;

  // Mensagens que voltam do login com Google (/entrar?erro=...)
  const MENSAGENS_ERRO = {
    google: 'Não foi possível entrar com o Google. Tente de novo.',
    'google-cancelado': 'Login com Google cancelado.',
    'google-expirou': 'A tentativa de login expirou. Tente de novo.',
    'google-email': 'Sua conta Google não tem o e-mail verificado.',
    'google-desligado': 'O login com Google não está ativado neste sistema.',
    'google-vincular': 'Este e-mail é de uma conta de ADM. Entre com sua senha e vincule o Google em "Minha conta".',
    desativado: 'Esta conta está desativada. Fale com o responsável pelo sistema.',
    'muitas-tentativas': 'Muitas tentativas. Aguarde alguns minutos.',
  };
  const erroDaUrl = MENSAGENS_ERRO[new URLSearchParams(location.search).get('erro')] || '';

  /** Para onde ir depois de entrar, conforme o papel. */
  function destinoPorPapel(papel) {
    const padrao = papel === 'usuario' ? '/minha-conta' : '/painel';
    const pedido = destinoSeguro(padrao);
    if (papel === 'usuario' && (pedido.startsWith('/painel') || pedido.startsWith('/editor'))) return padrao;
    return pedido;
  }

  function botaoGoogle(texto) {
    if (!sessaoInfo.loginGoogle) return null;
    const voltar = new URLSearchParams(location.search).get('voltar') || '';
    return el('div', { classe: 'campo' }, [
      el('a', { classe: 'botao botao--secundario botao--largo botao-google', href: `/auth/google${voltar ? `?voltar=${encodeURIComponent(voltar)}` : ''}` }, [icone('google', 20), texto]),
      el('div', { classe: 'separador-ou', 'aria-hidden': 'true' }, [el('span', { texto: 'ou' })]),
    ]);
  }

  function desenhar() {
    if (abaAtual === 'esqueci') {
      trocar(caixa, el('h1', { texto: 'Esqueci minha senha' }), formularioEsqueci());
      return;
    }
    const abas = el('div', { classe: 'abas', role: 'tablist' }, [
      el('button', { classe: 'aba', role: 'tab', type: 'button', 'aria-selected': String(abaAtual === 'entrar'), aoClick: () => trocarAba('entrar'), texto: 'Entrar' }),
      el('button', { classe: 'aba', role: 'tab', type: 'button', 'aria-selected': String(abaAtual === 'cadastro'), aoClick: () => trocarAba('cadastro'), texto: 'Criar conta de cliente' }),
    ]);
    trocar(caixa,
      el('h1', { texto: abaAtual === 'entrar' ? 'Bem-vinda(o) de volta' : 'Crie sua conta' }),
      el('p', { classe: 'texto-suave', texto: abaAtual === 'entrar' ? 'Entre com seu e-mail e senha.' : 'Para clientes acompanharem seus agendamentos.' }),
      abas,
      erroDaUrl && abaAtual === 'entrar' ? alerta(erroDaUrl) : null,
      abaAtual === 'entrar' ? formularioEntrar() : formularioCadastro(),
    );
  }

  function trocarAba(aba) {
    abaAtual = aba;
    if (aba !== 'esqueci') history.replaceState(null, '', (aba === 'entrar' ? '/entrar' : '/cadastro') + location.search.replace(/([?&])erro=[^&]*&?/, '$1').replace(/[?&]$/, ''));
    desenhar();
  }

  // ---------------- ENTRAR ----------------
  function formularioEntrar() {
    const email = campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', atributos: { autocomplete: 'username', required: true } });
    const senha = campo({ id: 'senha', rotulo: 'Senha', tipo: 'password', atributos: { autocomplete: 'current-password', required: true } });
    const areaMensagem = el('div');
    const areaRobo = el('div', { classe: 'campo' });
    let verificador = null;
    const mostrarAntiRobo = () => {
      if (verificador) return;
      verificador = window.AntiRoboStylOS.criar();
      areaRobo.append(verificador.elemento);
      verificador.obterSolucao().catch(() => {});
    };
    if (loginPedeAntiRobo || sessaoInfo.modoDefesa) mostrarAntiRobo();
    const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Entrar' });
    return el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        trocar(areaMensagem);
        if (!email.entrada.value || !senha.entrada.value) {
          areaMensagem.append(alerta('Preencha e-mail e senha.'));
          return;
        }
        botao.classList.add('carregando');
        try {
          const antiRobo = verificador ? await verificador.obterSolucao() : undefined;
          const dados = await api('/api/entrar', { corpo: { email: email.entrada.value, senha: senha.entrada.value, antiRobo }, semRedirecionar: true });
          location.href = destinoPorPapel(dados.usuario.papel);
        } catch (erro) {
          botao.classList.remove('carregando');
          areaMensagem.append(alerta(erro.message));
          if (verificador) verificador.renovar();
          if (erro.dados && erro.dados.codigo === 'anti-robo') {
            loginPedeAntiRobo = true;
            mostrarAntiRobo();
          }
        }
      },
    }, [
      botaoGoogle('Entrar com Google'),
      email.elemento, senha.elemento, areaRobo, areaMensagem, el('div', { classe: 'campo' }, [botao]),
      el('button', { classe: 'link-botao-app', type: 'button', texto: 'Esqueci minha senha', aoClick: () => trocarAba('esqueci') }),
    ]);
  }

  // ---------------- CADASTRO ----------------
  function formularioCadastro() {
    const nome = campo({ id: 'nome', rotulo: 'Nome', maximo: 80, atributos: { autocomplete: 'name', required: true } });
    const email = campo({ id: 'email', rotulo: 'E-mail', tipo: 'email', atributos: { autocomplete: 'email', required: true } });
    const telefone = campo({ id: 'telefone', rotulo: 'WhatsApp (opcional)', tipo: 'tel', dica: 'Preenche sozinho na hora de agendar.', atributos: { autocomplete: 'tel-national', inputmode: 'tel', placeholder: '(92) 99999-9999' } });
    telefone.entrada.addEventListener('input', () => { telefone.entrada.value = mascararTelefone(telefone.entrada.value); });
    const senha = campo({ id: 'senha', rotulo: 'Senha', tipo: 'password', dica: 'Pelo menos 8 caracteres, com letras e números.', atributos: { autocomplete: 'new-password', required: true } });
    senha.elemento.insertBefore(medidorSenha(senha.entrada), senha.elemento.lastChild);
    const aceite = el('input', { type: 'checkbox', id: 'aceite' });
    const armadilha = el('input', { name: 'site', tabindex: '-1', autocomplete: 'off', classe: 'so-leitor', 'aria-hidden': 'true' });
    const verificador = window.AntiRoboStylOS.criar();
    const areaMensagem = el('div');
    const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Criar conta' });
    const formulario = el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        trocar(areaMensagem);
        botao.classList.add('carregando');
        try {
          const antiRobo = await verificador.obterSolucao();
          await api('/api/cadastro', {
            corpo: {
              nome: nome.entrada.value, email: email.entrada.value, telefone: telefone.entrada.value,
              senha: senha.entrada.value, aceite: aceite.checked, site: armadilha.value, antiRobo,
            },
            semRedirecionar: true,
          });
          location.href = destinoPorPapel('usuario');
        } catch (erro) {
          botao.classList.remove('carregando');
          areaMensagem.append(alerta(erro.message));
          verificador.renovar();
        }
      },
    }, [
      botaoGoogle('Criar conta com Google'),
      nome.elemento, email.elemento, telefone.elemento, senha.elemento, armadilha,
      el('label', { classe: 'caixa-marcar campo', for: 'aceite' }, [aceite, el('span', { texto: 'Concordo que meus dados sejam usados só para agendamentos neste sistema (LGPD). Posso pedir a exclusão a qualquer momento.' })]),
      el('div', { classe: 'campo' }, [verificador.elemento]),
      areaMensagem, el('div', { classe: 'campo' }, [botao]),
      sessaoInfo.loginGoogle ? el('p', { classe: 'texto-pequeno texto-suave', texto: 'Ao criar a conta com o Google, você também concorda com o uso dos dados para agendamentos (LGPD).' }) : null,
    ]);
    verificador.observar(formulario);
    return formulario;
  }

  // ---------------- ESQUECI MINHA SENHA ----------------
  function formularioEsqueci() {
    const voltar = el('button', { classe: 'link-botao-app', type: 'button', aoClick: () => trocarAba('entrar') }, [icone('setaEsquerda', 16), 'Voltar para o login']);
    if (!sessaoInfo.recuperacaoPorEmail) {
      return el('div', {}, [
        alerta('A recuperação por e-mail ainda não foi ativada neste sistema.', 'info'),
        el('p'),
        el('p', { texto: 'Clientes: peça ao salão. ADMs: peça ao dono do sistema para gerar uma senha temporária.' }),
        voltar,
      ]);
    }
    const email = campo({ id: 'email-recuperar', rotulo: 'Seu e-mail', tipo: 'email', atributos: { autocomplete: 'email' } });
    const verificador = window.AntiRoboStylOS.criar();
    const areaMensagem = el('div');
    const botao = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit', texto: 'Enviar link' });
    const formulario = el('form', {
      novalidate: true,
      aoSubmit: async (evento) => {
        evento.preventDefault();
        trocar(areaMensagem);
        botao.classList.add('carregando');
        try {
          const antiRobo = await verificador.obterSolucao();
          const resposta = await api('/api/recuperar-senha', { corpo: { email: email.entrada.value, antiRobo }, semRedirecionar: true });
          trocar(formulario, alerta(resposta.mensagem, 'sucesso'), el('p'), voltar);
        } catch (erro) {
          botao.classList.remove('carregando');
          areaMensagem.append(alerta(erro.message));
          verificador.renovar();
        }
      },
    }, [
      el('p', { classe: 'texto-suave', texto: 'Enviaremos um link para você criar uma nova senha. Ele vale por 30 minutos.' }),
      email.elemento, el('div', { classe: 'campo' }, [verificador.elemento]), areaMensagem, el('div', { classe: 'campo' }, [botao]), voltar,
    ]);
    verificador.observar(formulario);
    return formulario;
  }

  function mascararTelefone(texto) {
    const d = String(texto).replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  /**
   * Antes, esta tela redirecionava SEM AVISAR: quem já estava logado (ex.: o dono)
   * clicava em "Criar conta" e caía no painel, parecendo que não funcionava.
   * Agora explicamos o que está acontecendo e damos as opções.
   */
  function avisoJaConectado(usuario) {
    const nomesPapel = { dono: 'dono do sistema', adm: 'ADM', usuario: 'cliente' };
    trocar(caixa,
      el('h1', { texto: 'Você já está conectado' }),
      el('p', { classe: 'texto-suave', texto: `Entrou como ${usuario.nome} (${nomesPapel[usuario.papel] || usuario.papel}).` }),
      abaAtual === 'cadastro' ? alerta('Para criar uma conta de CLIENTE (por exemplo, para testar o agendamento), saia desta conta primeiro ou use uma janela anônima do navegador.', 'info') : null,
      el('p'),
      el('div', { classe: 'campo' }, [el('a', { classe: 'botao botao--primario botao--largo', href: destinoPorPapel(usuario.papel), texto: usuario.papel === 'usuario' ? 'Ir para minha conta' : 'Ir para o painel' })]),
      el('div', { classe: 'campo' }, [el('button', {
        classe: 'botao botao--secundario botao--largo', type: 'button',
        texto: abaAtual === 'cadastro' ? 'Sair e criar outra conta' : 'Sair e entrar com outra conta',
        aoClick: async () => {
          await api('/api/sair', { corpo: {}, semRedirecionar: true }).catch(() => {});
          const dados = await api('/api/sessao', { semRedirecionar: true }).catch(() => ({}));
          sessaoInfo = dados;
          desenhar();
        },
      })]),
    );
  }

  function avisoConfiguracaoPendente() {
    trocar(caixa,
      el('h1', { texto: 'Sistema ainda não configurado' }),
      alerta('Antes de qualquer cadastro, o DONO do sistema precisa fazer a configuração inicial (com o código que aparece na janela do servidor).', 'info'),
      el('p'),
      el('a', { classe: 'botao botao--primario botao--largo', href: '/configuracao-inicial', texto: 'Fazer a configuração inicial' }),
    );
  }

  api('/api/sessao', { semRedirecionar: true }).then((dados) => {
    sessaoInfo = dados;
    if (dados.configuracaoInicialPendente) avisoConfiguracaoPendente();
    else if (dados.usuario) avisoJaConectado(dados.usuario);
    else desenhar();
  }).catch(() => desenhar());
})();
