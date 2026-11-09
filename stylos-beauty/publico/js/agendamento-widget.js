/**
 * agendamento-widget.js
 * ------------------------------------------------------------------
 * O "aplicativo" de agendamento que aparece dentro da seção Agendamento.
 *
 * Passos:  1 Serviço  →  2 Dia e horário  →  3 Seus dados  →  ✓ Enviar no WhatsApp
 *
 * Os horários vêm do servidor, que junta o Google Agenda do ADM com o
 * expediente e os pedidos já feitos. Na PRÉVIA do editor usamos horários
 * de mentira só para mostrar como fica.
 */
(function (raiz) {
  'use strict';

  const Icones = raiz.IconesStylOS;
  const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  function el(tag, atributos, filhos) {
    return raiz.RenderizadorStylOS.el(tag, atributos, filhos);
  }

  /** "2026-11-12" → { semana: 'qui', diaMes: '12/11' } */
  function rotuloDoDia(dataTexto) {
    const [ano, mes, dia] = dataTexto.split('-').map(Number);
    const semana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
    return { semana: DIAS_CURTOS[semana], diaMes: `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}` };
  }

  function duracaoLegivel(minutos) {
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    if (!horas) return `${resto} min`;
    return resto ? `${horas}h${String(resto).padStart(2, '0')}` : `${horas}h`;
  }

  /** Máscara de telefone enquanto digita: (92) 99999-9999 */
  function mascararTelefone(texto) {
    const digitos = String(texto).replace(/\D/g, '').slice(0, 11);
    if (digitos.length <= 2) return digitos.length ? `(${digitos}` : '';
    if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
    if (digitos.length <= 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  }

  /** Horários de mentira para a prévia do editor. */
  function diasDeDemonstracao(duracaoMin) {
    const dias = [];
    const hoje = new Date();
    for (let indice = 0; indice < 10; indice++) {
      const data = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + indice));
      const texto = data.toISOString().slice(0, 10);
      const semana = data.getUTCDay();
      const horarios = [];
      if (semana !== 0) {
        const fim = semana === 6 ? 12 * 60 : 18 * 60;
        for (let minuto = 8 * 60; minuto + duracaoMin <= fim; minuto += 30) {
          const hora = `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`;
          const estado = indice === 0 ? 'indisponivel' : (minuto / 30 + indice) % 4 === 0 ? 'ocupado' : 'livre';
          horarios.push({ inicio: `${texto}T${hora}:00`, hora, estado });
        }
      }
      dias.push({ data: texto, diaSemana: semana, folga: horarios.length === 0, horarios });
    }
    return dias;
  }

  /** Chamada à API pública com o cabeçalho anti-CSRF. */
  async function chamarApi(caminho, opcoes) {
    const resposta = await fetch(caminho, {
      ...opcoes,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-StylOS': '1', ...(opcoes && opcoes.headers) },
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = new Error(dados.erro || 'Algo deu errado. Tente de novo.');
      erro.status = resposta.status;
      throw erro;
    }
    return dados;
  }

  /**
   * Monta o widget.
   * @param {HTMLElement} alvo
   * @param {object} contexto do renderizador ({ modo, slug, agenda, usuario })
   */
  function montar(alvo, contexto) {
    const previa = contexto.modo === 'previa';
    const servicos = contexto.agenda.servicos && contexto.agenda.servicos.length
      ? contexto.agenda.servicos
      : previa ? [{ id: 'exemplo', nome: 'Serviço de exemplo', duracaoMin: 60, preco: '' }] : [];

    const estado = {
      etapa: 1,
      servico: null,
      dias: [],
      dataSelecionada: null,
      horario: null,
      carregando: false,
      erro: '',
      resultado: null,
    };

    const cartao = el('div', { classe: 'agenda-widget', 'aria-live': 'polite' });
    alvo.replaceChildren(cartao);

    // -------- Sem agenda ativa --------
    if (!previa && (!contexto.agenda.ativa || !servicos.length)) {
      cartao.append(el('div', { classe: 'agenda-widget__vazio' }, [
        Icones.criar('agenda', 32),
        el('p', { texto: 'O agendamento on-line estará disponível em breve.' }),
      ]));
      return;
    }

    function irPara(etapa) {
      estado.etapa = etapa;
      estado.erro = '';
      desenhar();
      const titulo = cartao.querySelector('.agenda-widget__titulo-etapa');
      if (titulo && !previa) titulo.focus({ preventScroll: true });
    }

    async function escolherServico(servico) {
      estado.servico = servico;
      estado.horario = null;
      estado.etapa = 2;
      estado.carregando = true;
      estado.erro = '';
      desenhar();
      try {
        if (previa) {
          estado.dias = diasDeDemonstracao(servico.duracaoMin);
        } else {
          const dados = await chamarApi(`/api/publico/paginas/${encodeURIComponent(contexto.slug)}/horarios?servico=${encodeURIComponent(servico.id)}`);
          estado.dias = dados.dias;
        }
        const primeiroComVaga = estado.dias.find((dia) => dia.horarios.some((horario) => horario.estado === 'livre'));
        estado.dataSelecionada = primeiroComVaga ? primeiroComVaga.data : (estado.dias[0] && estado.dias[0].data);
      } catch (erro) {
        estado.erro = erro.message;
        estado.dias = [];
      }
      estado.carregando = false;
      desenhar();
      const titulo = cartao.querySelector('.agenda-widget__titulo-etapa');
      if (titulo && !previa) titulo.focus({ preventScroll: true });
    }

    // -------- Barra de progresso --------
    function progresso() {
      const passos = ['Serviço', 'Horário', 'Seus dados'];
      return el('ol', { classe: 'agenda-widget__progresso', 'aria-label': 'Etapas do agendamento' }, passos.map((nome, indice) => {
        const numero = indice + 1;
        const situacao = estado.etapa > numero ? 'feito' : estado.etapa === numero ? 'atual' : 'futuro';
        return el('li', { classe: `passo passo--${situacao}`, 'aria-current': situacao === 'atual' ? 'step' : null }, [
          el('span', { classe: 'passo__numero' }, situacao === 'feito' ? [Icones.criar('check', 14)] : [String(numero)]),
          el('span', { classe: 'passo__nome', texto: nome }),
        ]);
      }));
    }

    function tituloEtapa(texto) {
      return el('h3', { classe: 'agenda-widget__titulo-etapa', tabindex: '-1', texto });
    }

    function botaoVoltar(etapa, texto) {
      return el('button', { classe: 'agenda-widget__voltar', type: 'button', aoClick: () => irPara(etapa) }, [Icones.criar('setaEsquerda', 16), texto]);
    }

    // -------- Etapa 1: serviço --------
    function etapaServico() {
      return [
        tituloEtapa('Qual serviço você quer?'),
        el('div', { classe: 'lista-servicos' }, servicos.map((servico) => el('button', {
          classe: `opcao-servico ${estado.servico && estado.servico.id === servico.id ? 'opcao-servico--ativa' : ''}`,
          type: 'button',
          aoClick: () => escolherServico(servico),
        }, [
          el('span', { classe: 'opcao-servico__nome', texto: servico.nome }),
          el('span', { classe: 'opcao-servico__detalhes' }, [
            el('span', {}, [Icones.criar('relogio', 15), duracaoLegivel(servico.duracaoMin)]),
            servico.preco ? el('span', { classe: 'opcao-servico__preco', texto: servico.preco }) : null,
          ]),
          el('span', { classe: 'opcao-servico__seta' }, [Icones.criar('seta', 18)]),
        ]))),
      ];
    }

    // -------- Etapa 2: dia e horário --------
    function etapaHorario() {
      const partes = [
        botaoVoltar(1, 'Trocar serviço'),
        tituloEtapa(`Escolha o dia e o horário · ${estado.servico.nome}`),
      ];
      if (estado.carregando) {
        partes.push(el('div', { classe: 'agenda-widget__carregando' }, [el('span', { classe: 'giratorio', 'aria-hidden': 'true' }), 'Buscando horários livres...']));
        return partes;
      }
      if (estado.erro) {
        partes.push(el('p', { classe: 'agenda-widget__erro', role: 'alert', texto: estado.erro }),
          el('button', { classe: 'botao botao--secundario', type: 'button', aoClick: () => escolherServico(estado.servico), texto: 'Tentar de novo' }));
        return partes;
      }
      if (!estado.dias.some((dia) => dia.horarios.some((horario) => horario.estado === 'livre'))) {
        partes.push(el('p', { classe: 'agenda-widget__erro', texto: 'Não há horários livres nos próximos dias para este serviço. Chame o salão pelo WhatsApp.' }));
        return partes;
      }

      const faixaDias = el('div', { classe: 'faixa-dias', role: 'listbox', 'aria-label': 'Dias' });
      for (const dia of estado.dias) {
        const livres = dia.horarios.filter((horario) => horario.estado === 'livre').length;
        const rotulo = rotuloDoDia(dia.data);
        const selecionado = dia.data === estado.dataSelecionada;
        faixaDias.append(el('button', {
          classe: `dia ${selecionado ? 'dia--ativo' : ''} ${livres ? '' : 'dia--sem-vaga'}`,
          type: 'button',
          role: 'option',
          'aria-selected': String(selecionado),
          disabled: dia.folga ? true : null,
          'aria-label': `${rotulo.semana} ${rotulo.diaMes}: ${dia.folga ? 'folga' : livres ? `${livres} horários livres` : 'lotado'}`,
          aoClick: () => {
            estado.dataSelecionada = dia.data;
            estado.horario = null;
            desenhar();
            const ativo = cartao.querySelector('.dia--ativo');
            if (ativo) ativo.focus({ preventScroll: true });
          },
        }, [
          el('span', { classe: 'dia__semana', texto: rotulo.semana }),
          el('span', { classe: 'dia__data', texto: rotulo.diaMes }),
          el('span', { classe: 'dia__vagas', texto: dia.folga ? 'folga' : livres ? `${livres} livres` : 'lotado' }),
        ]));
      }

      const diaAtual = estado.dias.find((dia) => dia.data === estado.dataSelecionada);
      const gradeHorarios = el('div', { classe: 'grade-horarios', role: 'group', 'aria-label': 'Horários' });
      if (diaAtual) {
        for (const horario of diaAtual.horarios) {
          const nomesEstado = { livre: 'livre', ocupado: 'ocupado', indisponivel: 'indisponível' };
          gradeHorarios.append(el('button', {
            classe: `horario horario--${horario.estado}`,
            type: 'button',
            disabled: horario.estado !== 'livre' ? true : null,
            'aria-label': `${horario.hora}, ${nomesEstado[horario.estado]}`,
            title: horario.estado === 'livre' ? 'Livre' : horario.estado === 'ocupado' ? 'Ocupado' : 'Indisponível',
            aoClick: () => {
              estado.horario = horario;
              irPara(3);
            },
          }, [horario.hora]));
        }
      }
      partes.push(
        faixaDias,
        gradeHorarios,
        el('ul', { classe: 'legenda-horarios', 'aria-hidden': 'true' }, [
          el('li', {}, [el('span', { classe: 'bolinha bolinha--livre' }), 'Livre']),
          el('li', {}, [el('span', { classe: 'bolinha bolinha--ocupado' }), 'Ocupado']),
          el('li', {}, [el('span', { classe: 'bolinha bolinha--indisponivel' }), 'Indisponível']),
        ]),
      );
      return partes;
    }

    // -------- Etapa 3: dados da cliente --------
    function etapaDados() {
      const rotulo = rotuloDoDia(estado.dataSelecionada);
      const resumo = el('div', { classe: 'resumo-escolha' }, [
        el('div', {}, [
          el('strong', { texto: estado.servico.nome }),
          el('span', { texto: `${rotulo.semana}, ${rotulo.diaMes} às ${estado.horario.hora} · ${duracaoLegivel(estado.servico.duracaoMin)}` }),
        ]),
        el('button', { classe: 'link-botao', type: 'button', aoClick: () => irPara(2), texto: 'Alterar' }),
      ]);

      if (contexto.agenda.exigirContaCliente && !previa && !(contexto.usuario && contexto.usuario.papel === 'usuario')) {
        const voltar = encodeURIComponent(location.pathname + '#secao-' + (contexto.idAgendamento || ''));
        return [
          botaoVoltar(2, 'Trocar horário'),
          tituloEtapa('Entre para confirmar'),
          resumo,
          el('p', { classe: 'texto-apoio', texto: 'Este salão pede que as clientes tenham uma conta. É rápido e você acompanha seus horários.' }),
          el('div', { classe: 'agenda-widget__acoes' }, [
            el('a', { classe: 'botao botao--primario', href: `/entrar?voltar=${voltar}`, texto: 'Entrar' }),
            el('a', { classe: 'botao botao--secundario', href: `/cadastro?voltar=${voltar}`, texto: 'Criar conta' }),
          ]),
        ];
      }

      const usuario = contexto.usuario && contexto.usuario.papel === 'usuario' ? contexto.usuario : null;
      const campoNome = el('input', { id: 'ag-nome', name: 'nome', required: true, maxlength: '80', autocomplete: 'name', value: usuario ? usuario.nome : '' });
      const campoTelefone = el('input', {
        id: 'ag-telefone', name: 'telefone', required: true, inputmode: 'tel', autocomplete: 'tel-national', placeholder: '(92) 99999-9999',
        value: usuario && usuario.telefone ? mascararTelefone(usuario.telefone.replace(/^55/, '')) : '',
        aoInput: (evento) => { evento.target.value = mascararTelefone(evento.target.value); },
      });
      const campoObs = el('textarea', { id: 'ag-obs', name: 'observacoes', rows: '2', maxlength: '300', placeholder: 'Opcional: alergias, referência de corte...' });
      const campoAceite = el('input', { id: 'ag-aceite', name: 'consentimento', type: 'checkbox', required: true });
      const armadilha = el('input', { name: 'site', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', classe: 'campo-armadilha' });
      const botaoEnviar = el('button', { classe: 'botao botao--primario botao--largo', type: 'submit' }, [Icones.criar('whatsapp', 20), 'Pedir horário']);
      // "Não sou um robô" (só na página publicada; na prévia não há envio de verdade)
      const verificador = !previa && raiz.AntiRoboStylOS ? raiz.AntiRoboStylOS.criar() : null;
      const mensagemErro = el('p', { classe: 'agenda-widget__erro', role: 'alert', hidden: true });

      const formulario = el('form', {
        classe: 'formulario-agenda',
        novalidate: true,
        aoSubmit: async (evento) => {
          evento.preventDefault();
          mensagemErro.hidden = true;
          const telefoneDigitos = campoTelefone.value.replace(/\D/g, '');
          let problema = '';
          if (campoNome.value.trim().length < 2) problema = 'Informe seu nome.';
          else if (telefoneDigitos.length < 10) problema = 'Informe seu telefone com DDD.';
          else if (!campoAceite.checked) problema = 'Marque a caixa de concordância para continuar.';
          if (problema) {
            mensagemErro.textContent = problema;
            mensagemErro.hidden = false;
            return;
          }
          if (previa) {
            mensagemErro.textContent = 'Isto é uma prévia: o pedido de verdade só funciona na página publicada.';
            mensagemErro.hidden = false;
            return;
          }
          botaoEnviar.disabled = true;
          botaoEnviar.classList.add('carregando');
          try {
            const antiRobo = verificador ? await verificador.obterSolucao() : undefined;
            estado.resultado = await chamarApi(`/api/publico/paginas/${encodeURIComponent(contexto.slug)}/agendamentos`, {
              method: 'POST',
              body: JSON.stringify({
                servicoId: estado.servico.id,
                inicio: estado.horario.inicio,
                nome: campoNome.value,
                telefone: telefoneDigitos,
                observacoes: campoObs.value,
                consentimento: campoAceite.checked,
                site: armadilha.value,
                antiRobo,
              }),
            });
            irPara(4);
          } catch (erro) {
            if (verificador) verificador.renovar(); // cada verificação vale uma vez
            botaoEnviar.disabled = false;
            botaoEnviar.classList.remove('carregando');
            mensagemErro.textContent = erro.message;
            mensagemErro.hidden = false;
            if (erro.status === 409) {
              // horário foi ocupado: recarrega a lista
              setTimeout(() => escolherServico(estado.servico), 1800);
            }
          }
        },
      }, [
        el('div', { classe: 'campo' }, [el('label', { for: 'ag-nome', texto: 'Seu nome' }), campoNome]),
        el('div', { classe: 'campo' }, [el('label', { for: 'ag-telefone', texto: 'WhatsApp / telefone' }), campoTelefone]),
        el('div', { classe: 'campo' }, [el('label', { for: 'ag-obs', texto: 'Observações' }), campoObs]),
        el('label', { classe: 'campo-armadilha', 'aria-hidden': 'true' }, ['Não preencha', armadilha]),
        el('div', { classe: 'campo campo--caixa' }, [
          campoAceite,
          el('label', { for: 'ag-aceite', texto: 'Concordo que meu nome e telefone sejam usados apenas para este agendamento (LGPD).' }),
        ]),
        verificador ? verificador.elemento : null,
        mensagemErro,
        botaoEnviar,
        el('p', { classe: 'agenda-widget__nota', texto: 'Nenhum pagamento é feito aqui. Depois de pedir, você envia a confirmação pelo WhatsApp.' }),
      ]);
      if (verificador) verificador.observar(formulario);
      return [botaoVoltar(2, 'Trocar horário'), tituloEtapa('Seus dados'), resumo, formulario];
    }

    // -------- Etapa 4: sucesso --------
    function etapaSucesso() {
      const resultado = estado.resultado;
      return [
        el('div', { classe: 'sucesso-agenda' }, [
          el('span', { classe: 'sucesso-agenda__icone' }, [Icones.criar('check', 34)]),
          tituloEtapa('Falta só um passo!'),
          el('p', { texto: `Seu horário de ${resultado.resumo.servico} em ${resultado.resumo.diaSemana}, ${resultado.resumo.data} às ${resultado.resumo.hora} está reservado.` }),
          el('p', { classe: 'texto-apoio', texto: 'Toque no botão abaixo para enviar o pedido no WhatsApp do salão. A confirmação vem por lá.' }),
          el('a', { classe: 'botao botao--whatsapp botao--largo', href: resultado.linkWhatsapp, target: '_blank', rel: 'noopener noreferrer' }, [Icones.criar('whatsapp', 22), 'Enviar pelo WhatsApp']),
          el('p', { classe: 'sucesso-agenda__codigo' }, ['Código do pedido: ', el('strong', { texto: resultado.codigo })]),
          el('button', {
            classe: 'link-botao', type: 'button', texto: 'Fazer outro agendamento',
            aoClick: () => { estado.servico = null; estado.horario = null; estado.resultado = null; irPara(1); },
          }),
        ]),
      ];
    }

    function desenhar() {
      const corpo = estado.etapa === 1 ? etapaServico()
        : estado.etapa === 2 ? etapaHorario()
          : estado.etapa === 3 ? etapaDados()
            : etapaSucesso();
      cartao.replaceChildren(
        estado.etapa < 4 ? progresso() : '',
        el('div', { classe: `agenda-widget__corpo etapa-${estado.etapa}` }, corpo),
        previa ? el('p', { classe: 'agenda-widget__selo-previa', texto: 'Prévia — horários de exemplo' }) : '',
      );
    }

    // Um só serviço? Já pula para o horário.
    if (servicos.length === 1 && !previa) escolherServico(servicos[0]);
    else desenhar();
  }

  raiz.AgendamentoStylOS = { montar, mascararTelefone, duracaoLegivel };
})(typeof self !== 'undefined' ? self : this);
