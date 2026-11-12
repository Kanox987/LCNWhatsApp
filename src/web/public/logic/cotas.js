// O contador de cota que o cliente vê ("12 de 20 automações"). Só existe
// quando o administrador deu um teto: sem teto (`maximo` 0) não há o que
// contar, e mostrar "12 de ∞" seria ruído.
export function descreverCota (cota, { singular, plural }) {
  const maximo = Number(cota?.maximo)
  const usadas = Number(cota?.usadas)
  if (!Number.isInteger(maximo) || maximo <= 0 || !Number.isInteger(usadas) || usadas < 0) return null
  const texto = `${usadas} de ${maximo} ${maximo === 1 ? singular : plural}`
  // Passar do teto acontece quando o administrador baixa a cota de quem já
  // tinha mais: as existentes seguem valendo, só não dá para criar outra.
  if (usadas >= maximo) {
    return { texto, tom: 'danger', aviso: `Limite atingido: para criar outra, apague uma das ${usadas}.` }
  }
  return { texto, tom: usadas / maximo >= 0.8 ? 'warning' : 'neutral', aviso: null }
}
