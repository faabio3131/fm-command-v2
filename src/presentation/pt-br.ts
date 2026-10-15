export function rotuloStatusProduto(status: string): string {
  if (status === "active") return "Ativo";
  if (status === "inactive") return "Inativo";
  return "Estado desconhecido";
}

export function rotuloCategoriaProduto(category: string): string {
  switch (category) {
    case "acquisition": return "Aquisição";
    case "activation": return "Ativação";
    case "engagement": return "Engajamento";
    case "revenue": return "Receita";
    case "churn": return "Cancelamento";
    case "health": return "Saúde operacional";
    default: return "Categoria";
  }
}

export function rotuloAtualidade(status: string): string {
  switch (status) {
    case "fresh": return "Atual";
    case "delayed": return "Com atraso";
    case "stale": return "Desatualizada";
    case "unknown": return "Desconhecida";
    case "unavailable": return "Indisponível";
    default: return "Desconhecida";
  }
}

export function rotuloQualidade(status: string): string {
  switch (status) {
    case "verified": return "Verificada";
    case "reconciled": return "Reconciliada";
    case "partial": return "Parcial";
    case "estimated": return "Estimada";
    case "unknown": return "Desconhecida";
    case "missing": return "Ausente";
    default: return "Desconhecida";
  }
}

export function rotuloStatusDefinicao(status: string): string {
  if (status === "implemented") return "Implementada";
  if (status === "pending_semantics") return "Semântica pendente";
  return "Estado desconhecido";
}

export function rotuloEstadoComparacao(status?: string): string {
  switch (status) {
    case "comparable": return "Comparável";
    case "unavailable": return "Indisponível";
    case "pending_semantics": return "Semântica pendente";
    case "incompatible_currency": return "Moedas incompatíveis";
    case "incompatible_period": return "Períodos incompatíveis";
    default: return "Estado desconhecido";
  }
}

export function mensagemEstadoComparacao(status?: string): string {
  switch (status) {
    case "comparable":
      return "Os dados atendem aos critérios de comparação governada.";
    case "unavailable":
      return "Ainda não existem dados governados suficientes para comparar estes produtos.";
    case "pending_semantics":
      return "A definição semântica desta métrica ainda não foi aprovada.";
    case "incompatible_currency":
      return "Os valores usam moedas diferentes e não há política de conversão aprovada.";
    case "incompatible_period":
      return "Os valores pertencem a períodos diferentes e não podem ser comparados diretamente.";
    default:
      return "Não foi possível determinar o estado da comparação.";
  }
}

export function rotuloDirecaoCrescimento(direction?: string): string {
  if (direction === "increased") return "Aumentou";
  if (direction === "decreased") return "Diminuiu";
  if (direction === "unchanged") return "Permaneceu estável";
  return "Indisponível";
}

export function rotuloUnidade(unit?: string): string {
  switch (unit) {
    case "count": return "contagem";
    case "currency": return "valor monetário";
    case "ratio": return "proporção";
    case "percent": return "percentual";
    case "seconds": return "segundos";
    default: return "unidade";
  }
}

export function mensagemErroCadastroProduto(code?: string): string {
  switch (code) {
    case "product.slug_conflict":
      return "Já existe um produto com esse identificador.";
    case "product.definition_invalid":
      return "Os dados informados para o produto são inválidos.";
    case "security.authentication_required":
      return "Sua sessão expirou. Entre novamente.";
    default:
      return "Não foi possível cadastrar o produto.";
  }
}

export function mensagemErroComparacao(code?: string): string {
  if (code === "product.compare_scope_invalid") {
    return "Selecione entre dois e oito produtos válidos para comparar.";
  }
  if (code === "product.compare_metric_required") {
    return "Selecione uma métrica para comparar.";
  }
  return "Não foi possível realizar a comparação.";
}

export function rotuloMetrica(metricId: string): string {
  switch (metricId) {
    case "trial.starts.count": return "Testes gratuitos iniciados";
    case "trial.active.count": return "Testes gratuitos ativos";
    case "trial.conversion.rate": return "Conversão de teste gratuito em assinatura";
    case "subscription.active.count": return "Assinaturas ativas";
    case "subscription.cancelled.count": return "Cancelamentos";
    case "subscription.logo_churn.rate": return "Taxa de cancelamento de clientes";
    case "billing.gross_billed": return "Faturamento bruto emitido";
    case "revenue.cash_collected": return "Caixa recebido";
    case "revenue.mrr": return "Receita recorrente mensal";
    case "revenue.arr": return "Receita recorrente anual";
    case "receivable.delinquent_amount": return "Inadimplência";
    case "lead.created.count": return "Potenciais clientes criados";
    case "activation.completed.count": return "Ativações concluídas";
    case "activation.rate": return "Taxa de ativação";
    case "usage.active_users.dau": return "Usuários ativos diários";
    case "usage.active_users.mau": return "Usuários ativos mensais";
    case "usage.feature_adoption.rate": return "Taxa de adoção de funcionalidade";
    case "usage.engagement.events": return "Eventos de engajamento";
    case "incident.count": return "Incidentes";
    case "service.error.rate": return "Taxa de erro";
    case "support.ticket.open.count": return "Chamados de suporte abertos";
    default: return "Métrica governada";
  }
}

export function rotuloAutoridadeFonte(sourceAuthority?: string): string {
  switch (sourceAuthority) {
    case "configured_trial_source": return "Fonte governada de testes gratuitos";
    case "configured_billing_source": return "Fonte governada de cobrança";
    case "configured_payment_source": return "Fonte governada de pagamentos";
    case "billing-authority": return "Fonte governada de cobrança";
    default: return "Fonte governada";
  }
}


export function rotuloOperadorAlerta(operator: string): string {
  switch (operator) {
    case "gt": return "Maior que";
    case "gte": return "Maior ou igual a";
    case "lt": return "Menor que";
    case "lte": return "Menor ou igual a";
    case "eq": return "Igual a";
    default: return "Operador";
  }
}

export function rotuloSeveridadeAlerta(severity: string): string {
  switch (severity) {
    case "info": return "Informativa";
    case "warning": return "Atenção";
    case "critical": return "Crítica";
    default: return "Severidade";
  }
}

export function rotuloEstadoRegraAlerta(enabled: boolean, archived: boolean): string {
  if (archived) return "Arquivada";
  return enabled ? "Ativa" : "Desativada";
}

export function rotuloEstadoOcorrencia(status: string): string {
  switch (status) {
    case "active": return "Ativa";
    case "acknowledged": return "Reconhecida";
    default: return "Estado desconhecido";
  }
}


export function rotuloNivelRiscoAcao(riskLevel?: string): string {
  switch (riskLevel) {
    case "low": return "Baixo risco";
    case "medium": return "Risco médio";
    case "high": return "Alto risco";
    default: return "Risco não classificado";
  }
}

export function rotuloPapelFmcc(role: string): string {
  switch (role) {
    case "owner": return "Proprietário";
    case "admin": return "Administrador";
    case "analyst": return "Analista";
    case "viewer": return "Visualizador";
    case "member": return "Membro";
    default: return "Papel não identificado";
  }
}
